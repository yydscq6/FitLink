/**
 * WebSocket 实时消息服务
 * - 用户连接管理（userId → ws）
 * - 消息推送（单播/组播/广播）
 * - 心跳保活
 * - 用于：实时通知、组局动态、评论提醒
 */

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const logger = require('./logger');

const JWT_SECRET = process.env.JWT_SECRET || 'sport-mini-secret';

// userId → Set<ws>
const userConnections = new Map();
// ws → userId
const wsToUser = new Map();

let wss = null;

/**
 * 初始化 WebSocket 服务器（挂载到 HTTP server 上）
 * @param {http.Server} server
 */
function initWebSocket(server) {
  wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, '缺少认证 token');
      return;
    }

    let userId;
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      userId = decoded.userId;
    } catch (err) {
      ws.close(4002, 'token 无效或已过期');
      return;
    }

    // 注册连接
    if (!userConnections.has(userId)) userConnections.set(userId, new Set());
    userConnections.get(userId).add(ws);
    wsToUser.set(ws, userId);

    logger.info(`[WS] 用户 ${userId} 已连接，当前在线: ${wss.clients.size}`);

    // 发送连接成功消息
    sendToWs(ws, { type: 'connected', userId, timestamp: Date.now() });

    // 心跳
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // 消息处理
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'ping') {
          sendToWs(ws, { type: 'pong', timestamp: Date.now() });
        }
      } catch (e) {}
    });

    // 断开连接
    ws.on('close', () => {
      const uid = wsToUser.get(ws);
      wsToUser.delete(ws);
      if (uid && userConnections.has(uid)) {
        userConnections.get(uid).delete(ws);
        if (userConnections.get(uid).size === 0) userConnections.delete(uid);
      }
      logger.info(`[WS] 用户 ${uid} 断开，当前在线: ${wss.clients.size}`);
    });

    ws.on('error', (err) => {
      logger.warn(`[WS] 连接错误: ${err.message}`);
    });
  });

  // 心跳检测（30 秒一次）
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) { ws.terminate(); return; }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(heartbeat));

  logger.info('[WebSocket] 服务已启动 (path: /ws)');
}

/**
 * 向指定用户推送消息（支持多设备）
 * @param {number} userId
 * @param {object} data
 */
function sendToUser(userId, data) {
  const connections = userConnections.get(userId);
  if (!connections || connections.size === 0) return false;
  const payload = JSON.stringify(data);
  let sent = 0;
  connections.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
      sent++;
    }
  });
  return sent > 0;
}

/**
 * 广播给所有在线用户
 * @param {object} data
 */
function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  });
}

/**
 * 获取在线用户数
 */
function getOnlineCount() {
  return userConnections.size;
}

/**
 * 检查用户是否在线
 */
function isUserOnline(userId) {
  return userConnections.has(userId);
}

/**
 * 向单个 ws 连接发送消息
 */
function sendToWs(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

module.exports = { initWebSocket, sendToUser, broadcast, getOnlineCount, isUserOnline };
