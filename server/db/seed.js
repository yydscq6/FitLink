/**
 * 种子数据脚本 — 初始化测试数据
 * 运行: node db/seed.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('./database');
const { initDatabase } = require('./database');

async function seed() {
  await initDatabase();

  // ====== 用户 ======
  const users = [
    { openid: 'dev_user1', nickname: '篮球小王子',   avatarUrl: '', creditScore: 150 },
    { openid: 'dev_user2', nickname: '羽毛球达人',   avatarUrl: '', creditScore: 120 },
    { openid: 'dev_user3', nickname: '跑步爱好者小李', avatarUrl: '', creditScore: 100 },
    { openid: 'dev_user4', nickname: '足球健将',     avatarUrl: '', creditScore: 90  },
    { openid: 'dev_user5', nickname: '网球少女',     avatarUrl: '', creditScore: 80  },
  ];

  const userIds = [];
  for (const u of users) {
    const existing = db.prepare('SELECT id FROM users WHERE openid = ?').get(u.openid);
    if (existing) {
      userIds.push(existing.id);
    } else {
      const info = db.prepare(
        'INSERT INTO users (openid, nickname, avatarUrl, creditScore) VALUES (?, ?, ?, ?)'
      ).run(u.openid, u.nickname, u.avatarUrl, u.creditScore);
      userIds.push(info.lastInsertRowid);
    }
  }
  console.log('✅ 用户数据已创建，ID:', userIds);

  // ====== 组局 ======
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  const dayAfter = new Date(now.getTime() + 2 * 86400000);

  const teams = [
    {
      leaderIdx: 0, sportType: 'basketball', title: '周末篮球约起来',
      description: '三对三半场，水平不限，开心就好！自带篮球优先',
      locationName: '奥体中心篮球场', locationAddr: '北京市朝阳区奥体中心',
      lng: 116.3974, lat: 39.9928,
      startTime: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 14, 0),
      endTime: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 16, 0),
      maxMembers: 10, fee: 'AA制，人均50元', contact: 'wx_basketball',
    },
    {
      leaderIdx: 1, sportType: 'badminton', title: '周三羽毛球局',
      description: '双打为主，有基础即可，提供球和水',
      locationName: '海淀体育馆', locationAddr: '北京市海淀区中关村南大街',
      lng: 116.3267, lat: 39.9568,
      startTime: new Date(dayAfter.getFullYear(), dayAfter.getMonth(), dayAfter.getDate(), 19, 0),
      endTime: new Date(dayAfter.getFullYear(), dayAfter.getMonth(), dayAfter.getDate(), 21, 0),
      maxMembers: 8, fee: '场地费AA', contact: '13800138001',
    },
    {
      leaderIdx: 2, sportType: 'running', title: '晨跑团招募',
      description: '每天早上6:30奥森公园南门集合，配速5:30-6:30',
      locationName: '奥林匹克森林公园南门', locationAddr: '北京市朝阳区',
      lng: 116.3912, lat: 40.0069,
      startTime: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 6, 30),
      endTime: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 7, 30),
      maxMembers: 20, fee: '免费', contact: 'run_club_wechat',
    },
    {
      leaderIdx: 3, sportType: 'football', title: '五人制足球赛',
      description: '友谊赛，已有3人，还差2人，场地已订好',
      locationName: '朝阳公园足球场', locationAddr: '北京市朝阳区朝阳公园',
      lng: 116.4730, lat: 39.9390,
      startTime: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 10, 0),
      endTime: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 12, 0),
      maxMembers: 10, fee: '人均30元', contact: 'football_captain',
    },
    {
      leaderIdx: 4, sportType: 'tennis', title: '网球新手局',
      description: '适合零基础或初学者，有教练指导，提供球拍',
      locationName: '国家网球中心', locationAddr: '北京市朝阳区林萃路',
      lng: 116.3726, lat: 40.0216,
      startTime: new Date(dayAfter.getFullYear(), dayAfter.getMonth(), dayAfter.getDate(), 15, 0),
      endTime: new Date(dayAfter.getFullYear(), dayAfter.getMonth(), dayAfter.getDate(), 17, 0),
      maxMembers: 6, fee: '人均80元（含教练费）', contact: 'tennis_coach',
    },
  ];

  // 检查是否已有组局数据
  const existingCount = db.prepare('SELECT COUNT(*) as cnt FROM teams').get();
  if (existingCount.cnt > 0) {
    console.log('⚠️ 数据库已有组局数据，跳过种子数据插入');
  } else {
    for (const t of teams) {
      const leaderId = userIds[t.leaderIdx];
      const info = db.prepare(
        `INSERT INTO teams (leaderId, sportType, title, description, locationName, locationAddr, longitude, latitude, startTime, endTime, maxMembers, currentMembers, fee, contact, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'recruiting')`
      ).run(leaderId, t.sportType, t.title, t.description, t.locationName, t.locationAddr,
        t.lng, t.lat, t.startTime.toISOString(), t.endTime.toISOString(), t.maxMembers, t.fee, t.contact);

      // 队长自动加入
      db.prepare("INSERT INTO team_members (teamId, userId, role) VALUES (?, ?, 'leader')")
        .run(info.lastInsertRowid, leaderId);
    }
    console.log('✅ 组局数据已创建，共', teams.length, '条');
  }

  console.log('🎉 种子数据初始化完成！');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ 种子数据初始化失败:', err);
  process.exit(1);
});