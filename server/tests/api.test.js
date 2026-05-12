/**
 * API 集成测试
 * 使用 supertest 测试核心接口（不需要启动服务器，supertest 自动分配端口）
 */
const request = require('supertest');
const { initDatabase, closeDatabase } = require('../db/database');
const app = require('../app').app;

let authToken;
let userId;

beforeAll(async () => {
  // 只初始化数据库，不启动 HTTP 服务器
  await initDatabase();
}, 15000);

afterAll(() => {
  closeDatabase();
});

describe('健康检查', () => {
  test('GET /api/health 返回 ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.message).toBe('ok');
  });
});

describe('用户登录', () => {
  test('POST /api/users/login 无 code 返回错误', async () => {
    const res = await request(app)
      .post('/api/users/login')
      .send({});
    expect(res.body.code).toBe(-1);
    expect(res.body.message).toContain('code');
  });

  test('POST /api/users/login 开发模式登录成功', async () => {
    const res = await request(app)
      .post('/api/users/login')
      .send({ code: 'test_code_001' });
    expect(res.body.code).toBe(0);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data).toHaveProperty('userInfo');
    authToken = res.body.data.token;
    userId = res.body.data.userInfo.id;
  });
});

describe('用户信息', () => {
  test('GET /api/users/me 需要登录', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.body.code).toBe(401);
  });

  test('GET /api/users/me 返回用户信息', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data).toHaveProperty('nickname');
    expect(res.body.data).toHaveProperty('sportPrefs');
  });

  test('PUT /api/users/me 更新昵称', async () => {
    const res = await request(app)
      .put('/api/users/me')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ nickname: '测试用户' });
    expect(res.body.code).toBe(0);
    expect(res.body.data.nickname).toBe('测试用户');
  });

  test('PUT /api/users/me 敏感词昵称被拦截', async () => {
    const res = await request(app)
      .put('/api/users/me')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ nickname: '色情大王' });
    expect(res.body.code).toBe(-1);
    expect(res.body.message).toContain('违规');
  });
});

describe('用户公开资料', () => {
  test('GET /api/users/:id 返回公开资料', async () => {
    const res = await request(app).get(`/api/users/${userId}`);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toHaveProperty('nickname');
    expect(res.body.data).toHaveProperty('creditScore');
    expect(res.body.data).toHaveProperty('stats');
    expect(res.body.data.stats).toHaveProperty('createdCount');
    expect(res.body.data.stats).toHaveProperty('joinedCount');
    expect(res.body.data).toHaveProperty('createdTeams');
    expect(res.body.data).toHaveProperty('joinedTeams');
    expect(Array.isArray(res.body.data.createdTeams)).toBe(true);
  });

  test('GET /api/users/99999 用户不存在', async () => {
    const res = await request(app).get('/api/users/99999');
    expect(res.body.code).toBe(-1);
    expect(res.body.message).toContain('不存在');
  });
});

