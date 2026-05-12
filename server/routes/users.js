const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const logger = require('../utils/logger');
const { loginLimiter, writeLimiter, checkSensitiveEnhanced } = require('../utils/security');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'sport-mini-secret';
const WX_APPID = process.env.WX_APPID;
const WX_SECRET = process.env.WX_SECRET;

/**
 * 生成 JWT
 */
function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

/**
 * 鉴权中间件
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({ code: 401, message: '未登录' });
  }
  try {
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
    if (!user) {
      return res.json({ code: 401, message: '用户不存在' });
    }
    if (user.isDeleted) {
      return res.json({ code: 401, message: '账号已注销' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.json({ code: 401, message: '登录已过期，请重新登录' });
  }
}

/**
 * POST /api/users/login
 * 微信登录（code2session）
 */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.json({ code: -1, message: '缺少 code 参数' });
    }

    // 调用微信 code2session 接口
    let openid;
    if (WX_APPID && WX_SECRET && WX_SECRET !== 'your_app_secret_here') {
      const wxRes = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
        params: {
          appid: WX_APPID,
          secret: WX_SECRET,
          js_code: code,
          grant_type: 'authorization_code',
        },
        timeout: 10000,
      });
      if (wxRes.data.errcode) {
        return res.json({ code: -1, message: `微信登录失败: ${wxRes.data.errmsg}` });
      }
      openid = wxRes.data.openid;
    } else {
      // 开发模式：用 code 作为 mock openid
      openid = `dev_${code}`;
      console.log('[开发模式] 使用 mock openid:', openid);
    }

    // 查找或创建用户
    let user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
    if (!user) {
      const info = db.prepare(
        'INSERT INTO users (openid, nickname, avatarUrl) VALUES (?, ?, ?)'
      ).run(openid, '微信用户', '');
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    }

    // 生成 JWT
    const token = signToken(user.id);

    // 返回用户信息（脱敏）
    const userInfo = {
      id: user.id,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      creditScore: user.creditScore,
    };

    res.json({
      code: 0,
      data: { token, userInfo },
      message: 'ok',
    });
  } catch (err) {
    console.error('[登录] 错误:', err.message);
    res.json({ code: -1, message: '登录服务异常' });
  }
});

/**
 * GET /api/users/me
 * 获取当前用户信息
 */
router.get('/me', authMiddleware, (req, res) => {
  const user = req.user;
  res.json({
    code: 0,
    data: {
      id: user.id,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      creditScore: user.creditScore,
      phone: user.phone,
      sportPrefs: user.sportPrefs || '',
    },
  });
});

/**
 * PUT /api/users/me
 * 更新用户信息（头像、昵称）
 */
router.put('/me', authMiddleware, writeLimiter, async (req, res) => {
  const { nickname, avatarUrl, sportPrefs } = req.body;
  const updates = [];
  const params = [];

  if (nickname !== undefined) {
    // 增强敏感词检查（本地 + 微信云端）
    const check = await checkSensitiveEnhanced(nickname);
    if (!check.pass) {
      return res.json({ code: -1, message: '昵称包含违规内容，请修改' });
    }
    updates.push('nickname = ?');
    params.push(nickname);
  }
  if (avatarUrl !== undefined) {
    updates.push('avatarUrl = ?');
    params.push(avatarUrl);
  }
  if (sportPrefs !== undefined) {
    updates.push('sportPrefs = ?');
    params.push(typeof sportPrefs === 'string' ? sportPrefs : JSON.stringify(sportPrefs));
  }

  if (updates.length === 0) {
    return res.json({ code: -1, message: '没有要更新的字段' });
  }

  updates.push("updatedAt = datetime('now')");
  params.push(req.user.id);

  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({
    code: 0,
    data: {
      id: user.id,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      creditScore: user.creditScore,
      sportPrefs: user.sportPrefs || '',
    },
  });
});

/**
 * GET /api/users/:id
 * 获取用户公开资料（不需要登录）
 */
