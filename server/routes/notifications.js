const express = require('express');
const db = require('../db/database');
const { authMiddleware } = require('./users');
const router = express.Router();

/**
 * GET /api/notifications
 * 获取当前用户的通知列表
 */
router.get('/', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, pageSize = 20, unreadOnly } = req.query;

    let sql = 'SELECT * FROM notifications WHERE userId = ?';
    const params = [userId];
    if (unreadOnly === '1') {
      sql += ' AND isRead = 0';
    }
    sql += ' ORDER BY createdAt DESC';

    const all = db.prepare(sql).all(...params);
    const pageNum = Math.max(1, parseInt(page));
    const sizeNum = Math.min(50, parseInt(pageSize));
    const total = all.length;
    const start = (pageNum - 1) * sizeNum;
    const list = all.slice(start, start + sizeNum);

    // 未读数
    const unreadRow = db.prepare('SELECT COUNT(*) as cnt FROM notifications WHERE userId = ? AND isRead = 0').get(userId);
    const unreadCount = unreadRow ? unreadRow.cnt : 0;

    res.json({ code: 0, data: { list, unreadCount, pagination: { page: pageNum, pageSize: sizeNum, total } } });
  } catch (err) {
    console.error('[notifications list] error:', err.message);
    res.json({ code: -1, message: '加载失败' });
  }
});

/**
 * POST /api/notifications/read
 * 标记通知为已读
 */
router.post('/read', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const { ids } = req.body;

    if (ids && Array.isArray(ids) && ids.length > 0) {
      // 标记指定通知
      const placeholders = ids.map(() => '?').join(',');
      db.prepare('UPDATE notifications SET isRead = 1 WHERE userId = ? AND id IN (' + placeholders + ')').run(userId, ...ids);
    } else {
      // 全部标记已读
      db.prepare('UPDATE notifications SET isRead = 1 WHERE userId = ? AND isRead = 0').run(userId);
    }

    const unreadRow = db.prepare('SELECT COUNT(*) as cnt FROM notifications WHERE userId = ? AND isRead = 0').get(userId);
    res.json({ code: 0, data: { unreadCount: unreadRow ? unreadRow.cnt : 0 } });
  } catch (err) {
    console.error('[notifications read] error:', err.message);
    res.json({ code: -1, message: '操作失败' });
  }
});

/**
 * POST /api/notifications/read-all
 * 全部标记已读（快捷方式）
 */
router.post('/read-all', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    db.prepare('UPDATE notifications SET isRead = 1 WHERE userId = ? AND isRead = 0').run(userId);
    res.json({ code: 0, data: { unreadCount: 0 } });
  } catch (err) {
    console.error('[notifications read-all] error:', err.message);
    res.json({ code: -1, message: '操作失败' });
  }
});

module.exports = router;
