const { db, _, cloud } = require('../utils/db');
const { getCurrentUser, requireAuth } = require('../utils/auth');
const { calcActiveLevel, calcActiveMatch, refreshActivityStats } = require('../utils/activity');

const VALID_TAGS = ['新手友好', '高手局', 'AA制', '免费', '长期约', '周末常约', '工作日约', '女性专场', '男性专场', '学生局', '养生局', '竞技局'];

/**
 * 自动将过期的招募中组局标记为已结束
 * 云函数没有 cron，所以在查询时惰性执行
 * @param {boolean} force - 是否强制检查（默认 true，高频调用时可设为 false 节约配额）
 */
let _lastAutoExpire = 0;
async function autoExpireTeams(force) {
  const now = Date.now();
  // 每 5 分钟最多执行一次（云函数共享实例可能频繁调用）
  if (!force && now - _lastAutoExpire < 5 * 60 * 1000) return;
  _lastAutoExpire = now;
  try {
    const nowISO = new Date().toISOString();
    // 查询已过期但仍在招募中的组局
    const { data: expired } = await db.collection('teams').where({
      status: 'recruiting',
      endTime: _.lt(nowISO),
    }).limit(50).get();

    for (const t of expired) {
      try {
        await db.collection('teams').doc(t._id).update({
          data: { status: 'ended', updatedAt: db.serverDate() },
        });
        // 为成员加信誉分
        const { data: members } = await db.collection('team_members').where({ teamId: t._id }).get();
        for (const m of members) {
          try {
            const { data: u } = await db.collection('users').doc(m.userId).get();
            const creditAdd = m.role === 'leader' ? 2 : 1;
            await db.collection('users').doc(m.userId).update({
              data: { creditScore: Math.min(200, (u.creditScore || 100) + creditAdd), updatedAt: db.serverDate() },
            });
          } catch (e) {}
        }
      } catch (e) {
        console.error('[autoExpireTeams] error for team', t._id, e.message);
      }
    }
    if (expired.length > 0) {
      console.log('[autoExpireTeams] expired', expired.length, 'teams');
    }
  } catch (e) {
    console.error('[autoExpireTeams] query error:', e.message);
  }
}

// ============ 工具函数 ============

/**
 * 将云存储 fileID 转换为临时访问 URL（云函数有管理员权限，可访问所有文件）
 * 用于解决私有文件其他用户无法访问的问题
 */
async function resolveFileUrl(fileID) {
  if (!fileID || !fileID.startsWith('cloud://')) return fileID || '';
  try {
    const { fileList } = await cloud.getTempFileURL({ fileList: [fileID] });
    if (fileList && fileList[0] && fileList[0].tempFileURL) {
      return fileList[0].tempFileURL;
    }
  } catch (e) {
    console.error('[resolveFileUrl] error:', e.message);
  }
  return fileID;
}

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
 * 检查两个时间段是否有重叠
 * 默认活动时长 2 小时（与 create 中 endTime 计算一致）
 */
function hasTimeOverlap(startA, endA, startB, endB) {
  const a1 = new Date(startA).getTime();
  const a2 = endA ? new Date(endA).getTime() : a1 + 2 * 3600 * 1000;
  const b1 = new Date(startB).getTime();
  const b2 = endB ? new Date(endB).getTime() : b1 + 2 * 3600 * 1000;
  return a1 < b2 && b1 < a2;
}

/**
 * 推荐算法：五维综合评分
 * 维度1: 运动偏好匹配（×1.5 乘数）       权重体现在乘数中
 * 维度2: 时间紧迫度（-0.5 ~ +1.0）
 * 维度3: 距离远近（0 ~ 1.0，对数衰减）
 * 维度4: 剩余名额（0 ~ 0.15）
 * 维度5: 活跃度匹配（0 ~ 1.0）← 新增
 *
 * @param {Object} team    - 队伍信息（含 distance, spotsLeft, startTime, leaderCreditScore）
 * @param {Array}  prefs   - 用户运动偏好数组
 * @param {'high'|'mid'|'low'|'dormant'} activeLevel - 用户活跃等级
 */
function calcRecommendScore(team, prefs, activeLevel) {
  // 维度1：运动偏好匹配（乘数）
  const prefMultiplier = (prefs.length > 0 && prefs.indexOf(team.sportType) > -1) ? 1.5 : 1.0;

  // 维度2：时间紧迫度
  let timeBonus = 0;
  if (team.startTime) {
    const hoursUntil = (new Date(team.startTime).getTime() - Date.now()) / 3600000;
    if (hoursUntil >= 0 && hoursUntil <= 4) {
      timeBonus = 1.0 - (hoursUntil / 4) * 0.6;
    } else if (hoursUntil > 4 && hoursUntil <= 24) {
      timeBonus = 0.4 * Math.exp(-0.05 * (hoursUntil - 4));
    } else if (hoursUntil > 24 && hoursUntil <= 168) {
      timeBonus = 0.15 * Math.exp(-0.005 * (hoursUntil - 24));
    } else if (hoursUntil < 0) {
      timeBonus = -0.5;
    }
  }

  // 维度3：距离
  const distKm = team.distance / 1000;
  const distScore = Math.max(0, 1 - Math.log(1 + distKm) / Math.log(21));

  // 维度4：剩余名额
  const spotsRatio = team.maxMembers > 0 ? team.spotsLeft / team.maxMembers : 0;
  const spotsBonus = Math.min(spotsRatio, 1) * 0.15;

  // 维度5：活跃度匹配（新增）
  const activeMatch = calcActiveMatch(team, activeLevel || 'mid');

  const score = (0.5 + timeBonus + distScore + spotsBonus + activeMatch * 0.3) * prefMultiplier;
  return Math.round(score * 1000) / 1000;
}

