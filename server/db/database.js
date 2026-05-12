/**
 * 数据库初始化与连接（sql.js，纯 JS SQLite，无需编译原生模块）
 * 提供兼容 better-sqlite3 的同步 API 封装
 *
 * 持久化策略：
 *   1. 每次写操作后立即落盘（saveDatabase）
 *   2. 定时备份（每 5 分钟写入 .bak 文件，防止主文件损坏）
 *   3. 优雅退出：进程退出前确保数据写入
 *   4. 原子写入：先写临时文件，再 rename 替换（防半写损坏）
 */
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'sport.db');
const DB_WAL_PATH = DB_PATH + '-wal';
const DB_BAK_PATH = DB_PATH + '.bak';
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// sql.js 数据库实例（同步封装）
let sqlDb = null;
let backupTimer = null;

/**
 * 初始化数据库（必须在使用前调用）
 */
async function initDatabase() {
  const SQL = await initSqlJs();

  // 启动恢复：如果主文件损坏，尝试从备份恢复
  let dbBuffer = null;
  if (fs.existsSync(DB_PATH)) {
    try {
      dbBuffer = fs.readFileSync(DB_PATH);
      // 尝试打开，验证完整性
      const testDb = new SQL.Database(dbBuffer);
      testDb.close();
    } catch (e) {
      console.warn('[数据库] 主文件损坏，尝试从备份恢复...');
      dbBuffer = null;
      if (fs.existsSync(DB_BAK_PATH)) {
        try {
          const backupBuffer = fs.readFileSync(DB_BAK_PATH);
          const testBackup = new SQL.Database(backupBuffer);
          testBackup.close();
          dbBuffer = backupBuffer;
          // 恢复备份到主文件
          fs.writeFileSync(DB_PATH, backupBuffer);
          console.log('[数据库] 已从备份恢复');
        } catch (e2) {
          console.error('[数据库] 备份也损坏，将创建新数据库');
        }
      }
    }
  }

  if (dbBuffer) {
    sqlDb = new SQL.Database(dbBuffer);
  } else {
    sqlDb = new SQL.Database();
  }

  // 建表
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      openid      TEXT    UNIQUE NOT NULL,
      unionid     TEXT,
      nickname    TEXT    DEFAULT '微信用户',
      avatarUrl   TEXT    DEFAULT '',
      phone       TEXT    DEFAULT '',
      creditScore INTEGER DEFAULT 100,
      createdAt   TEXT    DEFAULT (datetime('now')),
      updatedAt   TEXT    DEFAULT (datetime('now'))
    )
  `);

  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS teams (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      leaderId      INTEGER NOT NULL,
      sportType     TEXT    NOT NULL DEFAULT 'other',
      title         TEXT    NOT NULL,
      description   TEXT    DEFAULT '',
      locationName  TEXT    DEFAULT '',
      locationAddr  TEXT    DEFAULT '',
      longitude     REAL    DEFAULT 0,
      latitude      REAL    DEFAULT 0,
      startTime     TEXT    NOT NULL,
      endTime       TEXT,
      maxMembers    INTEGER NOT NULL DEFAULT 10,
      currentMembers INTEGER NOT NULL DEFAULT 1,
      fee           TEXT    DEFAULT '免费',
      contact       TEXT    DEFAULT '',
      status        TEXT    NOT NULL DEFAULT 'recruiting',
      createdAt     TEXT    DEFAULT (datetime('now')),
      updatedAt     TEXT    DEFAULT (datetime('now')),
      FOREIGN KEY (leaderId) REFERENCES users(id)
    )
  `);

  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS team_members (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      teamId    INTEGER NOT NULL,
      userId    INTEGER NOT NULL,
      role      TEXT    DEFAULT 'member',
      joinedAt  TEXT    DEFAULT (datetime('now')),
      UNIQUE(teamId, userId),
      FOREIGN KEY (teamId) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `);

  // 评论表
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      teamId    INTEGER NOT NULL,
      userId    INTEGER NOT NULL,
      content   TEXT    NOT NULL,
      createdAt TEXT    DEFAULT (datetime('now')),
      FOREIGN KEY (teamId) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `);

  // 通知表
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      userId    INTEGER NOT NULL,
      type      TEXT    NOT NULL,
      title     TEXT    NOT NULL,
      content   TEXT    DEFAULT '',
      teamId    INTEGER,
      isRead    INTEGER DEFAULT 0,
      createdAt TEXT    DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id),
      FOREIGN KEY (teamId) REFERENCES teams(id) ON DELETE SET NULL
    )
  `);

  // 收藏表
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS favorites (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      userId    INTEGER NOT NULL,
      teamId    INTEGER NOT NULL,
      createdAt TEXT    DEFAULT (datetime('now')),
      UNIQUE(userId, teamId),
      FOREIGN KEY (userId) REFERENCES users(id),
      FOREIGN KEY (teamId) REFERENCES teams(id) ON DELETE CASCADE
    )
  `);

  // 用户运动偏好（新增字段，用 ALTER TABLE 安全添加）
  try {
    sqlDb.run("ALTER TABLE users ADD COLUMN sportPrefs TEXT DEFAULT ''");
  } catch (e) {
    // 字段已存在则忽略
  }

  // 用户软删除标记
  try {
    sqlDb.run("ALTER TABLE users ADD COLUMN isDeleted INTEGER DEFAULT 0");
  } catch (e) {
    // 字段已存在则忽略
  }

  // 组局封面图
  try {
    sqlDb.run("ALTER TABLE teams ADD COLUMN coverImage TEXT DEFAULT ''");
  } catch (e) {
    // 字段已存在则忽略
  }

  // 组局标签（JSON 数组，如 '["新手友好","AA制"]'）
  try {
    sqlDb.run("ALTER TABLE teams ADD COLUMN tags TEXT DEFAULT '[]'");
  } catch (e) {
    // 字段已存在则忽略
  }

  // 评论父级（回复功能）
  try {
    sqlDb.run("ALTER TABLE comments ADD COLUMN parentId INTEGER DEFAULT 0");
  } catch (e) {
    // 字段已存在则忽略
  }

  // 评论点赞表
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS comment_likes (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      commentId INTEGER NOT NULL,
      userId    INTEGER NOT NULL,
      createdAt TEXT    DEFAULT (datetime('now')),
      UNIQUE(commentId, userId),
      FOREIGN KEY (commentId) REFERENCES comments(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `);

  // 评论点赞索引
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON comment_likes(commentId)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_comment_likes_user ON comment_likes(userId)');

  // 举报表
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS reports (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      reporterId  INTEGER NOT NULL,
      targetType  TEXT    NOT NULL,
      targetId    INTEGER NOT NULL,
      reason      TEXT    NOT NULL,
      description TEXT    DEFAULT '',
      status      TEXT    DEFAULT 'pending',
      createdAt   TEXT    DEFAULT (datetime('now')),
      resolvedAt  TEXT,
      FOREIGN KEY (reporterId) REFERENCES users(id)
    )
  `);

  // 索引
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_teams_status ON teams(status)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_teams_sport ON teams(sportType)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_teams_leader ON teams(leaderId)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(userId)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(teamId)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_users_openid ON users(openid)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_comments_team ON comments(teamId)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(userId)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(userId, isRead)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(userId)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_favorites_team ON favorites(teamId)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(targetType, targetId)');
  sqlDb.run('CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(isDeleted)');

  saveDatabase();
  console.log('[数据库] 初始化完成，路径:', DB_PATH);

  // 启动定时备份（每 5 分钟）
  backupTimer = setInterval(backupDatabase, 5 * 60 * 1000);
}

