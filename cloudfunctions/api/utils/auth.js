const { db } = require('./db');

/**
 * 从云函数上下文获取当前用户
 * 云开发自带鉴权，openid 由微信保证可信，无需 JWT
 */
async function getCurrentUser(wxContext) {
  const openid = wxContext.OPENID;
  if (!openid) return null;
  const { data } = await db.collection('users').where({ openid }).limit(1).get();
  return data.length > 0 ? data[0] : null;
}

/**
 * 要求登录（中间件）
 */
async function requireAuth(wxContext) {
  const user = await getCurrentUser(wxContext);
  if (!user) throw { code: 401, message: '请先登录' };
  return user;
}

module.exports = { getCurrentUser, requireAuth };