/**
 * 获取组局详情（含成员信息）
 */
async function getTeamDetail(teamId, userId) {
  const { data: team } = await db.collection('teams').doc(teamId).get();
  if (!team) return null;

  const { data: members } = await db.collection('team_members').where({ teamId }).orderBy('joinedAt', 'asc').get();
  const isLeader = userId ? team.leaderId === userId : false;
  const isJoined = userId ? members.some(m => m.userId === userId) : false;

  let leader = null;
  try {
    const { data } = await db.collection('users').doc(team.leaderId).get();
    leader = { _id: data._id, nickname: data.nickname, avatarUrl: data.avatarUrl, creditScore: data.creditScore };
  } catch (e) {
    leader = { _id: team.leaderId, nickname: '未知', avatarUrl: '', creditScore: 0 };
  }

  const memberDetails = [];
  for (const m of members) {
    try {
      const { data: u } = await db.collection('users').doc(m.userId).get();
      memberDetails.push({ _id: m._id, userId: { _id: u._id, nickname: u.nickname, avatarUrl: u.avatarUrl }, joinedAt: m.joinedAt, role: m.role });
    } catch (e) {
      memberDetails.push({ _id: m._id, userId: { _id: m.userId, nickname: '未知', avatarUrl: '' }, joinedAt: m.joinedAt, role: m.role });
    }
  }

  // 将云存储 fileID 转为临时 URL，确保其他用户也能访问
  const coverImage = await resolveFileUrl(team.coverImage || '');
  if (leader && leader.avatarUrl && leader.avatarUrl.startsWith('cloud://')) {
    leader.avatarUrl = await resolveFileUrl(leader.avatarUrl);
  }
  for (const m of memberDetails) {
    if (m.userId && m.userId.avatarUrl && m.userId.avatarUrl.startsWith('cloud://')) {
      m.userId.avatarUrl = await resolveFileUrl(m.userId.avatarUrl);
    }
  }

  return {
    _id: team._id,
    sportType: team.sportType,
    title: team.title,
    description: team.description,
    tags: Array.isArray(team.tags) ? team.tags : [],
    venueName: team.locationName,
    location: { name: team.locationName, address: team.locationAddr, longitude: team.longitude, latitude: team.latitude },
    startTime: team.startTime,
    endTime: team.endTime,
    maxMembers: team.maxMembers,
    currentMembers: team.currentMembers,
    fee: team.fee,
    contact: team.contact,
    coverImage: coverImage,
    status: team.status,
    createdAt: team.createdAt,
    leaderId: leader,
    members: memberDetails,
    isLeader,
    isJoined,
  };
}

/**
 * 创建通知
 */
async function createNotification(userId, type, title, content, teamId) {
  try {
    await db.collection('notifications').add({
      data: {
        userId,
        type,
        title,
        content: content || '',
        teamId: teamId || null,
        isRead: 0,
        createdAt: db.serverDate(),
      },
    });
  } catch (e) {
    console.error('[createNotification] error:', e.message);
  }
}

/**
 * 发送微信订阅消息（静默失败，不影响主流程）
 *
 * @param {string} userId  - 接收者用户 _id
 * @param {Object} team    - 队伍信息
 * @param {string} type    - 消息类型：match_success | cancelled | ended
 */
async function _sendSubscribeMsg(userId, team, type) {
  const TEMPLATE_MAP = {
    match_success: 'XlbAjAHqhp4pq2RVFVXRJ_29tfPWMAmTRtJG2nQ4hi4',
    cancelled:     'zfuwiRlb-YOSpAHqM79maZJafwPS5andsheaqqnDPQQ',
    ended:         'Q5wJpHL0g4rR6bA6hoKqViX1bbXqdis550aMyZtcbS8',
  };
  const templateId = TEMPLATE_MAP[type];
  if (!templateId) return;

  try {
    const { data: user } = await db.collection('users').doc(userId).get();
    if (!user || !user.openid) return;

    const sportName = SPORT_NAME_MAP[team.sportType] || '运动';
    const title = (team.title || '').substring(0, 20);
    const location = (team.locationName || '').substring(0, 20);
    const startTime = team.startTime || '';
    const now = new Date().toISOString();

    // 每个模板字段不同，分别构建
    let data;
    if (type === 'match_success') {
      // 活动名称 thing7, 报名时间 time2, 活动地址 thing9, 开始时间 time5
      data = {
        thing7: { value: title },
        time2:  { value: now },
        thing9: { value: location || '待定' },
        time5:  { value: startTime },
      };
    } else if (type === 'cancelled') {
      // 运动名称 thing1, 取消原因 thing2, 运动地点 thing4, 运动时间 time3
      data = {
        thing1: { value: sportName + ' - ' + title },
        thing2: { value: '队长取消了组局' },
        thing4: { value: location || '待定' },
        time3:  { value: startTime },
      };
    } else if (type === 'ended') {
      // 任务名称 thing1, 完成日期 time2
      data = {
        thing1: { value: sportName + ' - ' + title },
        time2:  { value: now },
      };
    }

    await cloud.openapi.subscribeMessage.send({
      touser: user.openid,
      templateId,
      page: '/pages/teamDetail/teamDetail?id=' + team._id,
      data,
    });
  } catch (e) {
    // 静默失败（用户可能未授权订阅消息、或模板字段不匹配）
    console.error('[_sendSubscribeMsg]', type, e.message);
  }
}

// ============ 冲突检测函数 ============

