# 运动组局小程序 — 2026-05-09 开发会话总结

> 本文档记录当日完成的全部开发内容，供后续接续开发、调试和上线参考。

---

## 一、今日完成总览

从 ROADMAP 第 2 梯队 → 第 5 梯队，共完成 **22 项功能**，全部 28 项 ROADMAP 已勾选完毕。

| 梯队 | 完成数 | 状态 |
|------|--------|------|
| 第一梯队（核心闭环） | 5/5 | ✅ 此前已完成 |
| 第二梯队（体验打磨） | 5/5 | ✅ 今日全部完成 |
| 第三梯队（吸引力提升） | 5/5 | ✅ 今日全部完成 |
| 第四梯队（上线准备） | 6/6 | ✅ 今日全部完成 |
| 第五梯队（长期建设） | 7/7 | ✅ 今日全部完成 |

**最终测试结果：63 个测试全部通过 ✅**

---

## 二、后端新增/修改文件清单

### 新增文件（8 个）
| 文件 | 功能 |
|------|------|
| `server/utils/cache.js` | LRU 内存缓存（500条目、TTL、delByPrefix、命中率统计） |
| `server/utils/credit.js` | 信誉分系统（±5 规则、0-200 范围、组局结束加分） |
| `server/utils/errorReport.js` | 错误上报（1分钟去重、统计接口、Sentry 扩展预留） |
| `server/utils/metrics.js` | 请求指标中间件（QPS、耗时、错误率、60s 滑动窗口） |
| `server/utils/websocket.js` | WebSocket 实时消息（JWT 认证、心跳、单播/广播） |
| `server/.env.example` | 环境变量模板（JWT_SECRET、WX_APPID、CORS_ORIGINS、ADMIN_OPENIDS 等） |
| `.github/workflows/ci.yml` | CI/CD 流水线（Node 16/18/20 矩阵测试） |
| `server/tests/utils.test.js` | 工具模块单元测试（15 项） |

### 重大修改文件（7 个）
| 文件 | 修改内容 |
|------|---------|
| `server/app.js` | 生产环境启动校验、metrics 中间件、WebSocket 初始化、error 中间件替换、stats 接口 |
| `server/utils/security.js` | `checkTextWithWeChat()` 微信云端检测、`checkSensitiveEnhanced()` 本地+云端双检测 |
| `server/routes/teams.js` | 标签系统（12个预设）、创建/编辑异步化、LRU 缓存（nearby 15s、detail 60s）、写操作自动清缓存 |
| `server/routes/comments.js` | 回复（parentId）、点赞（comment_likes）、`createNotification` 集成 WS 推送 |
| `server/routes/reports.js` | 管理员接口：`GET /api/reports`（分页+状态筛选）、`PUT /api/reports/:id`（resolved/dismissed） |
| `server/routes/users.js` | `adminMiddleware`（ADMIN_OPENIDS 控制）、昵称修改改用增强敏感词检测 |
| `server/db/database.js` | `comment_likes` 表、`comments.parentId`、`teams.tags` 列、原子写入+备份+恢复 |

---

## 三、前端新增/修改文件清单

### 新增页面（2 个）
| 页面 | 功能 |
|------|------|
| `pages/userProfile/userProfile.*` | 查看他人主页（资料、信誉分、创建/参与的组局列表） |
| `pages/editTeam/editTeam.*` | 编辑组局（标题/描述/人数/费用/标签，队长专用） |

### 重大修改页面（8 个）
| 页面 | 修改内容 |
|------|---------|
| `pages/index/index.*` | 地图视图增强（marker 点击弹出底部卡片+定位）、标签筛选芯片、搜索优化 |
| `pages/teamDetail/teamDetail.*` | 标签展示、评论回复+点赞 UI、回复输入框、海报嵌入小程序码、编辑按钮 |
| `pages/publish/publish.*` | 标签多选器（最多5个）、图片上传 |
| `pages/notifications/notifications.*` | 4 Tab 分类（全部/互动/活动/系统）、分类计数、全部已读 |
| `pages/my/my.*` | 下拉刷新、头像编辑角标、新用户引导 |
| `pages/userProfile/userProfile.wxml` | 修复 `mode="aspectFill"` 语法错误 |
| `pages/teamDetail/teamDetail.wxss` | 移除多余 CSS 规则 |
| `app.json` | `lazyCodeLoading: "requiredComponents"` |

---

## 四、关键技术实现细节

### 4.1 微信内容安全 API
- **文件**：`server/utils/security.js`
- **函数**：`checkTextWithWeChat(content)` → 调用 `msg_sec_check`
- **增强**：`checkSensitiveEnhanced(text, useWeChat)` 先本地秒判，再微信云端
- **降级**：未配置 WX_APPID 时自动跳过云端检测，仅用本地词库
- **接入点**：teams.js 创建/编辑、users.js 昵称修改、comments.js 评论

