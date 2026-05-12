/**
 * 举报路由
 * POST   /api/reports       — 提交举报
 * GET    /api/reports       — 获取举报列表（管理员）
 * PUT    /api/reports/:id   — 处理举报（管理员）
 */
const express = require('express');
const db = require('../db/database');
const logger = require('../utils/logger');
const { authMiddleware, adminMiddleware } = require('./users');
const { writeLimiter } = require('../utils/security');
const { creditForReported } = require('../utils/credit');
const router = express.Router();

const VALID_TARGET_TYPES = ['team', 'user', 'comment'];
const VALID_REASONS = ['spam', 'inappropriate', 'fraud', 'violence', 'other'];

/**
 * POST /api/reports
 * 提交举报
 */
router.post('/', authMiddleware, writeLimiter, (req, res) => {
  try {
    const reporterId = req.user.id;
    const { targetType, targetId, reason, description } = req.body;

    if (!targetType || !VALID_TARGET_TYPES.includes(targetType)) {
      return res.json({ code: -1, message: '举报类型无效' });
    }
    if (!targetId || isNaN(parseInt(targetId))) {
      return res.json({ code: -1, message: '举报目标不存在' });
    }
    if (!reason || !VALID_REASONS.includes(reason)) {
      return res.json({ code: -1, message: '请选择举报原因' });
    }

    const tid = parseInt(targetId);

    // 检查举报目标是否存在
    if (targetType === 'team') {
      const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(tid);
      if (!team) return res.json({ code: -1, message: '组局不存在' });
    } else if (targetType === 'user') {
      const user = db.prepare('SELECT id FROM users WHERE id = ?').get(tid);
      if (!user) return res.json({ code: -1, message: '用户不存在' });
    } else if (targetType === 'comment') {
      const comment = db.prepare('SELECT id FROM comments WHERE id = ?').get(tid);
      if (!comment) return res.json({ code: -1, message: '评论不存在' });
    }

    // 防止重复举报（同一用户对同一目标 24 小时内只能举报一次）
    const existing = db.prepare(
      "SELECT id FROM reports WHERE reporterId = ? AND targetType = ? AND targetId = ? AND createdAt > datetime('now', '-1 day')"
    ).get(reporterId, targetType, tid);
    if (existing) {
      return res.json({ code: -1, message: '你已经举报过该内容，请等待处理' });
    }

    db.prepare(
      'INSERT INTO reports (reporterId, targetType, targetId, reason, description) VALUES (?, ?, ?, ?, ?)'
    ).run(reporterId, targetType, tid, reason, (description || '').trim().substring(0, 500));

    logger.info(`举报提交: reporter=${reporterId}, target=${targetType}:${tid}, reason=${reason}`);

    // 被举报用户扣信誉分（仅针对用户类型举报）
    if (targetType === 'user') {
      creditForReported(tid);
    } else if (targetType === 'team') {
      // 组局被举报，扣队长信誉分
      const team = db.prepare('SELECT leaderId FROM teams WHERE id = ?').get(tid);
      if (team) creditForReported(team.leaderId);
    }

    res.json({ code: 0, message: '举报已提交，我们会尽快处理' });
  } catch (err) {
    logger.error(`举报提交失败: ${err.message}`);
    res.json({ code: -1, message: '举报失败' });
  }
});

/**
 * GET /api/reports
 * 管理员获取举报列表（带分页）
 */
router.get('/', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const status = req.query.status || 'pending';   // pending | resolved | dismissed | all
    const offset = (page - 1) * pageSize;

    let whereSql = '';
    const countParams = [];
    const listParams = [];

    if (status !== 'all') {
      whereSql = 'WHERE r.status = ?';
      countParams.push(status);
      listParams.push(status);
    }

    const totalRow = db.prepare(`SELECT COUNT(*) as total FROM reports r ${whereSql}`).get(...countParams);
    const total = totalRow ? totalRow.total : 0;

    listParams.push(pageSize, offset);
    const rows = db.prepare(`
      SELECT r.*,
             u.nickname as reporterName, u.avatarUrl as reporterAvatar
      FROM reports r
      LEFT JOIN users u ON r.reporterId = u.id
      ${whereSql}
      ORDER BY r.createdAt DESC
      LIMIT ? OFFSET ?
    `).all(...listParams);

    // 补充被举报目标信息
    const enriched = rows.map(row => {
      let targetInfo = null;
      if (row.targetType === 'team') {
        targetInfo = db.prepare('SELECT id, title, status, leaderId FROM teams WHERE id = ?').get(row.targetId);
      } else if (row.targetType === 'user') {
        targetInfo = db.prepare('SELECT id, nickname, avatarUrl, creditScore FROM users WHERE id = ?').get(row.targetId);
      } else if (row.targetType === 'comment') {
        targetInfo = db.prepare('SELECT id, content, userId, teamId FROM comments WHERE id = ?').get(row.targetId);
      }
      return { ...row, targetInfo };
    });

    res.json({
      code: 0,
      data: {
        list: enriched,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      },
    });
  } catch (err) {
    logger.error(`获取举报列表失败: ${err.message}`);
    res.json({ code: -1, message: '获取举报列表失败' });
  }
});

/**
 * PUT /api/reports/:id
 * 管理员处理举报（resolved=确认违规 / dismissed=驳回）
 */
router.put('/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const reportId = parseInt(req.params.id);
    const { action, note } = req.body;   // action: 'resolved' | 'dismissed'

    if (!['resolved', 'dismissed'].includes(action)) {
      return res.json({ code: -1, message: '操作类型无效，需为 resolved 或 dismissed' });
    }

    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
    if (!report) return res.json({ code: -1, message: '举报不存在' });
    if (report.status !== 'pending') {
      return res.json({ code: -1, message: '该举报已处理' });
    }

    db.prepare(
      "UPDATE reports SET status = ?, resolvedAt = datetime('now') WHERE id = ?"
    ).run(action, reportId);

    // 如果确认违规（resolved），可执行后续惩罚
    if (action === 'resolved') {
      if (report.targetType === 'team') {
        // 组局被确认违规 → 自动取消
        const team = db.prepare('SELECT id, status FROM teams WHERE id = ?').get(report.targetId);
        if (team && team.status === 'recruiting') {
          db.prepare("UPDATE teams SET status = 'cancelled', updatedAt = datetime('now') WHERE id = ?").run(report.targetId);
          logger.info(`管理员处理: 组局 ${report.targetId} 被取消（举报确认违规）`);
        }
      } else if (report.targetType === 'comment') {
        // 评论被确认违规 → 删除
        db.prepare('DELETE FROM comments WHERE id = ?').run(report.targetId);
        logger.info(`管理员处理: 评论 ${report.targetId} 被删除（举报确认违规）`);
      }
      // 对用户类型：记录处理结果，具体惩罚需人工判断
    }

    logger.info(`举报处理: id=${reportId} action=${action} admin=${req.user.id}`);
    res.json({ code: 0, message: action === 'resolved' ? '已确认违规' : '已驳回举报' });
  } catch (err) {
    logger.error(`处理举报失败: ${err.message}`);
    res.json({ code: -1, message: '处理举报失败' });
  }
});

module.exports = router;