const SPORT_NAME_MAP = {
  basketball: '篮球', badminton: '羽毛球', running: '跑步', football: '足球',
  tennis: '网球', swimming: '游泳', volleyball: '排球', pingpong: '乒乓球',
  hiking: '爬山', cycling: '骑行', fitness: '健身', other: '其他',
};

/**
 * 检查用户是否有时间冲突的组局
 * @param {string} userId     - 用户 _id
 * @param {string} startTime  - 新组局开始时间 ISO
 * @param {string} endTime    - 新组局结束时间 ISO（可选）
 * @param {string} excludeTeamId - 排除的队伍 ID（用于退出后重新加入等场景）
 * @returns {Object|null} 冲突的队伍信息，无冲突返回 null
 */
async function checkTimeConflict(userId, startTime, endTime, excludeTeamId) {
  try {
    // 获取用户所有活跃的成员记录
    const { data: memberships } = await db.collection('team_members').where({ userId }).get();
    if (memberships.length === 0) return null;

    const teamIds = memberships.map(m => m.teamId).filter(id => id !== excludeTeamId);
    if (teamIds.length === 0) return null;

    // 逐个检查时间冲突（云数据库不支持 _id in 查询跨集合，需逐条查）
    for (const tid of teamIds) {
      try {
        const { data: t } = await db.collection('teams').doc(tid).get();
        // 只检查未结束/未取消的队伍
        if (t.status === 'cancelled' || t.status === 'ended') continue;
        if (hasTimeOverlap(startTime, endTime, t.startTime, t.endTime)) {
          return {
            teamId: t._id,
            title: t.title,
            sportType: t.sportType,
            sportName: SPORT_NAME_MAP[t.sportType] || '其他',
            startTime: t.startTime,
          };
        }
      } catch (e) {
        // 队伍可能已被删除，跳过
      }
    }
    return null;
  } catch (e) {
    return null; // 检查失败不阻塞主流程
  }
}

/**
 * 检查队长是否已有相似的重复组局
 * 判定条件：同一运动类型 + 时间在 ±4小时内 + 状态为招募中
 * @param {string} leaderId   - 队长用户 _id
 * @param {string} sportType  - 运动类型
 * @param {string} startTime  - 新组局开始时间 ISO
 * @param {string} endTime    - 新组局结束时间 ISO
 * @returns {Object|null} 重复的队伍信息，无重复返回 null
 */
