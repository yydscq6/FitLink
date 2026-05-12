const express = require('express');
const db = require('../db/database');
const { authMiddleware } = require('./users');
const { writeLimiter, checkSensitiveEnhanced } = require('../utils/security');
const logger = require('../utils/logger');
const router = express.Router();

/**
 * 创建通知（内部工具函数）
 * 同时通过 WebSocket 实时推送给在线用户
 */
function createNotification(userId, type, title, content, teamId) {
  db.prepare(
    'INSERT INTO notifications (userId, type, title, content, teamId) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, type, title, content || '', teamId || null);

  // WebSocket 实时推送（静默失败，不影响主流程）
  try {
    const { sendToUser, isUserOnline } = require('../utils/websocket');
    if (isUserOnline(userId)) {
      sendToUser(userId, {
        type: 'notification',
        data: { notificationType: type, title, content, teamId, timestamp: Date.now() },
      });
    }
  } catch (e) {}
}

/**
 * GET /api/comments/:teamId
 * 获取组局评论列表（含回复和点赞数）
 */
router.get('/:teamId', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    if (isNaN(teamId)) return res.json({ code: -1, message: '参数错误' });

    const { page = 1, pageSize = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const sizeNum = Math.min(100, parseInt(pageSize));

    // 获取当前用户（可能未登录）
    let currentUserId = 0;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET || 'sport-mini-secret');
        currentUserId = decoded.id || 0;
      } catch (e) {}
    }

    // 获取所有评论
    const allComments = db.prepare(
      'SELECT c.*, u.nickname, u.avatarUrl FROM comments c JOIN users u ON c.userId = u.id WHERE c.teamId = ? ORDER BY c.createdAt ASC'
    ).all(teamId);

    // 获取所有点赞数
    const likeCounts = {};
    const likedSet = new Set();
    if (allComments.length > 0) {
      const ids = allComments.map(c => c.id);
      const placeholders = ids.map(() => '?').join(',');
      const likes = db.prepare(
        `SELECT commentId, COUNT(*) as cnt FROM comment_likes WHERE commentId IN (${placeholders}) GROUP BY commentId`
      ).all(...ids);
      likes.forEach(r => { likeCounts[r.commentId] = r.cnt; });

      if (currentUserId) {
        const myLikes = db.prepare(
          `SELECT commentId FROM comment_likes WHERE userId = ? AND commentId IN (${placeholders})`
        ).all(currentUserId, ...ids);
        myLikes.forEach(r => likedSet.add(r.commentId));
      }
    }

    // 分离主评论和回复
    const parents = allComments.filter(c => !c.parentId || c.parentId === 0);
    const replies = allComments.filter(c => c.parentId && c.parentId > 0);

    // 构建回复映射
    const replyMap = {};
    replies.forEach(r => {
      if (!replyMap[r.parentId]) replyMap[r.parentId] = [];
      replyMap[r.parentId].push(r);
    });

    const total = parents.length;
    const start = (pageNum - 1) * sizeNum;
    const list = parents.slice(start, start + sizeNum).map(c => ({
      _id: c.id,
      content: c.content,
      createdAt: c.createdAt,
      userId: { _id: c.userId, nickname: c.nickname, avatarUrl: c.avatarUrl },
      likeCount: likeCounts[c.id] || 0,
      isLiked: likedSet.has(c.id),
      replies: (replyMap[c.id] || []).map(r => ({
        _id: r.id,
        content: r.content,
        createdAt: r.createdAt,
        userId: { _id: r.userId, nickname: r.nickname, avatarUrl: r.avatarUrl },
        replyToId: r.parentId,
        likeCount: likeCounts[r.id] || 0,
        isLiked: likedSet.has(r.id),
      })),
    }));

    res.json({ code: 0, data: { list, pagination: { page: pageNum, pageSize: sizeNum, total } } });
  } catch (err) {
    console.error('[comments list] error:', err.message);
    res.json({ code: -1, message: '加载失败' });
  }
});

/**
 * POST /api/comments/:teamId
 * 发表评论（需登录，需为组局成员或队长）
 * body: { content, parentId? }
 */
