/**
 * 数据埋点 / 请求指标工具
 * - 接口 QPS、耗时、错误率统计
 * - 按路径聚合，每分钟重置
 * - `/api/stats/metrics` 接口可查询实时指标
 */

// 指标存储：path → { count, errors, totalMs, maxMs }
let metrics = {};
let startTime = Date.now();

/**
 * Express 中间件：采集每个请求的耗时和状态
 */
function metricsMiddleware(req, res, next) {
  const begin = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - begin;
    const path = _normalizePath(req.route ? req.route.path : req.path);
    const key = `${req.method} ${path}`;

    if (!metrics[key]) {
      metrics[key] = { count: 0, errors: 0, totalMs: 0, maxMs: 0, lastMinute: [] };
    }
    const m = metrics[key];
    m.count++;
    m.totalMs += duration;
    m.maxMs = Math.max(m.maxMs, duration);
    if (res.statusCode >= 400) m.errors++;

    // 滑动窗口：保留最近 60s 的请求时间戳（用于计算 QPS）
    const now = Date.now();
    m.lastMinute.push(now);
    // 清理超过 60s 的记录
    while (m.lastMinute.length > 0 && m.lastMinute[0] < now - 60000) {
      m.lastMinute.shift();
    }
  });
  next();
}

/**
 * 规范化路径（去除 ID 参数，如 /api/teams/123 → /api/teams/:id）
 */
function _normalizePath(path) {
  return path
    .replace(/\/\d+/g, '/:id')
    .replace(/\?.*$/, '');
}

/**
 * 获取当前指标快照
 */
function getMetrics() {
  const result = {};
  const now = Date.now();
  for (const [key, m] of Object.entries(metrics)) {
    const qps = m.lastMinute.filter(t => t > now - 60000).length / 60;
    result[key] = {
      totalRequests: m.count,
      totalErrors: m.errors,
      errorRate: m.count > 0 ? (m.errors / m.count * 100).toFixed(1) + '%' : '0%',
      avgMs: m.count > 0 ? Math.round(m.totalMs / m.count) : 0,
      maxMs: m.maxMs,
      qps: parseFloat(qps.toFixed(2)),
      lastMinuteRequests: m.lastMinute.filter(t => t > now - 60000).length,
    };
  }
  return {
    uptimeSeconds: Math.round((now - startTime) / 1000),
    endpoints: result,
  };
}

/**
 * 重置所有指标
 */
function resetMetrics() {
  metrics = {};
  startTime = Date.now();
}

module.exports = { metricsMiddleware, getMetrics, resetMetrics };