async function checkDuplicateTeam(leaderId, sportType, startTime, endTime) {
  try {
    const startMs = new Date(startTime).getTime();
    const windowMs = 4 * 3600 * 1000; // ±4 小时窗口
    const windowStart = new Date(startMs - windowMs).toISOString();
    const windowEnd = new Date(startMs + windowMs).toISOString();

    const { data: candidates } = await db.collection('teams').where({
      leaderId,
      sportType,
      status: 'recruiting',
      startTime: _.gte(windowStart).and(_.lte(windowEnd)),
    }).limit(5).get();

    if (candidates.length === 0) return null;

    // 二次校验：精确时间重叠
    for (const t of candidates) {
      if (hasTimeOverlap(startTime, endTime, t.startTime, t.endTime)) {
        return {
          teamId: t._id,
          title: t.title,
          sportType: t.sportType,
          sportName: SPORT_NAME_MAP[t.sportType] || '其他',
          startTime: t.startTime,
        };
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ============ 路由处理函数 ============

const routes = {};

// GET /teams/nearby
routes.nearby = async (event, wxContext) => {
  // 惰性过期检测（不阻塞主流程）
  autoExpireTeams(false).catch(() => {});

  const { longitude, latitude, radius = 5000, page = 1, pageSize = 20, sportType, timeFilter, minSpots, maxDistance, tag, mode } = event;
  const lng = parseFloat(longitude);
  const lat = parseFloat(latitude);
  if (isNaN(lng) || isNaN(lat)) return { code: -1, message: '经纬度参数错误' };

  const isRecommended = mode === 'recommended';
  let userId = null;
  let userPrefs = [];
  let userActiveLevel = 'mid';

  const currentUser = await getCurrentUser(wxContext);
  if (currentUser) {
    userId = currentUser._id;
    if (isRecommended && currentUser.sportPrefs) {
      try { userPrefs = JSON.parse(currentUser.sportPrefs); } catch (e) { userPrefs = []; }
    }
    if (isRecommended) {
      userActiveLevel = await calcActiveLevel(currentUser);
    }
  }

  // 构建查询条件
  const where = { status: _.neq('cancelled') };
  const delta = 0.5;
  where.longitude = _.gte(lng - delta).and(_.lte(lng + delta));
  where.latitude = _.gte(lat - delta).and(_.lte(lat + delta));

  if (sportType && sportType !== 'all') {
    where.sportType = sportType;
  }

  // 时间筛选
  if (timeFilter === 'today') {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    where.startTime = _.gte(todayStart.toISOString()).and(_.lte(todayEnd.toISOString()));
  } else if (timeFilter === 'tomorrow') {
    const tmr = new Date(); tmr.setDate(tmr.getDate() + 1); tmr.setHours(0, 0, 0, 0);
    const tmrEnd = new Date(tmr); tmrEnd.setHours(23, 59, 59, 999);
    where.startTime = _.gte(tmr.toISOString()).and(_.lte(tmrEnd.toISOString()));
  } else if (timeFilter === 'week') {
    const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7); weekEnd.setHours(23, 59, 59, 999);
    where.startTime = _.lte(weekEnd.toISOString());
  }

  // 标签筛选
  if (tag) {
    where.tags = _.elemMatch(_.eq(tag));
  }

  // 查询组局
  const countRes = await db.collection('teams').where(where).count();
  const total = countRes.total;

  const allTeams = [];
  const batchSize = 100;
  const fetchLimit = Math.min(total, 200);
  for (let i = 0; i < fetchLimit; i += batchSize) {
    const { data } = await db.collection('teams').where(where)
      .orderBy('createdAt', 'desc')
      .skip(i)
      .limit(Math.min(batchSize, fetchLimit - i))
      .get();
    allTeams.push(...data);
  }

  // 获取队长信息
  const leaderIds = [...new Set(allTeams.map(t => t.leaderId))];
  const leaderMap = {};
  for (const lid of leaderIds) {
    try {
      const { data } = await db.collection('users').doc(lid).get();
      leaderMap[lid] = { _id: data._id, nickname: data.nickname, avatarUrl: data.avatarUrl, creditScore: data.creditScore };
    } catch (e) {
      leaderMap[lid] = { _id: lid, nickname: '未知', avatarUrl: '', creditScore: 0 };
    }
  }

  // 批量解析云存储 fileID → 临时 URL
  const allFileIDs = [];
  for (const lid of leaderIds) {
    if (leaderMap[lid] && leaderMap[lid].avatarUrl && leaderMap[lid].avatarUrl.startsWith('cloud://')) {
      allFileIDs.push(leaderMap[lid].avatarUrl);
    }
  }
  for (const t of allTeams) {
    if (t.coverImage && t.coverImage.startsWith('cloud://')) {
      allFileIDs.push(t.coverImage);
    }
  }
  if (allFileIDs.length > 0) {
    try {
      const { fileList } = await cloud.getTempFileURL({ fileList: [...new Set(allFileIDs)] });
      const urlMap = {};
      for (const f of (fileList || [])) {
        if (f.fileID && f.tempFileURL) urlMap[f.fileID] = f.tempFileURL;
      }
      for (const lid of leaderIds) {
        if (leaderMap[lid] && urlMap[leaderMap[lid].avatarUrl]) {
          leaderMap[lid].avatarUrl = urlMap[leaderMap[lid].avatarUrl];
        }
      }
      for (const t of allTeams) {
        if (t.coverImage && urlMap[t.coverImage]) {
          t.coverImage = urlMap[t.coverImage];
        }
      }
    } catch (e) {
      console.error('[nearby] getTempFileURL error:', e.message);
    }
  }

  // 应用层过滤 + 距离计算
  let radiusNum = parseFloat(radius);
  const maxDist = parseFloat(maxDistance);
  if (!isNaN(maxDist) && maxDist > 0) {
    radiusNum = Math.min(radiusNum, maxDist * 1000);
  }

  const spots = parseInt(minSpots);

  const enriched = allTeams.map(t => {
    const dist = haversine(lat, lng, t.latitude, t.longitude);
    const spotsLeft = t.maxMembers - t.currentMembers;
    const item = {
      _id: t._id, sportType: t.sportType, title: t.title, description: t.description,
      tags: Array.isArray(t.tags) ? t.tags : [],
      venueName: t.locationName, startTime: t.startTime, endTime: t.endTime,
      maxMembers: t.maxMembers, currentMembers: t.currentMembers, fee: t.fee,
      contact: t.contact, coverImage: t.coverImage || '', status: t.status, createdAt: t.createdAt,
      distance: dist, distanceText: formatDistance(dist), spotsLeft,
      leaderId: leaderMap[t.leaderId] || { _id: t.leaderId, nickname: '未知', avatarUrl: '', creditScore: 0 },
      leaderCreditScore: (leaderMap[t.leaderId] || {}).creditScore || 0,
    };
    if (isRecommended) {
      item.score = calcRecommendScore(item, userPrefs, userActiveLevel);
    }
    return item;
  }).filter(t => {
    if (t.distance > radiusNum) return false;
    if (!isNaN(spots) && spots > 0 && t.spotsLeft < spots) return false;
    return true;
  });

  if (isRecommended) {
    enriched.sort((a, b) => b.score - a.score);
  } else {
    enriched.sort((a, b) => a.distance - b.distance);
  }

  let favoriteIds = [];
  if (userId) {
    const { data: favs } = await db.collection('favorites').where({ userId }).get();
    favoriteIds = favs.map(f => f.teamId);
  }

  const pageNum = Math.max(1, parseInt(page));
  const sizeNum = Math.min(50, Math.max(1, parseInt(pageSize)));
  const start = (pageNum - 1) * sizeNum;
  const list = enriched.slice(start, start + sizeNum);

  return {
    code: 0,
    data: {
      data: {
        list,
        pagination: { page: pageNum, pageSize: sizeNum, total: enriched.length },
        favoriteIds,
        mode: isRecommended ? 'recommended' : 'distance',
      },
    },
  };
};

// GET /teams/my/created
routes.myCreated = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const { page = 1, pageSize = 20, status } = event;
  const where = { leaderId: user._id };
  if (status && status !== 'all') where.status = status;
  const { data: teams } = await db.collection('teams').where(where).orderBy('createdAt', 'desc').limit(200).get();
  const pageNum = Math.max(1, parseInt(page));
  const sizeNum = Math.min(50, parseInt(pageSize));
  const total = teams.length;
  const start = (pageNum - 1) * sizeNum;
  const list = teams.slice(start, start + sizeNum).map(t => ({
    _id: t._id, sportType: t.sportType, title: t.title, venueName: t.locationName,
    tags: Array.isArray(t.tags) ? t.tags : [],
    startTime: t.startTime, endTime: t.endTime, maxMembers: t.maxMembers,
    currentMembers: t.currentMembers, status: t.status, createdAt: t.createdAt,
  }));
  return { code: 0, data: { list, pagination: { page: pageNum, pageSize: sizeNum, total } } };
};

// GET /teams/my/joined
routes.myJoined = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const { page = 1, pageSize = 20 } = event;
  const { data: memberships } = await db.collection('team_members').where({
    userId: user._id, role: _.neq('leader'),
  }).orderBy('joinedAt', 'desc').limit(200).get();

  const teamIds = memberships.map(m => m.teamId);
  if (teamIds.length === 0) return { code: 0, data: { list: [], pagination: { page: 1, pageSize: 20, total: 0 } } };

  const teams = [];
  for (const tid of teamIds) {
    try {
      const { data } = await db.collection('teams').doc(tid).get();
      let leader = { _id: data.leaderId, nickname: '未知', avatarUrl: '', creditScore: 0 };
      try {
        const { data: u } = await db.collection('users').doc(data.leaderId).get();
        leader = { _id: u._id, nickname: u.nickname, avatarUrl: u.avatarUrl, creditScore: u.creditScore };
      } catch (e) {}
      teams.push({
        _id: data._id, sportType: data.sportType, title: data.title, venueName: data.locationName,
        tags: Array.isArray(data.tags) ? data.tags : [], coverImage: data.coverImage || '',
        startTime: data.startTime, endTime: data.endTime, maxMembers: data.maxMembers,
        currentMembers: data.currentMembers, status: data.status, createdAt: data.createdAt, leaderId: leader,
      });
    } catch (e) {}
  }

  // 批量解析云存储 fileID → 临时 URL
  const allFileIDs = [];
  for (const t of teams) {
    if (t.leaderId && t.leaderId.avatarUrl && t.leaderId.avatarUrl.startsWith('cloud://')) {
      allFileIDs.push(t.leaderId.avatarUrl);
    }
    if (t.coverImage && t.coverImage.startsWith('cloud://')) {
      allFileIDs.push(t.coverImage);
    }
  }
  if (allFileIDs.length > 0) {
    try {
      const { fileList } = await cloud.getTempFileURL({ fileList: [...new Set(allFileIDs)] });
      const urlMap = {};
      for (const f of (fileList || [])) {
        if (f.fileID && f.tempFileURL) urlMap[f.fileID] = f.tempFileURL;
      }
      for (const t of teams) {
        if (t.leaderId && urlMap[t.leaderId.avatarUrl]) {
          t.leaderId.avatarUrl = urlMap[t.leaderId.avatarUrl];
        }
        if (t.coverImage && urlMap[t.coverImage]) {
          t.coverImage = urlMap[t.coverImage];
        }
      }
    } catch (e) {
      console.error('[myJoined] getTempFileURL error:', e.message);
    }
  }

  const pageNum = Math.max(1, parseInt(page));
  const sizeNum = Math.min(50, parseInt(pageSize));
  const total = teams.length;
  const start = (pageNum - 1) * sizeNum;
  return { code: 0, data: { list: teams.slice(start, start + sizeNum), pagination: { page: pageNum, pageSize: sizeNum, total } } };
};

// GET /teams/detail
routes.detail = async (event, wxContext) => {
  const teamId = event.teamId;
  if (!teamId) return { code: -1, message: '参数错误' };
  const currentUser = await getCurrentUser(wxContext);
  const userId = currentUser ? currentUser._id : null;
  const team = await getTeamDetail(teamId, userId);
  if (!team) return { code: -1, message: '组局不存在' };

  let isFavorited = false;
  if (userId) {
    const { data: favs } = await db.collection('favorites').where({ userId, teamId }).limit(1).get();
    isFavorited = favs.length > 0;
  }
  team.isFavorited = isFavorited;
  return { code: 0, data: team };
};

// POST /teams/create
routes.create = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const forceCreate = event.forceCreate === true; // 前端确认重复后传入
  const { sportType, title, description, location, activityTime, maxMembers, fee, contact, coverImage, tags } = event;

  if (!title || !title.trim()) return { code: -1, message: '请输入标题' };
  if (title.trim().length > 50) return { code: -1, message: '标题不能超过50字' };
  if (!location || !location.longitude || !location.latitude) return { code: -1, message: '请选择活动地点' };
  if (!activityTime) return { code: -1, message: '请选择活动时间' };

  const max = parseInt(maxMembers);
  if (isNaN(max) || max < 2 || max > 100) return { code: -1, message: '人数上限需在2-100之间' };

  const start = new Date(activityTime);
  // 支持自定义结束时间，否则默认 +2 小时
  let end;
  if (event.endTime) {
    end = new Date(event.endTime);
    if (isNaN(end.getTime()) || end <= start) {
      end = new Date(start.getTime() + 2 * 3600 * 1000);
    }
  } else {
    end = new Date(start.getTime() + 2 * 3600 * 1000);
  }
  let filteredTags = [];
  if (Array.isArray(tags) && tags.length > 0) {
    filteredTags = tags.filter(t => VALID_TAGS.includes(t)).slice(0, 5);
  }

  // 重复组局检测（同一运动类型 + 4小时内 + 招募中）
  if (!forceCreate) {
    const duplicate = await checkDuplicateTeam(user._id, sportType || 'other', start.toISOString(), end.toISOString());
    if (duplicate) {
      return {
        code: -2,
        message: '你已有一个相似的组局：「' + duplicate.title + '」，确定还要创建吗？',
        data: { duplicate },
      };
    }
  }

  const teamData = {
    leaderId: user._id, sportType: sportType || 'other', title: title.trim(),
    description: (description || '').trim(), locationName: location.name || '',
    locationAddr: location.address || location.name || '', longitude: location.longitude, latitude: location.latitude,
    startTime: start.toISOString(), endTime: end.toISOString(), maxMembers: max, currentMembers: 1,
    fee: fee || '免费', contact: (contact || '').trim(), coverImage: (coverImage || '').trim(),
    tags: filteredTags, status: 'recruiting', createdAt: db.serverDate(), updatedAt: db.serverDate(),
  };

  const res = await db.collection('teams').add({ data: teamData });
  await db.collection('team_members').add({
    data: { teamId: res._id, userId: user._id, role: 'leader', joinedAt: db.serverDate() },
  });

  const team = await getTeamDetail(res._id, user._id);
  // 异步刷新活动统计（不阻塞返回）
  refreshActivityStats(user._id).catch(() => {});
  return { code: 0, data: team, message: '发布成功' };
};

