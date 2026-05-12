const { db, _ } = require('../utils/db');
const { getCurrentUser, requireAuth } = require('../utils/auth');

const VALID_TARGET_TYPES = ['team', 'user', 'comment'];
const VALID_REASONS = ['spam', 'inappropriate', 'fraud', 'violence', 'other'];

const routes = {};

// POST /reports
routes.create = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const { targetType, targetId, reason, description } = event;

  if (!targetType || !VALID_TARGET_TYPES.includes(targetType)) return { code: -1, message: '举报类型无效' };
  if (!targetId) return { code: -1, message: '举报目标不存在' };
  if (!reason || !VALID_REASONS.includes(reason)) return { code: -1, message: '请选择举报原因' };

  // 检查目标是否存在
  try {
    if (targetType === 'team') await db.collection('teams').doc(targetId).get();
    else if (targetType === 'user') await db.collection('users').doc(targetId).get();
    else if (targetType === 'comment') await db.collection('comments').doc(targetId).get();
  } catch (e) {
    return { code: -1, message: '举报目标不存在' };
  }

  // 防止重复举报（24小时内）
  const oneDayAgo = new Date(Date.now() - 86400000);
  const { data: existing } = await db.collection('reports').where({
    reporterId: user._id, targetType, targetId,
    createdAt: _.gte(oneDayAgo),
  }).limit(1).get();
  if (existing.length > 0) return { code: -1, message: '你已经举报过该内容，请等待处理' };

  await db.collection('reports').add({
    data: {
      reporterId: user._id, targetType, targetId,
      reason, description: (description || '').trim().substring(0, 500),
      status: 'pending',
      createdAt: db.serverDate(),
    },
  });

  // 被举报扣信誉分
  try {
    if (targetType === 'user') {
      const { data: u } = await db.collection('users').doc(targetId).get();
      await db.collection('users').doc(targetId).update({ data: { creditScore: Math.max(0, (u.creditScore || 100) - 5) } });
    } else if (targetType === 'team') {
      const { data: t } = await db.collection('teams').doc(targetId).get();
      if (t && t.leaderId) {
        const { data: u } = await db.collection('users').doc(t.leaderId).get();
        await db.collection('users').doc(t.leaderId).update({ data: { creditScore: Math.max(0, (u.creditScore || 100) - 3) } });
      }
    }
  } catch (e) {}

  return { code: 0, message: '举报已提交，我们会尽快处理' };
};

// GET /reports (管理员)
routes.list = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  // 管理员检查（通过 openid 判断）
  const adminOpenids = (process.env.ADMIN_OPENIDS || '').split(',').filter(Boolean);
  if (adminOpenids.length > 0 && !adminOpenids.includes(user.openid)) {
    return { code: 403, message: '无管理员权限' };
  }

  const { page = 1, pageSize = 20, status = 'pending' } = event;
  const where = {};
  if (status !== 'all') where.status = status;

  const { data: all } = await db.collection('reports').where(where).orderBy('createdAt', 'desc').limit(200).get();

  const pageNum = Math.max(1, parseInt(page));
  const sizeNum = Math.min(100, parseInt(pageSize));
  const total = all.length;
  const start = (pageNum - 1) * sizeNum;
  const list = all.slice(start, start + sizeNum);

  return { code: 0, data: { list, pagination: { page: pageNum, pageSize: sizeNum, total } } };
};

// PUT /reports/:id (管理员处理)
routes.resolve = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const adminOpenids = (process.env.ADMIN_OPENIDS || '').split(',').filter(Boolean);
  if (adminOpenids.length > 0 && !adminOpenids.includes(user.openid)) {
    return { code: 403, message: '无管理员权限' };
  }

  const { reportId, action } = event;
  if (!reportId) return { code: -1, message: '参数错误' };
  if (!['resolved', 'dismissed'].includes(action)) return { code: -1, message: '操作类型无效' };

  let report;
  try { const { data } = await db.collection('reports').doc(reportId).get(); report = data; }
  catch (e) { return { code: -1, message: '举报不存在' }; }

  if (report.status !== 'pending') return { code: -1, message: '该举报已处理' };

  await db.collection('reports').doc(reportId).update({
    data: { status: action, resolvedAt: db.serverDate() },
  });

  // 确认违规时执行惩罚
  if (action === 'resolved') {
    try {
      if (report.targetType === 'team') {
        const { data: t } = await db.collection('teams').doc(report.targetId).get();
        if (t && t.status === 'recruiting') {
          await db.collection('teams').doc(report.targetId).update({ data: { status: 'cancelled', updatedAt: db.serverDate() } });
        }
      } else if (report.targetType === 'comment') {
        await db.collection('comments').doc(report.targetId).remove();
      }
    } catch (e) {}
  }

  return { code: 0, message: action === 'resolved' ? '已确认违规' : '已驳回举报' };
};

module.exports = routes;
