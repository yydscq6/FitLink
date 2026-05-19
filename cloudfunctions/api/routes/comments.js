const { db, _, cloud } = require('../utils/db');
const { getCurrentUser, requireAuth } = require('../utils/auth');

async function createNotification(userId, type, title, content, teamId) {
  try {
    await db.collection('notifications').add({
      data: { userId, type, title, content: content || '', teamId: teamId || null, isRead: 0, createdAt: db.serverDate() },
    });
  } catch (e) {
    console.error('[createNotification] error:', e.message);
  }
}

const routes = {};

// GET /comments/:teamId
routes.list = async (event, wxContext) => {
  const { teamId, page = 1, pageSize = 50 } = event;
  if (!teamId) return { code: -1, message: '参数错误' };

  const pageNum = Math.max(1, parseInt(page));
  const sizeNum = Math.min(100, parseInt(pageSize));

  // 获取当前用户（可能未登录）
  const currentUser = await getCurrentUser(wxContext);
  const currentUserId = currentUser ? currentUser._id : null;

  // 获取所有评论
  const { data: allComments } = await db.collection('comments').where({ teamId }).orderBy('createdAt', 'asc').limit(500).get();

  // 获取点赞信息
  const commentIds = allComments.map(c => c._id);
  const likeCounts = {};
  const likedSet = new Set();

  if (commentIds.length > 0) {
    // 分批查询点赞数
    for (let i = 0; i < commentIds.length; i += 50) {
      const batch = commentIds.slice(i, i + 50);
      const { data: likes } = await db.collection('comment_likes').where({ commentId: _.in(batch) }).get();
      likes.forEach(l => {
        likeCounts[l.commentId] = (likeCounts[l.commentId] || 0) + 1;
        if (currentUserId && l.userId === currentUserId) likedSet.add(l.commentId);
      });
    }
  }

  // 获取用户信息
  const userIds = [...new Set(allComments.map(c => c.userId))];
  const userMap = {};
  for (const uid of userIds) {
    try {
      const { data: u } = await db.collection('users').doc(uid).get();
      userMap[uid] = { _id: u._id, nickname: u.nickname, avatarUrl: u.avatarUrl };
    } catch (e) {
      userMap[uid] = { _id: uid, nickname: '未知', avatarUrl: '' };
    }
  }

  // 批量解析用户头像云存储 fileID → 临时 URL
  const avatarFileIDs = Object.values(userMap)
    .map(u => u.avatarUrl)
    .filter(url => url && url.startsWith('cloud://'));
  if (avatarFileIDs.length > 0) {
    try {
      const { fileList } = await cloud.getTempFileURL({ fileList: [...new Set(avatarFileIDs)] });
      const urlMap = {};
      for (const f of (fileList || [])) {
        if (f.fileID && f.tempFileURL) urlMap[f.fileID] = f.tempFileURL;
      }
      for (const uid of Object.keys(userMap)) {
        if (urlMap[userMap[uid].avatarUrl]) {
          userMap[uid].avatarUrl = urlMap[userMap[uid].avatarUrl];
        }
      }
    } catch (e) {
      console.error('[comments.list] getTempFileURL error:', e.message);
    }
  }

  // 分离主评论和回复
  const parents = allComments.filter(c => !c.parentId || c.parentId === 0);
  const replies = allComments.filter(c => c.parentId && c.parentId !== 0);

  const replyMap = {};
  replies.forEach(r => {
    if (!replyMap[r.parentId]) replyMap[r.parentId] = [];
    replyMap[r.parentId].push(r);
  });

  const total = parents.length;
  const start = (pageNum - 1) * sizeNum;
  const list = parents.slice(start, start + sizeNum).map(c => ({
    _id: c._id,
    content: c.content,
    createdAt: c.createdAt,
    userId: userMap[c.userId] || { _id: c.userId, nickname: '未知', avatarUrl: '' },
    likeCount: likeCounts[c._id] || 0,
    isLiked: likedSet.has(c._id),
    replies: (replyMap[c._id] || []).map(r => ({
      _id: r._id,
      content: r.content,
      createdAt: r.createdAt,
      userId: userMap[r.userId] || { _id: r.userId, nickname: '未知', avatarUrl: '' },
      replyToId: r.parentId,
      likeCount: likeCounts[r._id] || 0,
      isLiked: likedSet.has(r._id),
    })),
  }));

  return { code: 0, data: { list, pagination: { page: pageNum, pageSize: sizeNum, total } } };
};

