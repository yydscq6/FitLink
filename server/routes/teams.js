const express = require('express');
const db = require('../db/database');
const { authMiddleware } = require('./users');
const { createNotification } = require('./comments');
const { writeLimiter, checkSensitive, checkSensitiveEnhanced } = require('../utils/security');
const logger = require('../utils/logger');
const { sendStatusChange, getMiniProgramQRCode } = require('../utils/wechatMessage');
const { creditForTeamCompleted } = require('../utils/credit');
const { cache } = require('../utils/cache');
const { trackActivity, calcActiveLevel, calcActiveMatch } = require('../utils/activity');
const router = express.Router();

// ============== 高级筛选：GET /api/teams/nearby 增强 ==============
// 已在下方 /nearby 路由中增加 timeFilter、minSpots、maxDistance 参数支持

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters) {
  if (meters < 1000) return Math.round(meters) + 'm';
  return (meters / 1000).toFixed(1) + 'km';
}

/**
 * 推荐算法：综合评分（五维加权）
 * 维度：运动偏好匹配 > 时间紧迫度 > 距离远近 > 剩余名额 > 活跃度匹配
 *
 * 公式：(0.5 + timeBonus + distScore + spotsBonus + activeMatch × 0.3) × prefMultiplier
 *
 * @param {object} team      - 组局对象（含 distance, spotsLeft, startTime, sportType, maxMembers, leaderCreditScore, createdAt）
 * @param {string[]} prefs   - 用户运动偏好列表（如 ['basketball','running']）
 * @param {'high'|'mid'|'low'|'dormant'} [activeLevel='mid'] - 用户活跃等级
 * @returns {number}         - 综合得分（越高越推荐）
 */
function calcRecommendScore(team, prefs, activeLevel) {
  // 1) 运动偏好匹配（权重最高，鼓励用户尝试偏好运动）
  const prefMultiplier = (prefs.length > 0 && prefs.indexOf(team.sportType) > -1) ? 1.5 : 1.0;

  // 2) 时间紧迫度（活动即将开始时加分，已过期则大幅降权）
  let timeBonus = 0;
  if (team.startTime) {
    const hoursUntil = (new Date(team.startTime).getTime() - Date.now()) / 3600000;
    if (hoursUntil >= 0 && hoursUntil <= 4) {
      // 0~4小时内：最高紧迫度
      timeBonus = 1.0 - (hoursUntil / 4) * 0.6; // 1.0 → 0.4
    } else if (hoursUntil > 4 && hoursUntil <= 24) {
      // 4~24小时内：中等
      timeBonus = 0.4 * Math.exp(-0.05 * (hoursUntil - 4));
    } else if (hoursUntil > 24 && hoursUntil <= 168) {
      // 1~7天：较低
      timeBonus = 0.15 * Math.exp(-0.005 * (hoursUntil - 24));
    } else if (hoursUntil < 0) {
      // 已过期：惩罚
      timeBonus = -0.5;
    }
  }

  // 3) 距离（越近越好，用对数衰减）
  const distKm = team.distance / 1000;
  const distScore = Math.max(0, 1 - Math.log(1 + distKm) / Math.log(21)); // 0km→1, 5km→0.55, 20km→0

  // 4) 剩余名额充足度（名额越多，越容易加入）
  const spotsRatio = team.maxMembers > 0 ? team.spotsLeft / team.maxMembers : 0;
  const spotsBonus = Math.min(spotsRatio, 1) * 0.15;

  // 5) 活跃度匹配（第五维：根据用户活跃等级差异化推荐策略）
  const activeMatch = calcActiveMatch(team, activeLevel || 'mid');

  // 综合得分（0~3.15 范围）
  const score = (0.5 + timeBonus + distScore + spotsBonus + activeMatch * 0.3) * prefMultiplier;

  return Math.round(score * 1000) / 1000; // 保留3位小数
}

function getTeamDetail(teamId, userId) {
  const team = db.prepare(
    'SELECT t.*, u.nickname as leaderNickname, u.avatarUrl as leaderAvatar, u.creditScore as leaderCredit FROM teams t JOIN users u ON t.leaderId = u.id WHERE t.id = ?'
  ).get(teamId);
  if (!team) return null;
  const members = db.prepare(
    'SELECT tm.*, u.nickname, u.avatarUrl, u.creditScore FROM team_members tm JOIN users u ON tm.userId = u.id WHERE tm.teamId = ? ORDER BY tm.joinedAt ASC'
  ).all(teamId);
  const isLeader = userId ? team.leaderId === userId : false;
  const isJoined = userId ? members.some(m => m.userId === userId) : false;
  return {
    _id: team.id, sportType: team.sportType, title: team.title, description: team.description,
    tags: (() => { try { return JSON.parse(team.tags || '[]'); } catch(e) { return []; } })(),
    venueName: team.locationName,
    location: { name: team.locationName, address: team.locationAddr, longitude: team.longitude, latitude: team.latitude },
    startTime: team.startTime, endTime: team.endTime, maxMembers: team.maxMembers,
    currentMembers: team.currentMembers, fee: team.fee, contact: team.contact,
    coverImage: team.coverImage || '',
    status: team.status, createdAt: team.createdAt,
    leaderId: { _id: team.leaderId, nickname: team.leaderNickname, avatarUrl: team.leaderAvatar, creditScore: team.leaderCredit },
    members: members.map(m => ({ _id: m.id, userId: { _id: m.userId, nickname: m.nickname, avatarUrl: m.avatarUrl }, joinedAt: m.joinedAt, role: m.role })),
    isLeader, isJoined,
  };
}