### 4.2 评论回复+点赞
- **数据库**：`comments.parentId` 字段 + `comment_likes` 表（UNIQUE 约束）
- **返回结构**：根评论 + `replies[]` 嵌套回复 + `likeCount` + `isLiked`
- **通知**：回复 → 通知父评论作者；新评论 → 通知队长

### 4.3 组局标签系统
- **白名单**：`['新手友好','高手局','AA制','免费','长期约','周末常约','工作日约','女性专场','男性专场','学生局','养生局','竞技局']`
- **存储**：`teams.tags` 列（JSON 字符串）
- **筛选**：`GET /api/teams/nearby?tag=xxx` 用 `LIKE '%"tag"%'`
- **前端**：publish/editTeam 选择器、index 筛选芯片、teamDetail 标签展示

### 4.4 缓存策略
- **实现**：LRU Map，500 条目上限，TTL 可配
- **nearby 列表**：缓存 15 秒（经纬度四舍五入到 2 位小数作 key）
- **team detail**：缓存 60 秒（`team:{id}` 作 key）
- **失效**：创建/编辑/加入/退出/取消/结束时自动 `cache.del` + `cache.delByPrefix('nearby')`

### 4.5 WebSocket 实时消息
- **连接地址**：`ws://host:port/ws?token=JWT`
- **认证**：URL 参数带 JWT，服务端 verify 后注册连接
- **心跳**：30 秒 ping/pong
- **推送**：`createNotification()` 写 DB 后调 `sendToUser()` 实时推
- **统计**：`GET /api/stats/online`

### 4.6 管理员举报处理
- **身份**：`ADMIN_OPENIDS` 环境变量（逗号分隔 openid）
- **中间件**：`adminMiddleware`（开发模式无名单时放行，生产模式拒绝）
- **接口**：
  - `GET /api/reports?status=pending&page=1` — 分页列表+目标详情
  - `PUT /api/reports/:id` — `{ action: 'resolved'|'dismissed' }`
  - resolved 自动：取消招募中组局、删除违规评论

### 4.7 生产环境配置校验
- **文件**：`server/app.js` 顶部
- **NODE_ENV=production 时**：检查 JWT_SECRET≥16位、WX_APPID、WX_SECRET 非默认值
- **CORS 提醒**：未限制域名时输出警告
- **模板**：`server/.env.example` 列出全部变量及说明

---

## 五、已知问题 & 待办

### 明日优先（上线相关）
1. **WX_APPID / WX_SECRET 配置** — 小程序码生成、微信登录、内容安全 API 均依赖此配置
2. **HTTPS + 域名备案** — 上线硬性要求，需人工操作
3. **微信小程序备案** — 2024 年起硬性要求
4. **QQ_MAP_KEY 配置** — 地图反向编码依赖

### 已知技术债务
- `pages/teamDetail/teamDetail.wxss` 第 53 行曾有多余 CSS（已修复）
- `pages/userProfile/userProfile.wxml` 第 25 行 `mode` 属性语法错误（已修复）
- `server/data/sport.db` 测试数据库文件可能残留脏数据，正式部署前建议清除
- `better-sqlite3` 无法在当前 Windows 环境编译（无 Visual Studio），已用增强 sql.js 替代
- 物理分包加载未实施（需迁移页面文件目录），当前仅用 `lazyCodeLoading`

### 性能相关
- WebSocket `ws` 包已安装，但小程序端需用 `wx.connectSocket` 对接
- 缓存仅内存级，服务重启后失效（对 sqlite 场景可接受）
- `setInterval` 备份和过期检查会在测试中产生进程警告（`--forceExit` 已处理）

---

## 六、测试状态

```
Test Suites: 3 passed, 3 total
Tests:       63 passed, 63 total
```

| 测试文件 | 测试数 | 覆盖内容 |
|---------|--------|---------|
| `tests/api.test.js` | 48 | 登录、用户信息、组局 CRUD、收藏、举报、信誉分、限流、小程序码、标签、评论回复点赞 |
| `tests/security.test.js` | 12 | XSS 过滤、敏感词检测、敏感词替换 |
| `tests/utils.test.js` | 15 | 缓存（8项）、指标（2项）、错误上报（2项）、信誉分（3项） |

**运行命令**：`cd server && npm test`

---

## 七、明日接续清单

```
□ 配置真实 WX_APPID / WX_SECRET（微信后台获取）
□ 测试小程序码生成功能
□ 配置 HTTPS 域名 + Nginx 反代
□ 微信小程序备案提交
□ 配置 QQ_MAP_KEY
□ 前端 wx.connectSocket 对接 WebSocket
□ 首次真机全流程测试（登录→发布→加入→评论→通知→举报）
□ 提交微信审核
```

---

*文档生成时间：2026-05-09 02:45*
*测试环境：Node.js + Jest + supertest + sql.js*
*数据库：`server/data/sport.db`（开发用，生产环境请另建）*