router.post('/:teamId', authMiddleware, writeLimiter, async (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const userId = req.user.id;
    const { content, parentId } = req.body;

    if (!content || !content.trim()) return res.json({ code: -1, message: '请输入评论内容' });
    if (content.trim().length > 500) return res.json({ code: -1, message: '评论不能超过500字' });

    // 增强敏感词检查（本地 + 微信云端）
    const check = await checkSensitiveEnhanced(content);
    if (!check.pass) return res.json({ code: -1, message: '评论包含违规内容，请修改' });

    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
    if (!team) return res.json({ code: -1, message: '组局不存在' });

    // 检查是否为成员或队长
    const isMember = db.prepare('SELECT * FROM team_members WHERE teamId = ? AND userId = ?').get(teamId, userId);
    if (!isMember) return res.json({ code: -1, message: '只有组局成员才能评论' });

    // 回复验证
    const pid = parseInt(parentId) || 0;
    if (pid > 0) {
      const parentComment = db.prepare('SELECT * FROM comments WHERE id = ? AND teamId = ?').get(pid, teamId);
      if (!parentComment) return res.json({ code: -1, message: '回复的评论不存在' });
    }

    db.prepare('INSERT INTO comments (teamId, userId, content, parentId) VALUES (?, ?, ?, ?)').run(teamId, userId, content.trim(), pid);

    // 通知
    if (pid > 0) {
      // 回复通知被回复的人
      const parentComment = db.prepare('SELECT userId FROM comments WHERE id = ?').get(pid);
      if (parentComment && parentComment.userId !== userId) {
        createNotification(
          parentComment.userId,
          'reply',
          '评论回复',
          req.user.nickname + ' 回复了你的评论',
          teamId
        );
      }
    } else {
      // 新评论通知队长
      if (team.leaderId !== userId) {
        createNotification(
          team.leaderId,
          'comment',
          '新评论',
          req.user.nickname + ' 在「' + team.title + '」中发表了评论',
          teamId
        );
      }
    }

    res.json({ code: 0, message: pid > 0 ? '回复成功' : '评论成功' });
  } catch (err) {
    console.error('[create comment] error:', err.message);
    res.json({ code: -1, message: '评论失败' });
  }
});

/**
 * POST /api/comments/:commentId/like
 * 点赞评论
 */
router.post('/:commentId/like', authMiddleware, (req, res) => {
  try {
    const commentId = parseInt(req.params.commentId);
    const userId = req.user.id;

    const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
    if (!comment) return res.json({ code: -1, message: '评论不存在' });

    // 检查是否已点赞
    const existing = db.prepare('SELECT id FROM comment_likes WHERE commentId = ? AND userId = ?').get(commentId, userId);
    if (existing) return res.json({ code: -1, message: '已经点赞过了' });

    db.prepare('INSERT INTO comment_likes (commentId, userId) VALUES (?, ?)').run(commentId, userId);

    const count = db.prepare('SELECT COUNT(*) as cnt FROM comment_likes WHERE commentId = ?').get(commentId);

    res.json({ code: 0, data: { likeCount: count.cnt, isLiked: true }, message: '点赞成功' });
  } catch (err) {
    console.error('[like comment] error:', err.message);
    res.json({ code: -1, message: '点赞失败' });
  }
});

/**
 * DELETE /api/comments/:commentId/like
 * 取消点赞
 */
router.delete('/:commentId/like', authMiddleware, (req, res) => {
  try {
    const commentId = parseInt(req.params.commentId);
    const userId = req.user.id;

    const result = db.prepare('DELETE FROM comment_likes WHERE commentId = ? AND userId = ?').run(commentId, userId);
    if (result.changes === 0) return res.json({ code: -1, message: '未点赞过' });

    const count = db.prepare('SELECT COUNT(*) as cnt FROM comment_likes WHERE commentId = ?').get(commentId);

    res.json({ code: 0, data: { likeCount: count.cnt, isLiked: false }, message: '取消点赞' });
  } catch (err) {
    console.error('[unlike comment] error:', err.message);
    res.json({ code: -1, message: '取消点赞失败' });
  }
});

module.exports = router;
module.exports.createNotification = createNotification;