// POST /teams/:id/join
routes.join = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const teamId = event.teamId;
  const forceJoin = event.forceJoin === true; // 前端确认冲突后传入
  if (!teamId) return { code: -1, message: '参数错误' };

  let team;
  try { const { data } = await db.collection('teams').doc(teamId).get(); team = data; }
  catch (e) { return { code: -1, message: '组局不存在' }; }

  if (team.status !== 'recruiting') return { code: -1, message: '该组局不在招募中' };
  if (team.currentMembers >= team.maxMembers) return { code: -1, message: '人数已满' };

  // 禁止加入自己创建的队伍
  if (team.leaderId === user._id) return { code: -1, message: '你是队长，无需加入自己的组局' };

  const { data: existing } = await db.collection('team_members').where({ teamId, userId: user._id }).limit(1).get();
  if (existing.length > 0) return { code: -1, message: '你已经加入了该组局' };

  // 时间冲突检查（首次发现冲突时返回提示，前端确认后 forceJoin=true 跳过）
  if (!forceJoin) {
    const conflict = await checkTimeConflict(user._id, team.startTime, team.endTime, teamId);
    if (conflict) {
      return {
        code: -2,  // 特殊码：时间冲突，需前端确认
        message: '你已有一个时间重叠的组局：「' + conflict.title + '」（' + conflict.sportName + '），确定还要加入吗？',
        data: { conflict },
      };
    }
  }

  await db.collection('team_members').add({
    data: { teamId, userId: user._id, role: 'member', joinedAt: db.serverDate() },
  });

  const newCount = team.currentMembers + 1;
  const updateData = { currentMembers: newCount, updatedAt: db.serverDate() };
  if (newCount >= team.maxMembers) updateData.status = 'ended';
  await db.collection('teams').doc(teamId).update({ data: updateData });

  if (team.leaderId !== user._id) {
    const msg = newCount >= team.maxMembers
      ? user.nickname + ' 加入了「' + team.title + '」，组局已满员！'
      : user.nickname + ' 加入了「' + team.title + '」';
    await createNotification(team.leaderId, 'join', '新成员加入', msg, teamId);
  }

  // 满员时通知全体队员（组局成功 🎉）
  if (newCount >= team.maxMembers) {
    const { data: allMembers } = await db.collection('team_members').where({ teamId }).get();
    for (const m of allMembers) {
      if (m.userId !== user._id) {
        await createNotification(
          m.userId,
          'match_success',
          '🎉 组局成功',
          '「' + team.title + '」已满员 ' + newCount + '/' + team.maxMembers + '，活动即将开始！',
          teamId,
        );
        // 尝试发送订阅消息（静默，不影响主流程）
        _sendSubscribeMsg(m.userId, team, 'match_success').catch(() => {});
      }
    }
  }

  const detail = await getTeamDetail(teamId, user._id);
  // 异步刷新活动统计
  refreshActivityStats(user._id).catch(() => {});
  return { code: 0, data: detail, message: '加入成功' };
};

