/**
 * 错误上报工具
 * - 全局未捕获异常记录
 * - 错误统计（按类型聚合，防刷屏）
 * - 未来可接入 Sentry / 微信云函数等第三方
 */

const logger = require('./logger');

// 错误统计（1 分钟内同一错误只报告一次）
const errorCounts = new Map();
const REPORT_INTERVAL = 60 * 1000; // 1 分钟

/**
 * 上报错误（带去重）
 * @param {Error|string} err - 错误对象或消息
 * @param {object} context - 额外上下文（url, userId, etc）
 */
function reportError(err, context = {}) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : '';
  const key = message.substring(0, 100);

  // 去重：同一错误 1 分钟内只记录一次
  const now = Date.now();
  const lastReport = errorCounts.get(key);
  if (lastReport && now - lastReport < REPORT_INTERVAL) return;
  errorCounts.set(key, now);

  // 定期清理过期条目
  if (errorCounts.size > 1000) {
    for (const [k, t] of errorCounts) {
      if (now - t > REPORT_INTERVAL) errorCounts.delete(k);
    }
  }

  logger.error(`[错误上报] ${message}`, {
    stack: stack ? stack.split('\n').slice(0, 5).join('\n') : '',
    ...context,
  });

  // TODO: 接入第三方错误监控（Sentry / 微信云开发 / 自建）
  // if (process.env.SENTRY_DSN) {
  //   Sentry.captureException(err, { extra: context });
  // }
}

/**
 * Express 错误处理中间件
 */
function errorMiddleware(err, req, res, next) {
  reportError(err, {
    url: req.originalUrl,
    method: req.method,
    userId: req.user ? req.user.id : null,
  });
  res.status(500).json({ code: -1, message: '服务器内部错误' });
}

/**
 * 获取错误统计（管理接口用）
 */
function getErrorStats() {
  const now = Date.now();
  const recent = [];
  for (const [message, timestamp] of errorCounts) {
    if (now - timestamp < 5 * 60 * 1000) {
      recent.push({ message, timestamp });
    }
  }
  return {
    recentCount: recent.length,
    recent: recent.slice(0, 20),
  };
}

module.exports = { reportError, errorMiddleware, getErrorStats };