// GET /api/teams/nearby
// 支持高级筛选参数：timeFilter(today/tomorrow/week), minSpots(最少剩余名额), maxDistance(最大距离km)
// mode=recommended 时启用智能推荐算法（综合偏好、距离、时间、名额评分排序）
router.get('/nearby', (req, res) => {
  try {
    const { longitude, latitude, radius = 5000, page = 1, pageSize = 20, sportType, timeFilter, minSpots, maxDistance, tag, mode } = req.query;
    const lng = parseFloat(longitude);
    const lat = parseFloat(latitude);
    if (isNaN(lng) || isNaN(lat)) return res.json({ code: -1, message: '经纬度参数错误' });

    const isRecommended = mode === 'recommended';

    // 解析用户身份 & 运动偏好 & 活跃等级（推荐模式需要）
    let userId = null;
    let userPrefs = [];
    let userActiveLevel = 'mid';
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET || 'sport-mini-secret');
        userId = decoded.userId;
        // 追踪用户活跃
        trackActivity(userId);
        // 获取用户运动偏好 & 活跃等级（推荐模式需要）
        if (isRecommended) {
          const user = db.prepare('SELECT id, sportPrefs, lastActiveAt FROM users WHERE id = ?').get(userId);
          if (user) {
            if (user.sportPrefs) {
              try { userPrefs = JSON.parse(user.sportPrefs); } catch (e) { userPrefs = []; }
            }
            // 计算第五维：活跃度等级
            userActiveLevel = calcActiveLevel(user);
          }
        }
      } catch (e) {}
    }

    // 缓存键（推荐模式因人而异，需包含 userId；默认模式同一街区共享）
    const cacheKey = isRecommended
      ? `nearby:rec:${userId || 'anon'}:${Math.round(lng*100)/100},${Math.round(lat*100)/100}:${sportType||'all'}:${timeFilter||'all'}:${tag||''}:${page}:${pageSize}`
      : `nearby:${Math.round(lng*100)/100},${Math.round(lat*100)/100}:${sportType||'all'}:${timeFilter||'all'}:${tag||''}:${page}:${pageSize}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const delta = 0.5;
    let sql = 'SELECT t.*, u.nickname as leaderNickname, u.avatarUrl as leaderAvatar, u.creditScore as leaderCredit FROM teams t JOIN users u ON t.leaderId = u.id WHERE t.longitude BETWEEN ? AND ? AND t.latitude BETWEEN ? AND ? AND t.status != "cancelled"';
    const params = [lng - delta, lng + delta, lat - delta, lat + delta];
    if (sportType && sportType !== 'all') { sql += ' AND t.sportType = ?'; params.push(sportType); }

    // 时间筛选
    if (timeFilter === 'today') {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
      sql += ' AND t.startTime >= ? AND t.startTime <= ?';
      params.push(todayStart.toISOString(), todayEnd.toISOString());
    } else if (timeFilter === 'tomorrow') {
      const tmr = new Date(); tmr.setDate(tmr.getDate() + 1); tmr.setHours(0, 0, 0, 0);
      const tmrEnd = new Date(tmr); tmrEnd.setHours(23, 59, 59, 999);
      sql += ' AND t.startTime >= ? AND t.startTime <= ?';
      params.push(tmr.toISOString(), tmrEnd.toISOString());
    } else if (timeFilter === 'week') {
      const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7); weekEnd.setHours(23, 59, 59, 999);
      sql += ' AND t.startTime <= ?';
      params.push(weekEnd.toISOString());
    }

    // 最少剩余名额
    const spots = parseInt(minSpots);
    if (!isNaN(spots) && spots > 0) {
      sql += ' AND (t.maxMembers - t.currentMembers) >= ?';
      params.push(spots);
    }

    // 标签筛选
    if (tag) {
      sql += ' AND t.tags LIKE ?';
      params.push('%"' + tag + '"%');
    }

    // 推荐模式不限制数据库排序，后面按评分排序；默认按创建时间
    if (!isRecommended) {
      sql += ' ORDER BY t.createdAt DESC';
    }
    const teams = db.prepare(sql).all(...params);

    let radiusNum = parseFloat(radius);
    const maxDist = parseFloat(maxDistance);
    if (!isNaN(maxDist) && maxDist > 0) {
      radiusNum = Math.min(radiusNum, maxDist * 1000);
    }

    const enriched = teams.map(t => {
      const dist = haversine(lat, lng, t.latitude, t.longitude);
      const item = {
        _id: t.id, sportType: t.sportType, title: t.title, description: t.description,
        tags: (() => { try { return JSON.parse(t.tags || '[]'); } catch(e) { return []; } })(),
        venueName: t.locationName, startTime: t.startTime, endTime: t.endTime,
        maxMembers: t.maxMembers, currentMembers: t.currentMembers, fee: t.fee,
        contact: t.contact, coverImage: t.coverImage || '', status: t.status, createdAt: t.createdAt,
        distance: dist, distanceText: formatDistance(dist),
        spotsLeft: t.maxMembers - t.currentMembers,
        leaderId: { _id: t.leaderId, nickname: t.leaderNickname, avatarUrl: t.leaderAvatar, creditScore: t.leaderCredit },
      };
      // 推荐模式计算五维综合评分
      if (isRecommended) {
        item.leaderCreditScore = t.leaderCredit;
        item.score = calcRecommendScore(item, userPrefs, userActiveLevel);
      }
      return item;
    }).filter(t => t.distance <= radiusNum);

    // 排序：推荐模式按综合评分降序，默认按距离升序
    if (isRecommended) {
      enriched.sort((a, b) => b.score - a.score);
    } else {
      enriched.sort((a, b) => a.distance - b.distance);
    }

    // 返回 favoriteIds 供客户端判断收藏状态
    let favoriteIds = [];
    if (userId) {
      const favs = db.prepare('SELECT teamId FROM favorites WHERE userId = ?').all(userId);
      favoriteIds = favs.map(f => f.teamId);
    }

    const pageNum = Math.max(1, parseInt(page));
    const sizeNum = Math.min(50, Math.max(1, parseInt(pageSize)));
    const total = enriched.length;
    const start = (pageNum - 1) * sizeNum;
    const list = enriched.slice(start, start + sizeNum);
    const modeData = { list, pagination: { page: pageNum, pageSize: sizeNum, total }, favoriteIds, mode: isRecommended ? 'recommended' : 'distance' };
    if (isRecommended && userId) {
      modeData.activeLevel = userActiveLevel;
    }
    const result = { code: 0, data: { data: modeData } };
    cache.set(cacheKey, result, 15000);   // 缓存 15 秒
    res.json(result);
  } catch (err) {
    console.error('[nearby] error:', err.message);
    res.json({ code: -1, message: '加载失败' });
  }
});

// GET /api/teams/my/created
router.get('/my/created', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, pageSize = 20, status } = req.query;
    let sql = 'SELECT t.* FROM teams t WHERE t.leaderId = ?';
    const params = [userId];
    if (status && status !== 'all') { sql += ' AND t.status = ?'; params.push(status); }
    sql += ' ORDER BY t.createdAt DESC';
    const teams = db.prepare(sql).all(...params);
    const pageNum = Math.max(1, parseInt(page));
    const sizeNum = Math.min(50, parseInt(pageSize));
    const total = teams.length;
    const start = (pageNum - 1) * sizeNum;
    const list = teams.slice(start, start + sizeNum).map(t => ({
      _id: t.id, sportType: t.sportType, title: t.title, venueName: t.locationName,
      tags: (() => { try { return JSON.parse(t.tags || '[]'); } catch(e) { return []; } })(),
      startTime: t.startTime, endTime: t.endTime, maxMembers: t.maxMembers,
      currentMembers: t.currentMembers, status: t.status, createdAt: t.createdAt,
    }));
    res.json({ code: 0, data: { list, pagination: { page: pageNum, pageSize: sizeNum, total } } });
  } catch (err) {
    console.error('[my/created] error:', err.message);
    res.json({ code: -1, message: '加载失败' });
  }
});

// GET /api/teams/my/joined
router.get('/my/joined', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, pageSize = 20 } = req.query;
    const teams = db.prepare(
      'SELECT t.*, u.nickname as leaderNickname, u.avatarUrl as leaderAvatar, u.creditScore as leaderCredit FROM team_members tm JOIN teams t ON tm.teamId = t.id JOIN users u ON t.leaderId = u.id WHERE tm.userId = ? AND tm.role != "leader" ORDER BY tm.joinedAt DESC'
    ).all(userId);
    const pageNum = Math.max(1, parseInt(page));
    const sizeNum = Math.min(50, parseInt(pageSize));
    const total = teams.length;
    const start = (pageNum - 1) * sizeNum;
    const list = teams.slice(start, start + sizeNum).map(t => ({
      _id: t.id, sportType: t.sportType, title: t.title, venueName: t.locationName,
      tags: (() => { try { return JSON.parse(t.tags || '[]'); } catch(e) { return []; } })(),
      startTime: t.startTime, endTime: t.endTime, maxMembers: t.maxMembers,
      currentMembers: t.currentMembers, status: t.status, createdAt: t.createdAt,
      leaderId: { _id: t.leaderId, nickname: t.leaderNickname, avatarUrl: t.leaderAvatar, creditScore: t.leaderCredit },
    }));
    res.json({ code: 0, data: { list, pagination: { page: pageNum, pageSize: sizeNum, total } } });
  } catch (err) {
    console.error('[my/joined] error:', err.message);
    res.json({ code: -1, message: '加载失败' });
  }
});

// GET /api/teams/:id
router.get('/:id', (req, res) => {
  try {
    const teamId = parseInt(req.params.id);
    if (isNaN(teamId)) return res.json({ code: -1, message: '参数错误' });
    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET || 'sport-mini-secret');
        userId = decoded.userId;
      } catch (e) {}
    }

    // 详情缓存（不含收藏状态，收藏状态单独处理）
    const cacheKey = `team:${teamId}`;
    let team = cache.get(cacheKey);
    if (!team) {
      team = getTeamDetail(teamId, userId);
      if (!team) return res.json({ code: -1, message: '组局不存在' });
      cache.set(cacheKey, team, 60000);   // 缓存 60 秒
    }
    // 收藏状态不缓存（用户维度）
    if (userId) {
      trackActivity(userId);
      const fav = db.prepare('SELECT id FROM favorites WHERE userId = ? AND teamId = ?').get(userId, teamId);
      team = { ...team, isFavorited: !!fav };
    } else {
      team = { ...team, isFavorited: false };
    }
    res.json({ code: 0, data: team });
  } catch (err) {
    console.error('[team detail] error:', err.message);
    res.json({ code: -1, message: '加载失败' });
  }
});

// POST /api/teams
router.post('/', authMiddleware, writeLimiter, async (req, res) => {
  try {
    const { sportType, title, description, location, activityTime, endTime, maxMembers, fee, contact, coverImage, tags, forceCreate } = req.body;
    if (!title || !title.trim()) return res.json({ code: -1, message: '请输入标题' });
    if (title.trim().length > 50) return res.json({ code: -1, message: '标题不能超过50字' });

    // 增强敏感词检查（本地 + 微信云端）
    const titleCheck = await checkSensitiveEnhanced(title);
    if (!titleCheck.pass) return res.json({ code: -1, message: '标题包含违规内容，请修改' });
    if (description) {
      const descCheck = await checkSensitiveEnhanced(description);
      if (!descCheck.pass) return res.json({ code: -1, message: '描述包含违规内容，请修改' });
    }
    if (!location || !location.longitude || !location.latitude) return res.json({ code: -1, message: '请选择活动地点' });
    if (!activityTime) return res.json({ code: -1, message: '请选择活动时间' });
    const max = parseInt(maxMembers);
    if (isNaN(max) || max < 2 || max > 100) return res.json({ code: -1, message: '人数上限需在2-100之间' });
    const start = new Date(activityTime);

    // 计算结束时间：支持自定义 endTime，否则默认 +2小时
    let end;
    if (endTime) {
      end = new Date(endTime);
      if (isNaN(end.getTime()) || end <= start) {
        return res.json({ code: -1, message: '结束时间必须晚于开始时间' });
      }
    } else {
      end = new Date(start.getTime() + 2 * 3600 * 1000);
    }

    // 重复组局检测（同运动类型 + ±4小时窗口 + 招募中）
    if (!forceCreate) {
      const windowStart = new Date(start.getTime() - 4 * 3600 * 1000).toISOString();
      const windowEnd = new Date(start.getTime() + 4 * 3600 * 1000).toISOString();
      const duplicate = db.prepare(
        "SELECT id, title, startTime FROM teams WHERE leaderId = ? AND sportType = ? AND status = 'recruiting' AND startTime >= ? AND startTime <= ? LIMIT 1"
      ).get(req.user.id, sportType || 'other', windowStart, windowEnd);
      if (duplicate) {
        const dupTime = new Date(duplicate.startTime);
        const timeStr = `${dupTime.getMonth() + 1}月${dupTime.getDate()}日 ${String(dupTime.getHours()).padStart(2, '0')}:${String(dupTime.getMinutes()).padStart(2, '0')}`;
        return res.json({
          code: -2,
          message: `你在 ${timeStr} 已有一个「${duplicate.title}」的组局，是否仍要创建？`,
          data: { duplicateId: duplicate.id },
        });
      }
    }

    // 标签：校验并序列化
    const VALID_TAGS = ['新手友好', '高手局', 'AA制', '免费', '长期约', '周末常约', '工作日约', '女性专场', '男性专场', '学生局', '养生局', '竞技局'];
    let tagsStr = '[]';
    if (Array.isArray(tags) && tags.length > 0) {
      const filtered = tags.filter(t => VALID_TAGS.includes(t)).slice(0, 5);
      tagsStr = JSON.stringify(filtered);
    }
    const info = db.prepare(
      "INSERT INTO teams (leaderId, sportType, title, description, locationName, locationAddr, longitude, latitude, startTime, endTime, maxMembers, fee, contact, coverImage, tags, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recruiting')"
    ).run(req.user.id, sportType || 'other', title.trim(), (description || '').trim(), location.name || '', location.address || location.name || '', location.longitude, location.latitude, start.toISOString(), end.toISOString(), max, fee || '免费', (contact || '').trim(), (coverImage || '').trim(), tagsStr);
    db.prepare("INSERT INTO team_members (teamId, userId, role) VALUES (?, ?, 'leader')").run(info.lastInsertRowid, req.user.id);
    trackActivity(req.user.id);
    const team = getTeamDetail(info.lastInsertRowid, req.user.id);
    cache.delByPrefix('nearby');   // 新组局，刷新附近列表缓存
    res.json({ code: 0, data: team, message: '发布成功' });
  } catch (err) {
    console.error('[create team] error:', err.message);
    res.json({ code: -1, message: '发布失败' });
  }
});

// POST /api/teams/:id/join
router.post('/:id/join', authMiddleware, writeLimiter, (req, res) => {
  try {
    const teamId = parseInt(req.params.id);
    const userId = req.user.id;
    const { forceJoin } = req.body || {};
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
    if (!team) return res.json({ code: -1, message: '组局不存在' });
    if (team.status !== 'recruiting') return res.json({ code: -1, message: '该组局不在招募中' });
    if (team.currentMembers >= team.maxMembers) return res.json({ code: -1, message: '人数已满' });
    const existing = db.prepare('SELECT * FROM team_members WHERE teamId = ? AND userId = ?').get(teamId, userId);
    if (existing) return res.json({ code: -1, message: '你已经加入了该组局' });

    // 时间冲突检测（可跳过）
    if (!forceJoin && team.startTime && team.endTime) {
      const conflict = db.prepare(
        "SELECT t.id, t.title, t.startTime, t.endTime FROM team_members tm JOIN teams t ON tm.teamId = t.id WHERE tm.userId = ? AND t.id != ? AND t.status = 'recruiting' AND t.startTime < ? AND t.endTime > ? LIMIT 1"
      ).get(userId, teamId, team.endTime, team.startTime);
      if (conflict) {
        const ct = new Date(conflict.startTime);
        const timeStr = `${ct.getMonth() + 1}月${ct.getDate()}日 ${String(ct.getHours()).padStart(2, '0')}:${String(ct.getMinutes()).padStart(2, '0')}`;
        return res.json({
          code: -2,
          message: `你已加入的「${conflict.title}」（${timeStr}）与此组局时间冲突，是否仍要加入？`,
          data: { conflictId: conflict.id },
        });
      }
    }

    db.prepare("INSERT INTO team_members (teamId, userId, role) VALUES (?, ?, 'member')").run(teamId, userId);
    trackActivity(userId);
    const newCount = team.currentMembers + 1;
    // 满员自动关闭招募
    if (newCount >= team.maxMembers) {
      db.prepare("UPDATE teams SET currentMembers = ?, status = 'ended', updatedAt = datetime('now') WHERE id = ?").run(newCount, teamId);
    } else {
      db.prepare("UPDATE teams SET currentMembers = ?, updatedAt = datetime('now') WHERE id = ?").run(newCount, teamId);
    }
    // 通知队长
    if (team.leaderId !== userId) {
      const msg = newCount >= team.maxMembers
        ? req.user.nickname + ' 加入了「' + team.title + '」，组局已满员！'
        : req.user.nickname + ' 加入了「' + team.title + '」';
      createNotification(team.leaderId, 'join', '新成员加入', msg, teamId);
    }
    // 满员时通知全体队员（组局成功 🎉）
    if (newCount >= team.maxMembers) {
      const allMembers = db.prepare('SELECT userId FROM team_members WHERE teamId = ?').all(teamId);
      allMembers.forEach(m => {
        if (m.userId !== userId) {
          createNotification(
            m.userId,
            'match_success',
            '🎉 组局成功',
            '「' + team.title + '」已满员 ' + newCount + '/' + team.maxMembers + '，活动即将开始！',
            teamId,
          );
        }
      });
    }
    cache.del(`team:${teamId}`);
    cache.delByPrefix('nearby');
    const detail = getTeamDetail(teamId, userId);
    res.json({ code: 0, data: detail, message: '加入成功' });
  } catch (err) {
    console.error('[join] error:', err.message);
    res.json({ code: -1, message: '加入失败' });
  }
});

// POST /api/teams/:id/quit
router.post('/:id/quit', authMiddleware, (req, res) => {
  try {
    const teamId = parseInt(req.params.id);
    const userId = req.user.id;
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
    if (!team) return res.json({ code: -1, message: '组局不存在' });
    if (team.leaderId === userId) return res.json({ code: -1, message: '队长不能退出，请先转让或取消组局' });
    if (team.status === 'cancelled') return res.json({ code: -1, message: '组局已取消，无法退出' });
    const member = db.prepare('SELECT * FROM team_members WHERE teamId = ? AND userId = ?').get(teamId, userId);
    if (!member) return res.json({ code: -1, message: '你未加入该组局' });
    db.prepare('DELETE FROM team_members WHERE teamId = ? AND userId = ?').run(teamId, userId);
    const newCount = Math.max(team.currentMembers - 1, 1);
    // 如果组局因满员自动结束且活动时间未到，退出后自动重新开放招募
    const isFuture = new Date(team.startTime) > new Date();
    if (team.status === 'ended' && isFuture && newCount < team.maxMembers) {
      db.prepare("UPDATE teams SET currentMembers = ?, status = 'recruiting', updatedAt = datetime('now') WHERE id = ?").run(newCount, teamId);
    } else {
      db.prepare("UPDATE teams SET currentMembers = ?, updatedAt = datetime('now') WHERE id = ?").run(newCount, teamId);
    }
    // 通知队长
    createNotification(team.leaderId, 'quit', '成员退出', req.user.nickname + ' 退出了「' + team.title + '」', teamId);
    cache.del(`team:${teamId}`);
    cache.delByPrefix('nearby');
    const detail = getTeamDetail(teamId, userId);
    res.json({ code: 0, data: detail, message: '已退出' });
  } catch (err) {
    console.error('[quit] error:', err.message);
    res.json({ code: -1, message: '操作失败' });
  }
});

// ============== 队长管理 ==============

// POST /api/teams/:id/cancel — 队长取消组局
router.post('/:id/cancel', authMiddleware, (req, res) => {
  try {
    const teamId = parseInt(req.params.id);
    const userId = req.user.id;
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
    if (!team) return res.json({ code: -1, message: '组局不存在' });
    if (team.leaderId !== userId) return res.json({ code: -1, message: '只有队长才能取消组局' });
    if (team.status === 'cancelled') return res.json({ code: -1, message: '组局已取消' });
    if (team.status === 'ended') return res.json({ code: -1, message: '组局已结束' });

    db.prepare("UPDATE teams SET status = 'cancelled', updatedAt = datetime('now') WHERE id = ?").run(teamId);

    // 通知所有队员（内站 + 微信推送）
    const members = db.prepare('SELECT tm.userId, u.openid FROM team_members tm JOIN users u ON tm.userId = u.id WHERE tm.teamId = ? AND tm.userId != ?').all(teamId, userId);
    members.forEach(m => {
      createNotification(m.userId, 'cancelled', '组局已取消', '「' + team.title + '」已被队长取消', teamId);
      if (m.openid && !m.openid.startsWith('dev_')) {
        sendStatusChange(m.openid, team.title, '已被队长取消', teamId).catch(() => {});
      }
    });

    const detail = getTeamDetail(teamId, userId);
    cache.del(`team:${teamId}`);
    cache.delByPrefix('nearby');
    res.json({ code: 0, data: detail, message: '组局已取消' });
  } catch (err) {
    console.error('[cancel] error:', err.message);
    res.json({ code: -1, message: '操作失败' });
  }
});

// POST /api/teams/:id/end — 队长结束组局
router.post('/:id/end', authMiddleware, (req, res) => {
  try {
    const teamId = parseInt(req.params.id);
    const userId = req.user.id;
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
    if (!team) return res.json({ code: -1, message: '组局不存在' });
    if (team.leaderId !== userId) return res.json({ code: -1, message: '只有队长才能结束组局' });
    if (team.status === 'ended') return res.json({ code: -1, message: '组局已结束' });
    if (team.status === 'cancelled') return res.json({ code: -1, message: '组局已取消' });

    db.prepare("UPDATE teams SET status = 'ended', updatedAt = datetime('now') WHERE id = ?").run(teamId);

    // 通知所有队员（内站 + 微信推送）
    const members = db.prepare('SELECT tm.userId, u.openid FROM team_members tm JOIN users u ON tm.userId = u.id WHERE tm.teamId = ? AND tm.userId != ?').all(teamId, userId);
    members.forEach(m => {
      createNotification(m.userId, 'ended', '组局已结束', '「' + team.title + '」已结束，期待下次一起运动', teamId);
      if (m.openid && !m.openid.startsWith('dev_')) {
        sendStatusChange(m.openid, team.title, '已结束，期待下次一起运动', teamId).catch(() => {});
      }
    });

    // 信誉分加分（队长 +2，队员 +1）
    creditForTeamCompleted(teamId);

    const detail = getTeamDetail(teamId, userId);
    cache.del(`team:${teamId}`);
    cache.delByPrefix('nearby');
    res.json({ code: 0, data: detail, message: '组局已结束' });
  } catch (err) {
    console.error('[end] error:', err.message);
    res.json({ code: -1, message: '操作失败' });
  }
});

// PUT /api/teams/:id — 队长编辑组局
router.put('/:id', authMiddleware, writeLimiter, async (req, res) => {
  try {
    const teamId = parseInt(req.params.id);
    const userId = req.user.id;
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
    if (!team) return res.json({ code: -1, message: '组局不存在' });
    if (team.leaderId !== userId) return res.json({ code: -1, message: '只有队长才能编辑组局' });
    if (team.status !== 'recruiting') return res.json({ code: -1, message: '只有招募中的组局才能编辑' });

    const { title, description, location, activityTime, endTime, maxMembers, fee, contact, coverImage, tags } = req.body;

    // 验证标题
    if (title !== undefined) {
      if (!title || !title.trim()) return res.json({ code: -1, message: '请输入标题' });
      if (title.trim().length > 50) return res.json({ code: -1, message: '标题不能超过50字' });
      const titleCheck = await checkSensitiveEnhanced(title);
      if (!titleCheck.pass) return res.json({ code: -1, message: '标题包含违规内容，请修改' });
    }

    // 验证描述
    if (description !== undefined) {
      const descCheck = await checkSensitiveEnhanced(description);
      if (!descCheck.pass) return res.json({ code: -1, message: '描述包含违规内容，请修改' });
    }

    // 验证人数
    if (maxMembers !== undefined) {
      const max = parseInt(maxMembers);
      if (isNaN(max) || max < 2 || max > 100) return res.json({ code: -1, message: '人数上限需在2-100之间' });
      if (max < team.currentMembers) return res.json({ code: -1, message: `人数不能少于当前已加入人数 ${team.currentMembers} 人` });
    }

    // 构建更新字段
    const updates = [];
    const params = [];

    if (title !== undefined) { updates.push('title = ?'); params.push(title.trim()); }
    if (description !== undefined) { updates.push('description = ?'); params.push((description || '').trim()); }
    if (location && location.longitude && location.latitude) {
      updates.push('locationName = ?', 'locationAddr = ?', 'longitude = ?', 'latitude = ?');
      params.push(location.name || '', location.address || location.name || '', location.longitude, location.latitude);
    }
    if (activityTime !== undefined) {
      const start = new Date(activityTime);
      if (!isNaN(start.getTime())) {
        let end;
        if (endTime) {
          end = new Date(endTime);
          if (isNaN(end.getTime()) || end <= start) {
            return res.json({ code: -1, message: '结束时间必须晚于开始时间' });
          }
        } else {
          end = new Date(start.getTime() + 2 * 3600 * 1000);
        }
        updates.push('startTime = ?', 'endTime = ?');
        params.push(start.toISOString(), end.toISOString());
      }
    } else if (endTime !== undefined) {
      // 仅修改结束时间，不改开始时间
      const end = new Date(endTime);
      if (!isNaN(end.getTime())) {
        updates.push('endTime = ?');
        params.push(end.toISOString());
      }
    }
    if (maxMembers !== undefined) { updates.push('maxMembers = ?'); params.push(parseInt(maxMembers)); }
    if (fee !== undefined) { updates.push('fee = ?'); params.push(fee || '免费'); }
    if (contact !== undefined) { updates.push('contact = ?'); params.push((contact || '').trim()); }
    if (coverImage !== undefined) { updates.push('coverImage = ?'); params.push((coverImage || '').trim()); }
    if (tags !== undefined) {
      const VALID_TAGS = ['新手友好', '高手局', 'AA制', '免费', '长期约', '周末常约', '工作日约', '女性专场', '男性专场', '学生局', '养生局', '竞技局'];
      let tagsStr = '[]';
      if (Array.isArray(tags) && tags.length > 0) {
        tagsStr = JSON.stringify(tags.filter(t => VALID_TAGS.includes(t)).slice(0, 5));
      }
      updates.push('tags = ?');
      params.push(tagsStr);
    }

    if (updates.length === 0) return res.json({ code: -1, message: '没有需要更新的内容' });

    updates.push("updatedAt = datetime('now')");
    params.push(teamId);

    db.prepare(`UPDATE teams SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // 记录变更内容，通知队员
    const changedFields = [];
    if (title !== undefined && title.trim() !== team.title) changedFields.push('标题');
    if (location && location.name && location.name !== team.locationName) changedFields.push('地点');
    if (activityTime !== undefined) changedFields.push('时间');
    if (maxMembers !== undefined && parseInt(maxMembers) !== team.maxMembers) changedFields.push('人数');
    if (fee !== undefined && (fee || '免费') !== team.fee) changedFields.push('费用');

    if (changedFields.length > 0) {
      const members = db.prepare('SELECT tm.userId, u.openid FROM team_members tm JOIN users u ON tm.userId = u.id WHERE tm.teamId = ? AND tm.userId != ?').all(teamId, userId);
      const changeText = changedFields.join('、');
      members.forEach(m => {
        createNotification(m.userId, 'update', '组局信息更新', `「${team.title}」的${changeText}已更新，请留意`, teamId);
        if (m.openid && !m.openid.startsWith('dev_')) {
          sendStatusChange(m.openid, team.title, changeText + '已更新', teamId).catch(() => {});
        }
      });
      logger.info(`组局编辑: user=${userId} team=${teamId} changed=${changeText}`);
    }

    cache.del(`team:${teamId}`);
    cache.delByPrefix('nearby');
    const detail = getTeamDetail(teamId, userId);
    res.json({ code: 0, data: detail, message: '编辑成功' });
  } catch (err) {
    logger.error(`[edit team] error: ${err.message}`, { stack: err.stack });
    res.json({ code: -1, message: '编辑失败' });
  }
});

