const { db, _ } = require('../utils/db');
const { requireAuth } = require('../utils/auth');

const routes = {};

// GET /notifications
routes.list = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const { page = 1, pageSize = 20, unreadOnly } = event;

  const where = { userId: user._id };
  if (unreadOnly === '1' || unreadOnly === true) {
    where.isRead = 0;
  }

  const { data: all } = await db.collection('notifications').where(where).orderBy('createdAt', 'desc').limit(200).get();

  const pageNum = Math.max(1, parseInt(page));
  const sizeNum = Math.min(50, parseInt(pageSize));
  const total = all.length;
  const start = (pageNum - 1) * sizeNum;
  const list = all.slice(start, start + sizeNum);

  // 未读数
  const { total: unreadCount } = await db.collection('notifications').where({
    userId: user._id, isRead: 0,
  }).count();

  return { code: 0, data: { list, unreadCount, pagination: { page: pageNum, pageSize: sizeNum, total } } };
};

// POST /notifications/read
routes.markRead = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const { ids } = event;

  if (ids && Array.isArray(ids) && ids.length > 0) {
    for (const id of ids) {
      try {
        await db.collection('notifications').doc(id).update({ data: { isRead: 1 } });
      } catch (e) {}
    }
  } else {
    // 全部标记已读
    const { data: unread } = await db.collection('notifications').where({
      userId: user._id, isRead: 0,
    }).limit(100).get();
    for (const n of unread) {
      try {
        await db.collection('notifications').doc(n._id).update({ data: { isRead: 1 } });
      } catch (e) {}
    }
  }

  const { total: unreadCount } = await db.collection('notifications').where({
    userId: user._id, isRead: 0,
  }).count();

  return { code: 0, data: { unreadCount } };
};

// POST /notifications/read-all
routes.markAllRead = async (event, wxContext) => {
  const user = await requireAuth(wxContext);

  const { data: unread } = await db.collection('notifications').where({
    userId: user._id, isRead: 0,
  }).limit(100).get();

  for (const n of unread) {
    try {
      await db.collection('notifications').doc(n._id).update({ data: { isRead: 1 } });
    } catch (e) {}
  }

  return { code: 0, data: { unreadCount: 0 } };
};

module.exports = routes;