// POST /teams/:id/quit
routes.quit = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const teamId = event.teamId;
  if (!teamId) return { code: -1, message: '参数错误' };

  let team;
  try { const { data } = await db.collection('teams').doc(teamId).get(); team = data; }
  catch (e) { return { code: -1, message: '组局不存在' }; }

  if (team.leaderId === user._id) return { code: -1, message: '队长不能退出，请先转让或取消组局' };
  if (team.status === 'cancelled') return { code: -1, message: '组局已取消，无法退出' };

  const { data: member } = await db.collection('team_members').where({ teamId, userId: user._id }).limit(1).get();
  if (member.length === 0) return { code: -1, message: '你未加入该组局' };

  await db.collection('team_members').doc(member[0]._id).remove();

  const newCount = Math.max(team.currentMembers - 1, 1);
  const updateData = { currentMembers: newCount, updatedAt: db.serverDate() };
  const isFuture = new Date(team.startTime) > new Date();
  if (team.status === 'ended' && isFuture && newCount < team.maxMembers) updateData.status = 'recruiting';
  await db.collection('teams').doc(teamId).update({ data: updateData });

  await createNotification(team.leaderId, 'quit', '成员退出', user.nickname + ' 退出了「' + team.title + '」', teamId);

  const detail = await getTeamDetail(teamId, user._id);
  return { code: 0, data: detail, message: '已退出' };
};

// POST /teams/:id/cancel
routes.cancel = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const teamId = event.teamId;
  if (!teamId) return { code: -1, message: '参数错误' };

  let team;
  try { const { data } = await db.collection('teams').doc(teamId).get(); team = data; }
  catch (e) { return { code: -1, message: '组局不存在' }; }

  if (team.leaderId !== user._id) return { code: -1, message: '只有队长才能取消组局' };
  if (team.status === 'cancelled') return { code: -1, message: '组局已取消' };
  if (team.status === 'ended') return { code: -1, message: '组局已结束' };

  await db.collection('teams').doc(teamId).update({ data: { status: 'cancelled', updatedAt: db.serverDate() } });

  const { data: members } = await db.collection('team_members').where({ teamId, userId: _.neq(user._id) }).get();
  for (const m of members) {
    await createNotification(m.userId, 'cancelled', '组局已取消', '「' + team.title + '」已被队长取消', teamId);
    _sendSubscribeMsg(m.userId, team, 'cancelled').catch(() => {});
  }

  const detail = await getTeamDetail(teamId, user._id);
  return { code: 0, data: detail, message: '组局已取消' };
};

