require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDatabase } = require('./db/database');
const db = require('./db/database');
const logger = require('./utils/logger');
const { generalLimiter, sanitizeMiddleware } = require('./utils/security');
const mapProxy = require('./routes/mapProxy');
const usersRouter = require('./routes/users');
const teamsRouter = require('./routes/teams');
const commentsRouter = require('./routes/comments');
const notificationsRouter = require('./routes/notifications');
const reportsRouter = require('./routes/reports');
const uploadRouter = require('./routes/upload');
const { sendActivityReminder } = require('./utils/wechatMessage');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ============ 生产环境启动检查 ============
if (NODE_ENV === 'production') {
  const missing = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) missing.push('JWT_SECRET（≥16位强密钥）');
  if (!process.env.WX_APPID) missing.push('WX_APPID');
  if (!process.env.WX_SECRET || process.env.WX_SECRET === 'your_app_secret_here') missing.push('WX_SECRET');
  if (missing.length > 0) {
    console.error(`[启动] 生产环境缺少必要配置: ${missing.join(', ')}`);
    console.error('[启动] 请复制 .env.example 为 .env 并填入真实值');
    process.exit(1);
  }
  if (!process.env.CORS_ORIGINS || process.env.CORS_ORIGINS.includes('*')) {
    console.warn('[启动] 警告: 生产环境 CORS_ORIGINS 未限制，存在安全风险');
  }
}

// CORS — 生产环境限定域名，开发环境允许全部
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : ['*'];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
}));

// JSON 解析
app.use(express.json({ limit: '1mb', type: 'application/json' }));
app.use(express.text({ type: 'text/plain' }));

// 数据埋点（请求指标采集）
const { metricsMiddleware, getMetrics } = require('./utils/metrics');
app.use('/api/', metricsMiddleware);

// 全局限流
app.use('/api/', generalLimiter);

// XSS 消毒
app.use('/api/', sanitizeMiddleware);

// 请求日志
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? 'warn' : 'info';
    logger[level](`${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ code: 0, message: 'ok', timestamp: Date.now() });
});

// 用户路由
app.use('/api/users', usersRouter);

// 组局路由
app.use('/api/teams', teamsRouter);

// 评论路由
app.use('/api/comments', commentsRouter);

// 通知路由
app.use('/api/notifications', notificationsRouter);

// 举报路由
app.use('/api/reports', reportsRouter);

// 地图代理路由
app.use('/api/map', mapProxy);

// 文件上传路由
app.use('/api/upload', uploadRouter);

// 静态文件：上传的图片
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '7d',
  immutable: true,
}));

// 未匹配路由
app.use('/api/*', (req, res) => {
  res.json({ code: 404, message: '接口不存在' });
});

// 全局错误处理（集成错误上报）
const { errorMiddleware, reportError, getErrorStats } = require('./utils/errorReport');
app.use(errorMiddleware);

// 错误统计接口（管理员可用）
app.get('/api/stats/errors', (req, res) => {
  res.json({ code: 0, data: getErrorStats() });
});

// 请求指标统计接口
app.get('/api/stats/metrics', (req, res) => {
  res.json({ code: 0, data: getMetrics() });
});

// Node.js 未捕获异常处理（接入错误上报）
process.on('uncaughtException', (err) => {
  reportError(err, { type: 'uncaughtException' });
});
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  reportError(err, { type: 'unhandledRejection' });
});

/**
 * 定时任务：自动将过期组局状态改为 ended
 * 每 5 分钟执行一次
 */
function autoExpireTeams() {
  try {
    const now = new Date().toISOString();
    const expired = db.prepare(
      "SELECT * FROM teams WHERE status = 'recruiting' AND endTime < ?"
    ).all(now);

    if (expired.length > 0) {
      db.prepare(
        "UPDATE teams SET status = 'ended', updatedAt = datetime('now') WHERE status = 'recruiting' AND endTime < ?"
      ).run(now);
      logger.info(`定时任务: 自动结束 ${expired.length} 个过期组局`);
    }
  } catch (err) {
    logger.error(`定时任务: 自动过期失败: ${err.message}`);
  }
}

/**
 * 定时任务：活动开始前 1 小时发送提醒
 * 每 10 分钟检查一次
 */
async function sendActivityReminders() {
  try {
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);

    // 查找 50~70 分钟后开始的招募中组局（避免重复发送）
    const upcoming = db.prepare(
      "SELECT t.*, u.openid FROM teams t JOIN users u ON t.leaderId = u.id WHERE t.status = 'recruiting' AND t.startTime > ? AND t.startTime <= ?"
    ).all(tenMinAgo.toISOString(), oneHourLater.toISOString());

    for (const team of upcoming) {
      // 检查是否已发过提醒（用通知表去重）
      const reminded = db.prepare(
        "SELECT id FROM notifications WHERE teamId = ? AND type = 'reminder' AND createdAt > datetime('now', '-2 hours')"
      ).get(team.id);
      if (reminded) continue;

      // 获取所有成员
      const members = db.prepare(
        'SELECT tm.userId, u.openid FROM team_members tm JOIN users u ON tm.userId = u.id WHERE tm.teamId = ?'
      ).all(team.id);

      const startTimeStr = new Date(team.startTime).toLocaleString('zh-CN', { hour12: false });
      for (const member of members) {
        // 内站通知
        db.prepare(
          'INSERT INTO notifications (userId, type, title, content, teamId) VALUES (?, ?, ?, ?, ?)'
        ).run(member.userId, 'reminder', '活动提醒', '「' + team.title + '」将在约 1 小时后开始，请做好准备！', team.id);

        // 微信订阅消息（需要配置）
        if (member.openid && !member.openid.startsWith('dev_')) {
          sendActivityReminder(member.openid, team.title, startTimeStr, team.locationName, team.id).catch(() => {});
        }
      }
      logger.info(`活动提醒: 已发送 team=${team.id} members=${members.length}`);
    }
  } catch (err) {
    logger.error(`定时任务: 活动提醒失败: ${err.message}`);
  }
}

// 导出 app（供测试用）和启动函数
module.exports = { app, startServer };

async function startServer() {
  await initDatabase();
  autoExpireTeams();
  setInterval(autoExpireTeams, 5 * 60 * 1000);
  // 活动提醒（每 10 分钟检查）
  sendActivityReminders();
  setInterval(sendActivityReminders, 10 * 60 * 1000);
  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      logger.info(`服务器启动成功，监听端口 ${PORT}`);
      if (!process.env.QQ_MAP_KEY) {
        logger.warn('QQ_MAP_KEY 未配置，地图功能不可用');
      }
      // 启动 WebSocket 实时消息服务
      const { initWebSocket, getOnlineCount } = require('./utils/websocket');
      initWebSocket(server);
      // WebSocket 在线统计接口
      app.get('/api/stats/online', (req, res) => {
        res.json({ code: 0, data: { onlineUsers: getOnlineCount() } });
      });
      resolve(server);
    });
  });
}

// 直接运行时启动（非 require 时）
if (require.main === module) {
  startServer().catch((err) => {
    logger.error(`启动失败: ${err.message}`);
    process.exit(1);
  });
}
