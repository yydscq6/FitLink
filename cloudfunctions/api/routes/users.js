const { db, cloud } = require('../utils/db');
const { requireAuth } = require('../utils/auth');
const { refreshActivityStats } = require('../utils/activity');

const routes = {};

// POST /users/login
routes.login = async (event, wxContext) => {
  const openid = wxContext.OPENID;
  if (!openid) return { code: -1, message: '获取 openid 失败' };

  const { data: existing } = await db.collection('users').where({ openid }).limit(1).get();
  let user;
  if (existing.length > 0) {
    user = existing[0];
  } else {
    const now = new Date().toISOString();
    const res = await db.collection('users').add({
      data: {
        openid,
        nickname: '微信用户',
        avatarUrl: '',
        phone: '',
        creditScore: 100,
        sportPrefs: '',
        isDeleted: 0,
        // 活跃度字段
        lastActiveAt: now,
        joinCount30d: 0,
        createCount30d: 0,
        activeLevel: 'mid',
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });
    const { data } = await db.collection('users').doc(res._id).get();
    user = data;
  }
  return {
    code: 0,
    data: {
      token: openid,   // 云开发直接用 openid 做标识
      userInfo: {
        id: user._id,
        openid: user.openid,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        creditScore: user.creditScore,
        sportPrefs: user.sportPrefs || '',
      },
    },
  };
};

// GET /users/me
routes.getMe = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  return {
    code: 0,
    data: {
      id: user._id,
      openid: user.openid,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      creditScore: user.creditScore,
      sportPrefs: user.sportPrefs || '',
      activeLevel: user.activeLevel || 'mid',
    },
  };
};

// PUT /users/me
routes.updateMe = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const updates = {};
  if (event.nickname !== undefined) updates.nickname = event.nickname;
  if (event.avatarUrl !== undefined) updates.avatarUrl = event.avatarUrl;
  if (event.sportPrefs !== undefined) updates.sportPrefs = event.sportPrefs;
  if (Object.keys(updates).length === 0) return { code: -1, message: '没有要更新的内容' };
  updates.updatedAt = db.serverDate();
  await db.collection('users').doc(user._id).update({ data: updates });
  const { data: updated } = await db.collection('users').doc(user._id).get();
  return {
    code: 0,
    data: {
      id: updated._id,
      nickname: updated.nickname,
      avatarUrl: updated.avatarUrl,
      creditScore: updated.creditScore,
      sportPrefs: updated.sportPrefs || '',
    },
  };
};

// GET /users/:id
routes.getById = async (event) => {
  const userId = event.userId;
  if (!userId) return { code: -1, message: '缺少用户 ID' };
  try {
    const { data } = await db.collection('users').doc(userId).get();
    return {
      code: 0,
      data: {
        id: data._id,
        nickname: data.nickname,
        avatarUrl: data.avatarUrl,
        creditScore: data.creditScore,
        sportPrefs: data.sportPrefs || '',
        createdAt: data.createdAt,
      },
    };
  } catch (e) {
    return { code: -1, message: '用户不存在' };
  }
};

// POST /users/delete-account
routes.deleteAccount = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const { confirmText } = event;
  if (confirmText !== '确认注销') return { code: -1, message: '请输入"确认注销"以继续' };

  // 1. 匿名化用户信息（保留 openid 用于云函数鉴权，清除所有个人信息）
  await db.collection('users').doc(user._id).update({
    data: {
      nickname: '已注销用户',
      avatarUrl: '',
      phone: '',
      sportPrefs: '',
      isDeleted: 1,
      updatedAt: db.serverDate(),
    },
  });

  // 2. 退出所有加入的组局
  try {
    const { data: memberships } = await db.collection('team_members').where({ userId: user._id, role: _.neq('leader') }).get();
    for (const m of memberships) {
      await db.collection('team_members').doc(m._id).remove();
      // 减少队伍人数
      try {
        const { data: t } = await db.collection('teams').doc(m.teamId).get();
        if (t && t.currentMembers > 1) {
          await db.collection('teams').doc(m.teamId).update({
            data: { currentMembers: t.currentMembers - 1, updatedAt: db.serverDate() },
          });
        }
      } catch (e) {}
    }
  } catch (e) {
    console.error('[deleteAccount] quit teams error:', e.message);
  }

  // 3. 取消自己创建的招募中的组局
  try {
    const { data: myTeams } = await db.collection('teams').where({ leaderId: user._id, status: 'recruiting' }).get();
    for (const t of myTeams) {
      await db.collection('teams').doc(t._id).update({
        data: { status: 'cancelled', updatedAt: db.serverDate() },
      });
    }
  } catch (e) {
    console.error('[deleteAccount] cancel teams error:', e.message);
  }

  // 4. 删除收藏记录
  try {
    const { data: favs } = await db.collection('favorites').where({ userId: user._id }).get();
    for (const f of favs) {
      await db.collection('favorites').doc(f._id).remove();
    }
  } catch (e) {}

  return { code: 0, message: '账号已注销' };
};

module.exports = routes;