// POST /teams/:id/end
routes.end = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const teamId = event.teamId;
  if (!teamId) return { code: -1, message: '参数错误' };

  let team;
  try { const { data } = await db.collection('teams').doc(teamId).get(); team = data; }
  catch (e) { return { code: -1, message: '组局不存在' }; }

  if (team.leaderId !== user._id) return { code: -1, message: '只有队长才能结束组局' };
  if (team.status === 'ended') return { code: -1, message: '组局已结束' };
  if (team.status === 'cancelled') return { code: -1, message: '组局已取消' };

  await db.collection('teams').doc(teamId).update({ data: { status: 'ended', updatedAt: db.serverDate() } });

  const { data: members } = await db.collection('team_members').where({ teamId }).get();
  for (const m of members) {
    if (m.userId !== user._id) {
      await createNotification(m.userId, 'ended', '组局已结束', '「' + team.title + '」已结束，期待下次一起运动', teamId);
      _sendSubscribeMsg(m.userId, team, 'ended').catch(() => {});
    }
    try {
      const creditAdd = m.role === 'leader' ? 2 : 1;
      const { data: u } = await db.collection('users').doc(m.userId).get();
      await db.collection('users').doc(m.userId).update({
        data: { creditScore: (u.creditScore || 100) + creditAdd, updatedAt: db.serverDate() },
      });
    } catch (e) {}
  }

  const detail = await getTeamDetail(teamId, user._id);
  return { code: 0, data: detail, message: '组局已结束' };
};

// POST /teams/:id/update
routes.update = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const teamId = event.teamId;
  if (!teamId) return { code: -1, message: '参数错误' };

  let team;
  try { const { data } = await db.collection('teams').doc(teamId).get(); team = data; }
  catch (e) { return { code: -1, message: '组局不存在' }; }

  if (team.leaderId !== user._id) return { code: -1, message: '只有队长才能编辑组局' };
  if (team.status !== 'recruiting') return { code: -1, message: '只有招募中的组局才能编辑' };

  const { title, description, location, activityTime, maxMembers, fee, contact, coverImage, tags } = event;
  const updates = {};

  if (title !== undefined) {
    if (!title || !title.trim()) return { code: -1, message: '请输入标题' };
    if (title.trim().length > 50) return { code: -1, message: '标题不能超过50字' };
    updates.title = title.trim();
  }
  if (description !== undefined) updates.description = (description || '').trim();
  if (location && location.longitude && location.latitude) {
    updates.locationName = location.name || '';
    updates.locationAddr = location.address || location.name || '';
    updates.longitude = location.longitude;
    updates.latitude = location.latitude;
  }
  if (activityTime !== undefined) {
    const start = new Date(activityTime);
    if (!isNaN(start.getTime())) {
      updates.startTime = start.toISOString();
      // 支持自定义结束时间
      if (event.endTime) {
        const customEnd = new Date(event.endTime);
        updates.endTime = (!isNaN(customEnd.getTime()) && customEnd > start)
          ? customEnd.toISOString()
          : new Date(start.getTime() + 2 * 3600 * 1000).toISOString();
      } else {
        updates.endTime = new Date(start.getTime() + 2 * 3600 * 1000).toISOString();
      }
    }
  }
  if (maxMembers !== undefined) {
    const max = parseInt(maxMembers);
    if (isNaN(max) || max < 2 || max > 100) return { code: -1, message: '人数上限需在2-100之间' };
    if (max < team.currentMembers) return { code: -1, message: '人数不能少于当前已加入人数 ' + team.currentMembers + ' 人' };
    updates.maxMembers = max;
  }
  if (fee !== undefined) updates.fee = fee || '免费';
  if (contact !== undefined) updates.contact = (contact || '').trim();
  if (coverImage !== undefined) updates.coverImage = (coverImage || '').trim();
  if (tags !== undefined) {
    updates.tags = Array.isArray(tags) ? tags.filter(t => VALID_TAGS.includes(t)).slice(0, 5) : [];
  }

  if (Object.keys(updates).length === 0) return { code: -1, message: '没有需要更新的内容' };
  updates.updatedAt = db.serverDate();
  await db.collection('teams').doc(teamId).update({ data: updates });

  // 通知队员变更
  const changedFields = [];
  if (title !== undefined && title.trim() !== team.title) changedFields.push('标题');
  if (location && location.name && location.name !== team.locationName) changedFields.push('地点');
  if (activityTime !== undefined) changedFields.push('时间');
  if (maxMembers !== undefined && parseInt(maxMembers) !== team.maxMembers) changedFields.push('人数');
  if (fee !== undefined && (fee || '免费') !== team.fee) changedFields.push('费用');

  if (changedFields.length > 0) {
    const { data: members } = await db.collection('team_members').where({ teamId, userId: _.neq(user._id) }).get();
    const changeText = changedFields.join('、');
    for (const m of members) {
      await createNotification(m.userId, 'update', '组局信息更新', '「' + team.title + '」的' + changeText + '已更新，请留意', teamId);
    }
  }

  const detail = await getTeamDetail(teamId, user._id);
  return { code: 0, data: detail, message: '编辑成功' };
};