describe('组局 CRUD', () => {
  let teamId;

  test('GET /api/teams/nearby 返回列表', async () => {
    const res = await request(app)
      .get('/api/teams/nearby')
      .query({ longitude: 116.4074, latitude: 39.9042, radius: 5000 });
    expect(res.body.code).toBe(0);
    expect(res.body.data.data).toHaveProperty('list');
    expect(res.body.data.data).toHaveProperty('favoriteIds');
  });

  test('POST /api/teams 创建组局', async () => {
    const res = await request(app)
      .post('/api/teams')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        sportType: 'basketball',
        title: '测试篮球局',
        description: '测试描述',
        location: { name: '测试球馆', address: '测试地址', longitude: 116.41, latitude: 39.91 },
        activityTime: new Date(Date.now() + 86400000).toISOString(),
        maxMembers: 10,
        fee: 'AA',
        contact: '13800138000',
      });
    expect(res.body.code).toBe(0);
    expect(res.body.data).toHaveProperty('_id');
    teamId = res.body.data._id;
  });

  test('POST /api/teams 敏感词标题被拦截', async () => {
    const res = await request(app)
      .post('/api/teams')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        sportType: 'basketball',
        title: '色情篮球局',
        location: { name: '球馆', longitude: 116.41, latitude: 39.91 },
        activityTime: new Date(Date.now() + 86400000).toISOString(),
        maxMembers: 10,
      });
    expect(res.body.code).toBe(-1);
    expect(res.body.message).toContain('违规');
  });

  test('GET /api/teams/:id 获取详情', async () => {
    if (!teamId) return;
    const res = await request(app)
      .get(`/api/teams/${teamId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.body.code).toBe(0);
    expect(res.body.data.title).toBe('测试篮球局');
    expect(res.body.data).toHaveProperty('isFavorited');
  });

  test('PUT /api/teams/:id 编辑组局', async () => {
    if (!teamId) return;
    const res = await request(app)
      .put(`/api/teams/${teamId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        title: '修改后的篮球局',
        maxMembers: 15,
        fee: 'AA制',
      });
    expect(res.body.code).toBe(0);
    expect(res.body.data.title).toBe('修改后的篮球局');
    expect(res.body.data.maxMembers).toBe(15);
    expect(res.body.data.fee).toBe('AA制');
  });

  test('PUT /api/teams/:id 敏感词标题被拦截', async () => {
    if (!teamId) return;
    const res = await request(app)
      .put(`/api/teams/${teamId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: '色情修改测试' });
    expect(res.body.code).toBe(-1);
    expect(res.body.message).toContain('违规');
  });

  test('PUT /api/teams/:id 无修改返回错误', async () => {
    if (!teamId) return;
    const res = await request(app)
      .put(`/api/teams/${teamId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({});
    expect(res.body.code).toBe(-1);
    expect(res.body.message).toContain('没有需要更新');
  });
});

describe('收藏功能', () => {
  let teamId;

  beforeAll(async () => {
    // 创建一个组局用于收藏测试
    const res = await request(app)
      .post('/api/teams')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        sportType: 'badminton',
        title: '收藏测试局',
        location: { name: '球馆', longitude: 116.42, latitude: 39.92 },
        activityTime: new Date(Date.now() + 86400000).toISOString(),
        maxMembers: 6,
      });
    teamId = res.body.data._id;
  });

  test('POST /api/teams/:id/favorite 收藏', async () => {
    const res = await request(app)
      .post(`/api/teams/${teamId}/favorite`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.body.code).toBe(0);
    expect(res.body.data.favorited).toBe(true);
  });

  test('POST /api/teams/:id/favorite 取消收藏', async () => {
    const res = await request(app)
      .post(`/api/teams/${teamId}/favorite`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.body.code).toBe(0);
    expect(res.body.data.favorited).toBe(false);
  });

  test('GET /api/teams/my/favorites 返回收藏列表', async () => {
    const res = await request(app)
      .get('/api/teams/my/favorites')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toHaveProperty('list');
  });
});

describe('举报功能', () => {
  let teamId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/teams')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        sportType: 'football',
        title: '举报测试局',
        location: { name: '球场', longitude: 116.43, latitude: 39.93 },
        activityTime: new Date(Date.now() + 86400000).toISOString(),
        maxMembers: 8,
      });
    teamId = res.body.data._id;
  });

  test('POST /api/reports 提交举报', async () => {
    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        targetType: 'team',
        targetId: teamId,
        reason: 'spam',
        description: '这是垃圾广告',
      });
    expect(res.body.code).toBe(0);
  });

  test('POST /api/reports 重复举报被拦截', async () => {
    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        targetType: 'team',
        targetId: teamId,
        reason: 'spam',
      });
    expect(res.body.code).toBe(-1);
    expect(res.body.message).toContain('已经举报');
  });

  test('POST /api/reports 无效类型被拦截', async () => {
    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        targetType: 'invalid',
        targetId: teamId,
        reason: 'spam',
      });
    expect(res.body.code).toBe(-1);
  });
});

