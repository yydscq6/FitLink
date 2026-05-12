/**
 * 信誉分工具
 * 积分规则：
 *   创建组局并正常结束：队长 +2
 *   参加组局并正常结束：队员 +1
 *   被举报（确认违规）：-5
 *   积分范围：0 ~ 200
 */
const db = require("../db/database");
const logger = require("./logger");

const MIN_SCORE = 0;
const MAX_SCORE = 200;

/**
 * 调整用户信誉分
 * @param {number} userId
 * @param {number} delta - 正数加分，负数扣分
 * @param {string} reason - 原因说明
 */
function adjustCredit(userId, delta, reason) {
  try {
    const user = db.prepare("SELECT creditScore FROM users WHERE id = ?").get(userId);
    if (!user) return;
    const current = user.creditScore || 100;
    const newScore = Math.max(MIN_SCORE, Math.min(MAX_SCORE, current + delta));
    db.prepare("UPDATE users SET creditScore = ?, updatedAt = datetime('now') WHERE id = ?").run(newScore, userId);
    logger.info("信誉分调整: userId=" + userId + " " + current + " -> " + newScore + " (" + reason + ")");
  } catch (err) {
    logger.error("信誉分调整失败: " + err.message);
  }
}

/**
 * 组局正常结束时，为队长和队员加分
 */
function creditForTeamCompleted(teamId) {
  try {
    const team = db.prepare("SELECT leaderId FROM teams WHERE id = ?").get(teamId);
    if (!team) return;
    // 队长 +2
    adjustCredit(team.leaderId, 2, "组局正常结束(队长)");
    // 队员 +1
    const members = db.prepare("SELECT userId FROM team_members WHERE teamId = ? AND userId != ?").all(teamId, team.leaderId);
    members.forEach(function(m) { adjustCredit(m.userId, 1, "组局正常结束(队员)"); });
  } catch (err) {
    logger.error("组局结束分失败: " + err.message);
  }
}

/**
 * 被举报扣分
 */
function creditForReported(userId) {
  adjustCredit(userId, -5, "被举报");
}

module.exports = { adjustCredit, creditForTeamCompleted, creditForReported };