// POST /teams/:id/favorite
routes.toggleFavorite = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const teamId = event.teamId;
  if (!teamId) return { code: -1, message: '参数错误' };

  try { await db.collection('teams').doc(teamId).get(); }
  catch (e) { return { code: -1, message: '组局不存在' }; }

  const { data: existing } = await db.collection('favorites').where({ userId: user._id, teamId }).limit(1).get();
  if (existing.length > 0) {
    await db.collection('favorites').doc(existing[0]._id).remove();
    return { code: 0, data: { favorited: false }, message: '已取消收藏' };
  } else {
    await db.collection('favorites').add({ data: { userId: user._id, teamId, createdAt: db.serverDate() } });
    return { code: 0, data: { favorited: true }, message: '已收藏' };
  }
};

// GET /teams/my/favorites
routes.myFavorites = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const { page = 1, pageSize = 20 } = event;
  const { data: favs } = await db.collection('favorites').where({ userId: user._id }).orderBy('createdAt', 'desc').limit(200).get();

  const teams = [];
  for (const fav of favs) {
    try {
      const { data: t } = await db.collection('teams').doc(fav.teamId).get();
      let leader = { _id: t.leaderId, nickname: '未知', avatarUrl: '', creditScore: 0 };
      try {
        const { data: u } = await db.collection('users').doc(t.leaderId).get();
        leader = { _id: u._id, nickname: u.nickname, avatarUrl: u.avatarUrl, creditScore: u.creditScore };
      } catch (e) {}
      teams.push({
        _id: t._id, sportType: t.sportType, title: t.title, venueName: t.locationName,
        tags: Array.isArray(t.tags) ? t.tags : [], coverImage: t.coverImage || '',
        startTime: t.startTime, endTime: t.endTime,
        maxMembers: t.maxMembers, currentMembers: t.currentMembers, status: t.status,
        createdAt: t.createdAt, leaderId: leader,
      });
    } catch (e) {}
  }

  // 批量解析云存储 fileID → 临时 URL
  const allFileIDs = [];
  for (const t of teams) {
    if (t.leaderId && t.leaderId.avatarUrl && t.leaderId.avatarUrl.startsWith('cloud://')) {
      allFileIDs.push(t.leaderId.avatarUrl);
    }
    if (t.coverImage && t.coverImage.startsWith('cloud://')) {
      allFileIDs.push(t.coverImage);
    }
  }
  if (allFileIDs.length > 0) {
    try {
      const { fileList } = await cloud.getTempFileURL({ fileList: [...new Set(allFileIDs)] });
      const urlMap = {};
      for (const f of (fileList || [])) {
        if (f.fileID && f.tempFileURL) urlMap[f.fileID] = f.tempFileURL;
      }
      for (const t of teams) {
        if (t.leaderId && urlMap[t.leaderId.avatarUrl]) {
          t.leaderId.avatarUrl = urlMap[t.leaderId.avatarUrl];
        }
        if (t.coverImage && urlMap[t.coverImage]) {
          t.coverImage = urlMap[t.coverImage];
        }
      }
    } catch (e) {
      console.error('[myFavorites] getTempFileURL error:', e.message);
    }
  }

  const pageNum = Math.max(1, parseInt(page));
  const sizeNum = Math.min(50, parseInt(pageSize));
  const total = teams.length;
  const start = (pageNum - 1) * sizeNum;
  return { code: 0, data: { list: teams.slice(start, start + sizeNum), pagination: { page: pageNum, pageSize: sizeNum, total } } };
};

// POST /teams/:id/qrcode
routes.qrcode = async (event) => {
  const teamId = event.teamId;
  if (!teamId) return { code: -1, message: '参数错误' };

  const cloudPath = 'qrcodes/' + teamId + '.png';

  try {
    // 1. 先检查云存储是否已有缓存（避免重复生成）
    try {
      const { fileList } = await cloud.getTempFileURL({
        fileList: [{ cloudPath }],
      });
      if (fileList && fileList[0] && fileList[0].tempFileURL) {
        // 已有缓存，直接返回 fileID
        return { code: 0, data: { fileID: fileList[0].fileID, cached: true } };
      }
    } catch (e) {
      // 缓存检查失败，继续生成
    }

    // 2. scene 参数不能超过 32 字符，MongoDB _id 通常 24 字符，直接用 id
    const scene = teamId.length <= 32 ? teamId : teamId.substring(0, 32);

    // 3. 生成小程序码
    const result = await cloud.openapi.wxacode.getUnlimited({
      scene,
      page: 'pages/teamDetail/teamDetail',
      width: 430,
      autoColor: false,
      lineColor: { r: 10, g: 154, b: 93 }, // 主题绿色
      isHyaline: false,
    });

    // 4. 上传到云存储
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: result.buffer || result,
    });

    return { code: 0, data: { fileID: uploadRes.fileID, cached: false } };
  } catch (e) {
    console.error('[qrcode] error:', e.message, e.errCode);

    // 常见错误码处理
    let hint = 'qrcode_unavailable';
    if (e.errCode === 45157) {
      hint = '小程序未发布，无法生成小程序码。请先在微信开发者工具上传并发布小程序。';
    } else if (e.errCode === 45158) {
      hint = '小程序码参数错误，请检查页面路径是否正确。';
    } else if (e.errCode === 45159) {
      hint = '小程序码生成数量已达上限。';
    } else if (e.errCode === 45160) {
      hint = '小程序未设置默认头像或名称，请在微信公众平台完善小程序信息。';
    } else if (e.errCode === 40001) {
      hint = '云函数未授权 access_token，请检查云开发环境配置。';
    }

    return { code: 1, message: hint, data: null };
  }
};

module.exports = routes;