// ============== 收藏功能 ==============

// POST /api/teams/:id/favorite — 收藏/取消收藏
router.post('/:id/favorite', authMiddleware, (req, res) => {
  try {
    const teamId = parseInt(req.params.id);
    const userId = req.user.id;
    const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
    if (!team) return res.json({ code: -1, message: '组局不存在' });

    const existing = db.prepare('SELECT id FROM favorites WHERE userId = ? AND teamId = ?').get(userId, teamId);
    if (existing) {
      db.prepare('DELETE FROM favorites WHERE userId = ? AND teamId = ?').run(userId, teamId);
      res.json({ code: 0, data: { favorited: false }, message: '已取消收藏' });
    } else {
      db.prepare('INSERT INTO favorites (userId, teamId) VALUES (?, ?)').run(userId, teamId);
      res.json({ code: 0, data: { favorited: true }, message: '已收藏' });
    }
  } catch (err) {
    console.error('[favorite] error:', err.message);
    res.json({ code: -1, message: '操作失败' });
  }
});

// GET /api/teams/my/favorites — 获取收藏列表
router.get('/my/favorites', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, pageSize = 20 } = req.query;

    const all = db.prepare(
      'SELECT t.*, u.nickname as leaderNickname, u.avatarUrl as leaderAvatar, u.creditScore as leaderCredit FROM favorites f JOIN teams t ON f.teamId = t.id JOIN users u ON t.leaderId = u.id WHERE f.userId = ? ORDER BY f.createdAt DESC'
    ).all(userId);

    const pageNum = Math.max(1, parseInt(page));
    const sizeNum = Math.min(50, parseInt(pageSize));
    const total = all.length;
    const start = (pageNum - 1) * sizeNum;
    const list = all.slice(start, start + sizeNum).map(t => ({
      _id: t.id, sportType: t.sportType, title: t.title, venueName: t.locationName,
      tags: (() => { try { return JSON.parse(t.tags || '[]'); } catch(e) { return []; } })(),
      startTime: t.startTime, endTime: t.endTime, maxMembers: t.maxMembers,
      currentMembers: t.currentMembers, status: t.status, createdAt: t.createdAt,
      leaderId: { _id: t.leaderId, nickname: t.leaderNickname, avatarUrl: t.leaderAvatar, creditScore: t.leaderCredit },
    }));

    res.json({ code: 0, data: { list, pagination: { page: pageNum, pageSize: sizeNum, total } } });
  } catch (err) {
    console.error('[my/favorites] error:', err.message);
    res.json({ code: -1, message: '加载失败' });
  }
});

/**
 * GET /api/teams/:id/qrcode
 * 获取组局小程序码（用于分享海报）
 */
router.get('/:id/qrcode', async (req, res) => {
  try {
    const teamId = parseInt(req.params.id);
    const team = db.prepare('SELECT id, title FROM teams WHERE id = ?').get(teamId);
    if (!team) return res.json({ code: -1, message: '组局不存在' });

    const scene = 'id=' + teamId;
    const page = 'pages/teamDetail/teamDetail';
    const qrBuffer = await getMiniProgramQRCode(scene, page);

    if (qrBuffer) {
      res.set('Content-Type', 'image/png');
      res.send(qrBuffer);
    } else {
      // 未配置 WX_APPID 时返回占位标记
      res.json({ code: 1, message: 'qrcode_unavailable', data: null });
    }
  } catch (err) {
    logger.error('获取小程序码失败: ' + err.message);
    res.json({ code: -1, message: '获取小程序码失败' });
  }
});

module.exports = router;
