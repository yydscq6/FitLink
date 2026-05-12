/**
 * 工具模块单元测试
 * 覆盖：缓存、指标、错误上报、信誉分
 */

const { MemoryCache, cache } = require('../utils/cache');
const { metricsMiddleware, getMetrics, resetMetrics } = require('../utils/metrics');
const { reportError, getErrorStats } = require('../utils/errorReport');

// =============================================
// 缓存测试
// =============================================
describe('MemoryCache 缓存', () => {
  let c;
  beforeEach(() => { c = new MemoryCache(10, 100); });

  test('set + get 基本读写', () => {
    c.set('key1', 'value1');
    expect(c.get('key1')).toBe('value1');
  });

  test('get 不存在的 key 返回 undefined', () => {
    expect(c.get('not_exist')).toBeUndefined();
  });

  test('TTL 过期后返回 undefined', async () => {
    c.set('ttl_key', 'data', 50);   // 50ms TTL
    expect(c.get('ttl_key')).toBe('data');
    await new Promise(r => setTimeout(r, 60));
    expect(c.get('ttl_key')).toBeUndefined();
  });

  test('del 删除指定 key', () => {
    c.set('a', 1);
    c.set('b', 2);
    c.del('a');
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
  });

  test('delByPrefix 批量删除', () => {
    c.set('nearby:1', 'a');
    c.set('nearby:2', 'b');
    c.set('team:1', 'c');
    c.delByPrefix('nearby:');
    expect(c.get('nearby:1')).toBeUndefined();
    expect(c.get('nearby:2')).toBeUndefined();
    expect(c.get('team:1')).toBe('c');
  });

  test('clear 清空所有', () => {
    c.set('x', 1);
    c.set('y', 2);
    c.clear();
    expect(c.size).toBe(0);
  });

  test('LRU 淘汰：超出 maxSize 时移除最老的条目', () => {
    for (let i = 0; i < 12; i++) c.set('k' + i, i);
    expect(c.size).toBe(10);
    expect(c.get('k0')).toBeUndefined();   // 最老的被淘汰
    expect(c.get('k1')).toBeUndefined();
    expect(c.get('k11')).toBe(11);          // 最新的还在
  });

  test('stats 命中率统计', () => {
    c.set('a', 1);
    c.get('a');   // hit
    c.get('b');   // miss
    const s = c.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
    expect(s.hitRate).toBe('50.0%');
  });
});

// =============================================
// 指标测试
// =============================================
describe('Metrics 指标采集', () => {
  beforeEach(() => { resetMetrics(); });

  test('getMetrics 返回空指标初始状态', () => {
    const m = getMetrics();
    expect(m.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Object.keys(m.endpoints).length).toBe(0);
  });

  test('metricsMiddleware 采集请求数据', () => {
    const req = { method: 'GET', path: '/api/test', route: { path: '/api/test' } };
    const res = new (require('events').EventEmitter)();
    res.statusCode = 200;
    const next = () => {};
    metricsMiddleware(req, res, next);
    res.emit('finish');
    const m = getMetrics();
    expect(m.endpoints['GET /api/test']).toBeDefined();
    expect(m.endpoints['GET /api/test'].totalRequests).toBe(1);
  });
});

// =============================================
// 错误上报测试
// =============================================
describe('ErrorReport 错误上报', () => {
  test('reportError 记录错误并可在 stats 中查看', () => {
    reportError(new Error('测试错误'));
    const stats = getErrorStats();
    expect(stats.recentCount).toBeGreaterThanOrEqual(1);
  });

  test('reportError 同一错误 1 分钟内去重', () => {
    reportError(new Error('重复错误'));
    reportError(new Error('重复错误'));
    reportError(new Error('重复错误'));
    const stats = getErrorStats();
    // 去重后只记 1 条
    const found = stats.recent.filter(r => r.message === '重复错误');
    expect(found.length).toBe(1);
  });
});

// =============================================
// 信誉分测试
// =============================================
describe('Credit 信誉分', () => {
  const { adjustCredit } = require('../utils/credit');
  const db = require('../db/database');

  beforeAll(async () => {
    await require('../db/database').initDatabase();
  });

  test('adjustCredit 正确调整信誉分', () => {
    // 创建测试用户
    const info = db.prepare("INSERT INTO users (openid, nickname, creditScore) VALUES (?, ?, ?)").run('credit_test_1', '信誉测试用户', 100);
    const userId = info.lastInsertRowid;
    adjustCredit(userId, -10, '测试扣分');
    const user = db.prepare('SELECT creditScore FROM users WHERE id = ?').get(userId);
    expect(user.creditScore).toBe(90);
  });

  test('信誉分不低于 0', () => {
    const info = db.prepare("INSERT INTO users (openid, nickname, creditScore) VALUES (?, ?, ?)").run('credit_test_2', '低分用户', 3);
    const userId = info.lastInsertRowid;
    adjustCredit(userId, -10, '超额扣分');
    const user = db.prepare('SELECT creditScore FROM users WHERE id = ?').get(userId);
    expect(user.creditScore).toBe(0);
  });

  test('信誉分不高于 200', () => {
    const info = db.prepare("INSERT INTO users (openid, nickname, creditScore) VALUES (?, ?, ?)").run('credit_test_3', '高分用户', 198);
    const userId = info.lastInsertRowid;
    adjustCredit(userId, 10, '超额加分');
    const user = db.prepare('SELECT creditScore FROM users WHERE id = ?').get(userId);
    expect(user.creditScore).toBe(200);
  });
});