/**
 * 关闭数据库（清理定时器，用于测试退出）
 */
function closeDatabase() {
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
  if (sqlDb) {
    saveDatabase();
    sqlDb.close();
    sqlDb = null;
  }
}

/**
 * 持久化到磁盘（原子写入：先写临时文件，再 rename）
 */
function saveDatabase() {
  if (!sqlDb) return;
  try {
    const data = sqlDb.export();
    const buffer = Buffer.from(data);
    const tmpPath = DB_PATH + '.tmp';
    fs.writeFileSync(tmpPath, buffer);
    // Windows: rename 目标存在时需先删除
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
    }
    fs.renameSync(tmpPath, DB_PATH);
  } catch (err) {
    console.error('[数据库] 落盘失败:', err.message);
  }
}

/**
 * 创建数据库备份（每 5 分钟由定时器调用）
 */
function backupDatabase() {
  if (!sqlDb) return;
  try {
    const data = sqlDb.export();
    const buffer = Buffer.from(data);
    const tmpPath = DB_BAK_PATH + '.tmp';
    fs.writeFileSync(tmpPath, buffer);
    if (fs.existsSync(DB_BAK_PATH)) {
      fs.unlinkSync(DB_BAK_PATH);
    }
    fs.renameSync(tmpPath, DB_BAK_PATH);
  } catch (err) {
    console.error('[数据库] 备份失败:', err.message);
  }
}