router.get('/:id', (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) return res.json({ code: -1, message: '参数错误' });

    const user = db.prepare('SELECT id, nickname, avatarUrl, creditScore, sportPrefs, createdAt FROM users WHERE id = ? AND (isDeleted IS NULL OR isDeleted = 0)').get(userId);
    if (!user) return res.json({ code: -1, message: '用户不存在' });

    // 解析运动偏好
    let sportPrefs = [];
    try {
      if (user.sportPrefs) sportPrefs = JSON.parse(user.sportPrefs);
    } catch (e) {}

    // 发起的组局（最近 10 个）
    const createdTeams = db.prepare(
      "SELECT id, sportType, title, locationName, startTime, maxMembers, currentMembers, status FROM teams WHERE leaderId = ? ORDER BY createdAt DESC LIMIT 10"
    ).all(userId);

    // 参加的组局（最近 10 个，排除自己发起的）
    const joinedTeams = db.prepare(
      "SELECT t.id, t.sportType, t.title, t.locationName, t.startTime, t.maxMembers, t.currentMembers, t.status FROM team_members tm JOIN teams t ON tm.teamId = t.id WHERE tm.userId = ? AND t.leaderId != ? ORDER BY tm.joinedAt DESC LIMIT 10"
    ).all(userId, userId);

    // 统计
    const createdCount = db.prepare('SELECT COUNT(*) as cnt FROM teams WHERE leaderId = ?').get(userId).cnt;
    const joinedCount = db.prepare("SELECT COUNT(*) as cnt FROM team_members WHERE userId = ? AND teamId NOT IN (SELECT id FROM teams WHERE leaderId = ?)").get(userId, userId).cnt;

    const formatTeam = (t) => ({
      _id: t.id,
      sportType: t.sportType,
      title: t.title,
      venueName: t.locationName,
      startTime: t.startTime,
      maxMembers: t.maxMembers,
      currentMembers: t.currentMembers,
      status: t.status,
    });

    res.json({
      code: 0,
      data: {
        id: user.id,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        creditScore: user.creditScore,
        sportPrefs,
        createdAt: user.createdAt,
        stats: { createdCount, joinedCount },
        createdTeams: createdTeams.map(formatTeam),
        joinedTeams: joinedTeams.map(formatTeam),
      },
    });
  } catch (err) {
    logger.error(`[用户资料] error: ${err.message}`);
    res.json({ code: -1, message: '加载失败' });
  }
});

/**
 * POST /api/users/delete-account
 * 账号注销（软删除）
 * - 标记用户 isDeleted=1
 * - 匿名化昵称和头像
 * - 退出所有已加入的组局
 * - 删除收藏
 */
router.post('/delete-account', authMiddleware, writeLimiter, (req, res) => {
  try {
    const userId = req.user.id;
    const { confirmText } = req.body;

    if (confirmText !== '确认注销') {
      return res.json({ code: -1, message: '请输入"确认注销"以完成操作' });
    }

    // 匿名化用户信息
    db.prepare("UPDATE users SET isDeleted = 1, nickname = '已注销用户', avatarUrl = '', phone = '', sportPrefs = '', updatedAt = datetime('now') WHERE id = ?").run(userId);

    // 退出所有非队长的组局
    const memberships = db.prepare("SELECT * FROM team_members WHERE userId = ? AND role != 'leader'").all(userId);
    memberships.forEach(m => {
      db.prepare('DELETE FROM team_members WHERE id = ?').run(m.id);
      db.prepare("UPDATE teams SET currentMembers = MAX(currentMembers - 1, 1), updatedAt = datetime('now') WHERE id = ?").run(m.teamId);
    });

    // 删除收藏
    db.prepare('DELETE FROM favorites WHERE userId = ?').run(userId);

    // 清除通知
    db.prepare('DELETE FROM notifications WHERE userId = ?').run(userId);

    logger.info(`用户注销: userId=${userId}`);

    res.json({ code: 0, message: '账号已注销' });
  } catch (err) {
    logger.error(`账号注销失败: ${err.message}`);
    res.json({ code: -1, message: '注销失败' });
  }
});

module.exports = router;
module.exports.authMiddleware = authMiddleware;

/**
 * 管理员中间件（需先经过 authMiddleware）
 * 管理员名单由环境变量 ADMIN_OPENIDS 指定（逗号分隔的 openid 列表）
 */
const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);

function adminMiddleware(req, res, next) {
  if (!req.user) return res.json({ code: 401, message: '未登录' });
  if (ADMIN_OPENIDS.length === 0) {
    // 未配置管理员名单时，开发模式下默认允许，生产模式拒绝
    if (process.env.NODE_ENV === 'production') {
      return res.json({ code: 403, message: '未配置管理员权限' });
    }
    // 开发模式放行（便于测试）
    return next();
  }
  if (!ADMIN_OPENIDS.includes(req.user.openid)) {
    return res.json({ code: 403, message: '无管理员权限' });
  }
  next();
}

module.exports.adminMiddleware = adminMiddleware;
