/**
 * 活跃度追踪工具（Express 后端 SQLite 版本）
 *
 * 功能：
 * 1. trackActivity — 每次请求时更新 lastActiveAt
 * 2. calcActiveLevel — 计算用户活跃等级（查询 7 天登录 + 30 天参与次数）
 * 3. calcActiveMatch — 推荐算法第五维：活跃度匹配分
 */

const db = require('../db/database');

/**
 * 追踪用户活跃（中间件或路由中调用）
 * @param {number} userId - 用户 ID
 */
function trackActivity(userId) {
  try {
    db.prepare("UPDATE users SET lastActiveAt = datetime('now') WHERE id = ?").run(userId);
  } catch (e) {
    // 静默失败，不影响主流程
  }
}

/**
 * 获取用户活跃度等级
 * @param {object} user - 用户对象（需包含 id 和 lastActiveAt）
 * @returns {'high'|'mid'|'low'|'dormant'}
 */
function calcActiveLevel(user) {
  try {
    const now = new Date();
    const _7d = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
    const _14d = new Date(now.getTime() - 14 * 24 * 3600 * 1000).toISOString();
    const _30d = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();

    const lastActive = user.lastActiveAt;

    // 从未活跃 → dormant
    if (!lastActive) return 'dormant';

    // 超过30天未活跃 → dormant
    if (lastActive < _30d) return 'dormant';

    // 查询近30天参与的组局数（非队长）
    const joinRow = db.prepare(
      'SELECT COUNT(*) as cnt FROM team_members WHERE userId = ? AND joinedAt >= ?'
    ).get(user.id, _30d);
    const joinCount30d = (joinRow && joinRow.cnt) || 0;

    // 7天内活跃 + 有参与 → high
    if (lastActive >= _7d && joinCount30d >= 2) return 'high';

    // 7天内活跃但参与少 → mid
    if (lastActive >= _7d) return 'mid';

    // 14天内活跃且有参与 → mid
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
 * @param {object} team - 队伍信息（需包含 spotsLeft, startTime, leaderCreditScore, maxMembers, createdAt）
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

module.exports = {
  trackActivity,
  calcActiveLevel,
  calcActiveMatch,
};