// POST /comments/:teamId
routes.create = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const { teamId, content, parentId } = event;
  if (!teamId) return { code: -1, message: '参数错误' };
  if (!content || !content.trim()) return { code: -1, message: '请输入评论内容' };
  if (content.trim().length > 500) return { code: -1, message: '评论不能超过500字' };

  let team;
  try { const { data } = await db.collection('teams').doc(teamId).get(); team = data; }
  catch (e) { return { code: -1, message: '组局不存在' }; }

  // 检查是否为成员
  const { data: membership } = await db.collection('team_members').where({ teamId, userId: user._id }).limit(1).get();
  if (membership.length === 0) return { code: -1, message: '只有组局成员才能评论' };

  // 回复验证
  const pid = parentId || '';
  if (pid) {
    try {
      const { data: parentComment } = await db.collection('comments').doc(pid).get();
      if (!parentComment || parentComment.teamId !== teamId) return { code: -1, message: '回复的评论不存在' };
    } catch (e) {
      return { code: -1, message: '回复的评论不存在' };
    }
  }

  await db.collection('comments').add({
    data: {
      teamId,
      userId: user._id,
      content: content.trim(),
      parentId: pid || '',
      createdAt: db.serverDate(),
    },
  });

  // 通知
  if (pid) {
    try {
      const { data: parentComment } = await db.collection('comments').doc(pid).get();
      if (parentComment && parentComment.userId !== user._id) {
        await createNotification(parentComment.userId, 'reply', '评论回复', user.nickname + ' 回复了你的评论', teamId);
      }
    } catch (e) {}
  } else {
    if (team.leaderId !== user._id) {
      await createNotification(team.leaderId, 'comment', '新评论', user.nickname + ' 在「' + team.title + '」中发表了评论', teamId);
    }
  }

  return { code: 0, message: pid ? '回复成功' : '评论成功' };
};

// POST /comments/:commentId/like
routes.like = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const { commentId } = event;
  if (!commentId) return { code: -1, message: '参数错误' };

  try { await db.collection('comments').doc(commentId).get(); }
  catch (e) { return { code: -1, message: '评论不存在' }; }

  const { data: existing } = await db.collection('comment_likes').where({ commentId, userId: user._id }).limit(1).get();
  if (existing.length > 0) return { code: -1, message: '已经点赞过了' };

  await db.collection('comment_likes').add({ data: { commentId, userId: user._id, createdAt: db.serverDate() } });

  const { total } = await db.collection('comment_likes').where({ commentId }).count();
  return { code: 0, data: { likeCount: total, isLiked: true }, message: '点赞成功' };
};

// DELETE /comments/:commentId/like
routes.unlike = async (event, wxContext) => {
  const user = await requireAuth(wxContext);
  const { commentId } = event;
  if (!commentId) return { code: -1, message: '参数错误' };

  const { data: existing } = await db.collection('comment_likes').where({ commentId, userId: user._id }).limit(1).get();
  if (existing.length === 0) return { code: -1, message: '未点赞过' };

  await db.collection('comment_likes').doc(existing[0]._id).remove();

  const { total } = await db.collection('comment_likes').where({ commentId }).count();
  return { code: 0, data: { likeCount: total, isLiked: false }, message: '取消点赞' };
};

module.exports = routes;
