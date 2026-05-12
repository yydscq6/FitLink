/**
 * 内存缓存工具
 * - TTL（过期时间）支持
 * - LRU 淘汰策略（最大条目数限制）
 * - 统计命中率
 */

class MemoryCache {
  /**
   * @param {number} maxSize  最大缓存条目数（默认 500）
   * @param {number} defaultTTL  默认 TTL，单位毫秒（默认 60s）
   */
  constructor(maxSize = 500, defaultTTL = 60000) {
    this._store = new Map();   // key → { value, expiresAt }
    this._maxSize = maxSize;
    this._defaultTTL = defaultTTL;
    this._hits = 0;
    this._misses = 0;
  }

  /**
   * 写入缓存
   * @param {string} key
   * @param {*} value
   * @param {number} [ttl]  自定义 TTL（毫秒），默认使用构造时的 defaultTTL
   */
  set(key, value, ttl) {
    // 淘汰最老的条目
    if (this._store.size >= this._maxSize) {
      const oldest = this._store.keys().next().value;
      this._store.delete(oldest);
    }
    this._store.set(key, {
      value,
      expiresAt: Date.now() + (ttl || this._defaultTTL),
    });
  }

  /**
   * 读取缓存，过期返回 undefined
   * @param {string} key
   * @returns {*|undefined}
   */
  get(key) {
    const entry = this._store.get(key);
    if (!entry) { this._misses++; return undefined; }
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      this._misses++;
      return undefined;
    }
    // LRU：重新插入到末尾（Map 按插入顺序迭代）
    this._store.delete(key);
    this._store.set(key, entry);
    this._hits++;
    return entry.value;
  }

  /**
   * 删除指定 key
   */
  del(key) {
    this._store.delete(key);
  }

  /**
   * 按前缀批量清除
   * @param {string} prefix
   */
  delByPrefix(prefix) {
    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) this._store.delete(key);
    }
  }

  /**
   * 清空全部缓存
   */
  clear() {
    this._store.clear();
    this._hits = 0;
    this._misses = 0;
  }

  /**
   * 当前条目数
   */
  get size() {
    return this._store.size;
  }

  /**
   * 命中率统计
   */
  stats() {
    const total = this._hits + this._misses;
    return {
      size: this._store.size,
      hits: this._hits,
      misses: this._misses,
      hitRate: total > 0 ? (this._hits / total * 100).toFixed(1) + '%' : 'N/A',
    };
  }
}

// 全局单例 — 业务缓存实例
const cache = new MemoryCache(500, 60000);   // 500条目，默认60s TTL

module.exports = { MemoryCache, cache };
