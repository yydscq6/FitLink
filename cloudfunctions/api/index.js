const { cloud } = require('./utils/db');
const { trackActivity } = require('./utils/activity');
const users = require('./routes/users');
const teams = require('./routes/teams');
const comments = require('./routes/comments');
const notifications = require('./routes/notifications');
const reports = require('./routes/reports');
const map = require('./routes/map');

/**
 * 云函数入口
 * 通过 event.action 路由到对应处理函数
 *
 * 前端调用示例：
 * wx.cloud.callFunction({
 *   name: 'api',
 *   data: { action: 'teams.nearby', longitude: 116.4, latitude: 39.9, radius: 5000 }
 * })
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const action = event.action || '';

  // 活跃度追踪（异步，不阻塞主流程）
  if (wxContext.OPENID) {
    trackActivity(wxContext.OPENID).catch(() => {});
  }

  try {
    // ============ 路由表 ============
    const routeMap = {
      // 用户
      'users.login':          users.login,
      'users.me':             users.getMe,
      'users.updateMe':       users.updateMe,
      'users.getById':        users.getById,
      'users.deleteAccount':  users.deleteAccount,

      // 组局
      'teams.nearby':         teams.nearby,
      'teams.myCreated':      teams.myCreated,
      'teams.myJoined':       teams.myJoined,
      'teams.detail':         teams.detail,
      'teams.create':         teams.create,
      'teams.join':           teams.join,
      'teams.quit':           teams.quit,
      'teams.cancel':         teams.cancel,
      'teams.end':            teams.end,
      'teams.update':         teams.update,
      'teams.toggleFavorite': teams.toggleFavorite,
      'teams.myFavorites':    teams.myFavorites,
      'teams.qrcode':         teams.qrcode,

      // 评论
      'comments.list':        comments.list,
      'comments.create':      comments.create,
      'comments.like':        comments.like,
      'comments.unlike':      comments.unlike,

      // 通知
      'notifications.list':       notifications.list,
      'notifications.markRead':   notifications.markRead,
      'notifications.markAllRead': notifications.markAllRead,

      // 举报
      'reports.create':   reports.create,
      'reports.list':     reports.list,
      'reports.resolve':  reports.resolve,

      // 地图服务
      'map.geocoder':     map.geocoder,
      'map.search':       map.search,
    };

    const handler = routeMap[action];
    if (!handler) {
      return { code: 404, message: '接口不存在: ' + action };
    }

    const result = await handler(event, wxContext);
    return result;

  } catch (err) {
    // 已知业务错误（带 code 字段）
    if (err && err.code) {
      return { code: err.code, message: err.message };
    }
    // 未知错误
    console.error('[cloud function error]', action, err);
    return { code: -1, message: '服务器内部错误' };
  }
};