describe('信誉分', () => {
  let creditTeamId;
  let secondAuthToken;
  let secondUserId;

  beforeAll(() => {
    // 清理之前的测试举报数据，避免24小时重复举报拦截
    const db = require('../db/database');
    db.prepare("DELETE FROM reports WHERE reporterId IN (SELECT id FROM users WHERE nickname IN ('测试用户', '微信用户'))").run();
  });

  test('创建第二个用户用于测试信誉分', async () => {
    const res = await request(app)
      .post('/api/users/login')
      .send({ code: 'credit_test_user' });
    expect(res.body.code).toBe(0);
    secondAuthToken = res.body.data.token;

    // 获取第二个用户的实际 id
    const me = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${secondAuthToken}`);
    secondUserId = me.body.data.id;
  });

  test('举报组局后队长信誉分被扣', async () => {
    // 查询第二个用户当前信誉分
    const before = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${secondAuthToken}`);
    const scoreBefore = before.body.data.creditScore;

    // 创建一个新组局专门用于举报测试
    const teamRes = await request(app)
      .post('/api/teams')
      .set('Authorization', `Bearer ${secondAuthToken}`)
      .send({
        sportType: 'basketball',
        title: '周末友谊赛',
        description: '测试用',
        location: {
          name: '测试体育馆',
          address: '测试路1号',
          longitude: 116.4074,
          latitude: 39.9042,
        },
        activityTime: new Date(Date.now() + 3600000).toISOString(),
        maxMembers: 5,
        fee: '免费',
      });
    expect(teamRes.body.code).toBe(0);
    creditTeamId = teamRes.body.data._id;

    // 第一个用户举报该组局（第二个用户是队长）
    const reportRes = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        targetType: 'team',
        targetId: creditTeamId,
        reason: 'fraud',
      });
    if (reportRes.body.code !== 0) {
      console.log('Report failed:', JSON.stringify(reportRes.body), 'creditTeamId:', creditTeamId);
    }
    expect(reportRes.body.code).toBe(0);

    // 查询队长（第二个用户）信誉分应减少
    const after = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${secondAuthToken}`);
    expect(after.body.data.creditScore).toBe(scoreBefore - 5);
  });

  test('用户被举报后信誉分被扣', async () => {
    // 获取第一个用户的当前信誉分
    const before = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${authToken}`);
    const scoreBefore = before.body.data.creditScore;
    const firstUserId = before.body.data.id;

    // 用第二个用户举报第一个用户（避免与之前的举报重复）
    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${secondAuthToken}`)
      .send({
        targetType: 'user',
        targetId: firstUserId,
        reason: 'inappropriate',
      });
    expect(res.body.code).toBe(0);

    const after = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${authToken}`);
    expect(after.body.data.creditScore).toBe(scoreBefore - 5);
  });
});

describe('限流', () => {
  test('未认证请求返回 401', async () => {
    const res = await request(app)
      .post('/api/teams/1/join');
    expect(res.body.code).toBe(401);
  });
});

describe('小程序码', () => {
  test('GET /api/teams/:id/qrcode 不存在的组局返回错误', async () => {
    const res = await request(app)
      .get('/api/teams/99999/qrcode');
    expect(res.body.code).toBe(-1);
  });

  test('GET /api/teams/:id/qrcode 未配置 WX_APPID 时返回占位标记', async () => {
    // 使用之前创建的组局
    const res = await request(app)
      .get('/api/teams/1/qrcode');
    // 未配置 WX_APPID 时返回 code=1 表示不可用
    expect(res.body.code).toBe(1);
    expect(res.body.message).toContain('qrcode_unavailable');
  });
});

