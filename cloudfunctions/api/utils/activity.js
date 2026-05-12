const { db, _ } = require('./db');

/**
 * 活跃度追踪工具
 * 
 * 功能：
 * 1. trackActivity — 每次云函数调用时更新 lastActiveAt
 * 2. calcActiveLevel — 实时计算用户活跃等级（查询 7 天登录 + 30 天参与次数）
 * 3. calcActiveMatch — 推荐算法第五维：活跃度匹配分
 * 4. refreshActivityStats — 主动刷新用户活动统计字段（供定时任务调用）
 */

/**
 * 追踪用户活跃（每次云函数调用时异步执行，不阻塞主流程）
 * @param {string} openid - 用户 openid
 */
async function trackActivity(openid) {
  try {
    await db.collection('users').where({ openid }).update({
      data: { lastActiveAt: new Date().toISOString() },
    });
  } catch (e) {
    // 静默失败，不影响主流程
  }
}

/**
 * 获取用户活跃度等级
 * 实时查询 lastActiveAt + 近30天参与组局次数
 * @param {Object} user - 用户对象（需包含 _id 和 lastActiveAt）
 * @returns {'high'|'mid'|'low'|'dormant'}
 */
async function calcActiveLevel(user) {
  try {
    const now = new Date();
    const _7d = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
    const _30d = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();

    const lastActive = user.lastActiveAt;

    // 从未活跃 → dormant
    if (!lastActive) return 'dormant';

    // 超过30天未活跃 → dormant
    if (lastActive < _30d) return 'dormant';

    // 查询近30天参与的组局数（非队长）
    let joinCount30d = 0;
    try {
      const { total } = await db.collection('team_members').where({
        userId: user._id,
        joinedAt: _.gte(_30d),
      }).count();
      joinCount30d = total;
    } catch (e) {}

    // 7天内活跃 + 有参与 → high
    if (lastActive >= _7d && joinCount30d >= 2) return 'high';

    // 7天内活跃但参与少 → mid
    if (lastActive >= _7d) return 'mid';

    // 14天内活跃 → mid
    const _14d = new Date(now.getTime() - 14 * 24 * 3600 * 1000).toISOString();
    if (lastActive >= _14d && joinCount30d >= 1) return 'mid';

    // 30天内活跃但无参与 → low
    return 'low';
  } catch (e) {
    return 'mid'; // 出错时默认中等，避免误判
  }
}

/**
 * 推荐算法第五维：活跃度匹配分
 * 核心思想：不同活跃度的用户需要不同的队伍信号来促成行动
 * 
 * - 低活/沉睡用户 → "临门一脚"策略（快满的、即将开始的队伍）
 * - 高活用户 → "充足空间"策略（有余位、有准备时间的队伍）
 * 
 * @param {Object} team - 队伍信息（需包含 spotsLeft, startTime）
 * @param {'high'|'mid'|'low'|'dormant'} activeLevel - 用户活跃等级
 * @returns {number} 0.0 ~ 1.0
 */
function calcActiveMatch(team, activeLevel) {
  const spotsLeft = team.spotsLeft || 0;
  const maxMembers = team.maxMembers || 10;
  const hoursToStart = team.startTime
    ? (new Date(team.startTime).getTime() - Date.now()) / 3600000
    : 999;

  let score = 0.5; // 基准分

  if (activeLevel === 'dormant' || activeLevel === 'low') {
    // 沉睡/低活用户：降低决策门槛
    // "就差你了" — 临满队伍加分
    if (spotsLeft <= 1) score += 0.25;
    else if (spotsLeft <= 2) score += 0.15;

    // "马上就开打" — 即将开始的活动加分
    if (hoursToStart >= 0 && hoursToStart <= 12) score += 0.20;
    else if (hoursToStart > 12 && hoursToStart <= 24) score += 0.10;

    // 高信用队长加分（降低信任顾虑）
    if (team.leaderCreditScore >= 120) score += 0.05;

  } else if (activeLevel === 'high') {
    // 高活用户：给予充足选择空间
    // 余位充足加分（不用抢）
    if (spotsLeft >= 3 && spotsLeft <= maxMembers - 1) score += 0.15;

    // 有准备时间加分
    if (hoursToStart >= 12 && hoursToStart <= 72) score += 0.10;

    // 新队伍加分（活跃用户喜欢尝鲜）
    if (team.createdAt) {
      const ageHours = (Date.now() - new Date(team.createdAt).getTime()) / 3600000;
      if (ageHours <= 6) score += 0.10;
    }

  } else {
    // mid：平衡策略
    if (spotsLeft >= 2 && spotsLeft <= 5) score += 0.10;
    if (hoursToStart >= 2 && hoursToStart <= 48) score += 0.10;
  }

  return Math.min(Math.max(score, 0), 1);
}

/**
 * 刷新用户的活动统计字段（写入 users 集合，供推荐算法快速读取）
 * 可由定时触发器调用，也可在关键操作后调用
 * @param {string} userId - 用户 _id
 */
async function refreshActivityStats(userId) {
  try {
    const now = new Date();
    const _30d = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();

    const { total: joinCount30d } = await db.collection('team_members').where({
      userId: userId,
      joinedAt: _.gte(_30d),
    }).count();

    const { total: createCount30d } = await db.collection('teams').where({
      leaderId: userId,
      createdAt: _.gte(_30d),
    }).count();

    // 读取用户以计算活跃等级
    const { data: user } = await db.collection('users').doc(userId).get();
    const level = await calcActiveLevel(user);

    await db.collection('users').doc(userId).update({
      data: {
        joinCount30d,
        createCount30d,
        activeLevel: level,
        updatedAt: db.serverDate(),
      },
    });
  } catch (e) {
    console.error('[refreshActivityStats] error:', e.message);
  }
}

module.exports = {
  trackActivity,
  calcActiveLevel,
  calcActiveMatch,
  refreshActivityStats,
};