/**
 * 进程退出时的安全保存
 */
function gracefulShutdown() {
  try {
    saveDatabase();
    console.log('[数据库] 优雅退出，数据已保存');
  } catch (e) {
    // 忽略
  }
}

// 注册退出钩子
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('beforeExit', gracefulShutdown);

/**
 * 将 Uint8Array 或其他值正确转为 JS 字符串
 * sql.js 返回 TEXT 列时可能是 Uint8Array（UTF-8 编码），需要解码
 */
function decodeValue(val) {
  if (val instanceof Uint8Array) {
    return new TextDecoder('utf-8').decode(val);
  }
  return val;
}

/**
 * 将 sql.js 查询结果转为对象数组
 */
function rowsToObjects(stmt) {
  const columns = stmt.getColumnNames();
  const results = [];
  while (stmt.step()) {
    const row = stmt.get();
    const obj = {};
    columns.forEach((col, i) => { obj[col] = decodeValue(row[i]); });
    results.push(obj);
  }
  stmt.free();
  return results;
}

/**
 * 兼容 better-sqlite3 API 的封装对象
 * db.prepare(sql).get(params)   → 返回第一行或 undefined
 * db.prepare(sql).all(params)   → 返回所有行
 * db.prepare(sql).run(params)   → 执行写操作，返回 { lastInsertRowid, changes }
 * db.exec(sql)                  → 执行多条 SQL
 */
const db = {
  prepare(sql) {
    return {
      get(...params) {
        const stmt = sqlDb.prepare(sql);
        stmt.bind(params);
        const rows = rowsToObjects(stmt);
        return rows.length > 0 ? rows[0] : undefined;
      },
      all(...params) {
        const stmt = sqlDb.prepare(sql);
        stmt.bind(params);
        return rowsToObjects(stmt);
      },
      run(...params) {
        sqlDb.run(sql, params);
        const lastId = sqlDb.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] || 0;
        const changes = sqlDb.getRowsModified();
        saveDatabase();
        return { lastInsertRowid: lastId, changes };
      },
    };
  },

  exec(sql) {
    sqlDb.run(sql);
    saveDatabase();
  },

  /**
   * 获取最近插入的行 ID（用于 INSERT 后）
   */
  getLastInsertRowid() {
    const result = sqlDb.exec('SELECT last_insert_rowid()');
    return result.length > 0 ? result[0].values[0][0] : 0;
  },
};

module.exports = db;
module.exports.initDatabase = initDatabase;
module.exports.saveDatabase = saveDatabase;
module.exports.backupDatabase = backupDatabase;
module.exports.closeDatabase = closeDatabase;