describe('组局标签', () => {
  test('创建组局时可带标签', async () => {
    const res = await request(app)
      .post('/api/teams')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        sportType: 'basketball',
        title: '标签测试局',
        description: '测试标签',
        location: { name: '标签馆', address: '标签路', longitude: 116.4, latitude: 39.9 },
        activityTime: new Date(Date.now() + 3600000).toISOString(),
        maxMembers: 5,
        fee: '免费',
        tags: ['新手友好', 'AA制', '无效标签'],
      });
    expect(res.body.code).toBe(0);
    // tags 应只包含有效标签，无效标签被过滤
    expect(res.body.data.tags).toContain('新手友好');
    expect(res.body.data.tags).toContain('AA制');
    expect(res.body.data.tags).not.toContain('无效标签');
  });

  test('编辑组局时可修改标签', async () => {
    // 先创建一个组局
    const createRes = await request(app)
      .post('/api/teams')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        sportType: 'badminton',
        title: '标签编辑测试',
        location: { name: '测试馆', address: '测试路', longitude: 116.4, latitude: 39.9 },
        activityTime: new Date(Date.now() + 3600000).toISOString(),
        maxMembers: 4,
        tags: ['新手友好'],
      });
    const teamId = createRes.body.data._id;

    // 编辑标签
    const editRes = await request(app)
      .put('/api/teams/' + teamId)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ tags: ['高手局', '竞技局'] });
    expect(editRes.body.code).toBe(0);
    expect(editRes.body.data.tags).toContain('高手局');
    expect(editRes.body.data.tags).toContain('竞技局');
    expect(editRes.body.data.tags).not.toContain('新手友好');
  });
});

describe('评论回复与点赞', () => {
  let commentTeamId;
  let parentCommentId;

  beforeAll(async () => {
    // 创建一个测试组局
    const teamRes = await request(app)
      .post('/api/teams')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        sportType: 'running',
        title: '评论测试局',
        location: { name: '评论场', address: '评论路', longitude: 116.4, latitude: 39.9 },
        activityTime: new Date(Date.now() + 3600000).toISOString(),
        maxMembers: 5,
      });
    commentTeamId = teamRes.body.data._id;
  });

  test('发表评论', async () => {
    const res = await request(app)
      .post('/api/comments/' + commentTeamId)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ content: '第一条评论' });
    expect(res.body.code).toBe(0);
  });

  test('获取评论列表含点赞数', async () => {
    const res = await request(app)
      .get('/api/comments/' + commentTeamId);
    expect(res.body.code).toBe(0);
    const list = res.body.data.list;
    expect(list.length).toBeGreaterThan(0);
    parentCommentId = list[0]._id;
    expect(list[0].likeCount).toBe(0);
    expect(list[0].isLiked).toBe(false);
    expect(Array.isArray(list[0].replies)).toBe(true);
  });

  test('回复评论', async () => {
    const res = await request(app)
      .post('/api/comments/' + commentTeamId)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ content: '这是一条回复', parentId: parentCommentId });
    expect(res.body.code).toBe(0);
    expect(res.body.message).toContain('回复成功');
  });

  test('回复列表包含在主评论中', async () => {
    const res = await request(app)
      .get('/api/comments/' + commentTeamId);
    const parent = res.body.data.list.find(c => c._id === parentCommentId);
    expect(parent).toBeTruthy();
    expect(parent.replies.length).toBeGreaterThan(0);
    expect(parent.replies[0].content).toBe('这是一条回复');
  });

  test('点赞评论', async () => {
    const res = await request(app)
      .post('/api/comments/' + parentCommentId + '/like')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.body.code).toBe(0);
    expect(res.body.data.likeCount).toBe(1);
    expect(res.body.data.isLiked).toBe(true);
  });

  test('重复点赞被拦截', async () => {
    const res = await request(app)
      .post('/api/comments/' + parentCommentId + '/like')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.body.code).toBe(-1);
  });

  test('取消点赞', async () => {
    const res = await request(app)
      .delete('/api/comments/' + parentCommentId + '/like')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.body.code).toBe(0);
    expect(res.body.data.likeCount).toBe(0);
    expect(res.body.data.isLiked).toBe(false);
  });
});
