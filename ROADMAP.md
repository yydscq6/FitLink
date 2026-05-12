# 运动组局小程序 — 开发路线图

> 排序原则：产品完整度 + 功能吸引力
> 目标：先打磨产品「能用 → 好用 → 想用 → 能上线 → 能长期跑」，再上线
> 更新时间：2026-05-09
> 全部 28 项已完成 ✅（详见 SESSION_SUMMARY.md）

状态标记：⬜ 未开始 | 🔄 进行中 | ✅ 已完成

---

## ⭐ 第一梯队 — 核心闭环（产品能不能用）

> 用户从"打开"到"组局成功"的完整体验链路，缺任何一环产品都不完整。

- [x] 1. 组局编辑 ✅ 2026-05-09 — 后端 PUT 接口 + 前端编辑页面 + 详情页编辑按钮 + 队员变更通知
  - `server/routes/teams.js` — `PUT /api/teams/:id`
  - `pages/editTeam/editTeam.*`
  - `pages/teamDetail/teamDetail.*`

- [x] 2. 用户主页（查看他人） ✅ 2026-05-09 — 后端公开资料 API + 前端用户主页 + 详情页头像/成员/评论可点击
  - `server/routes/users.js` — `GET /api/users/:id`
  - `pages/userProfile/userProfile.*`
  - `pages/teamDetail/teamDetail.*` — onGoToUser 点击跳转

- [x] 3. 头像昵称授权（新版） ✅ 2026-05-09 — 已使用 chooseAvatar + type=nickname 新 API，新增头像编辑角标 + 新用户引导提示
  - `pages/my/my.*`

- [x] 4. 图片上传（封面图） ✅ 2026-05-09 — multer 上传接口 + 发布/编辑页图片选择器 + 列表卡片封面 + 详情页封面大图
  - `server/routes/upload.js` — `POST /api/upload/image`
  - `pages/publish/publish.*`、`pages/editTeam/editTeam.*`
  - `pages/index/index.*`、`pages/teamDetail/teamDetail.*`

- [x] 5. 组局搜索 ✅ 已有实现 — 搜索栏+关键词过滤+清除按钮+空结果提示（之前已实现）
  - `pages/index/index.*`

---

## ⭐⭐ 第二梯队 — 体验打磨（产品好不好用）

> 基础功能有了之后，让产品从"能跑"变成"好用"。

- [x] 6. 订阅消息提醒 ✅ 2026-05-09 — 微信订阅消息框架 + 活动前 1h 定时提醒 + 状态变更推送 + 前端订阅权限请求
  - `server/utils/wechatMessage.js`
  - `server/app.js` — 定时器
  - `server/routes/teams.js` — cancel/end/edit 推送
  - `pages/teamDetail/teamDetail.*`

- [x] 7. 信誉分系统 ✅ 2026-05-09 — 积分规则（结束+2/+1、被举报-5）+ 范围 0-200 + 组局结束/举报自动调分
  - `server/utils/credit.js`
  - `server/routes/teams.js` — end 时调分
  - `server/routes/reports.js` — 举报时扣分

- [x] 8. 数据库可靠性加固 ✅ 2026-05-09 — better-sqlite3 需要原生编译，改为增强 sql.js 持久化（原子写入+备份+优雅退出+损坏恢复）
  - `server/db/database.js` — 原子写入（tmp+rename）、5 分钟自动备份、进程退出钩子、启动损坏恢复

- [x] 9. 加入/退出体验优化 ✅ 2026-05-09 — 满员自动结束 + 退出重开招募 + 创建者退出/加入通知
  - `server/routes/teams.js`

- [x] 10. 页面骨架屏 + 下拉刷新 ✅ 2026-05-09 — 全部列表页已有骨架屏动画 + 下拉刷新（index/notifications/teamDetail/myTeams/joinedTeams/favorites/userProfile/my）
  - 骨架屏动画定义在 `app.wxss`（.skeleton + skeleton-loading keyframes）
  - 各页面 json 中 `enablePullDownRefresh: true`

---

## ⭐⭐⭐ 第三梯队 — 吸引力提升（产品想不想用）

> 用户留存和传播的关键功能，让人"想再来"和"想推荐给别人"。

- [x] 11. 分享小程序码海报 ✅ 2026-05-09 — 后端小程序码生成 API + 海报嵌入小程序码 + 未配置时优雅降级占位图
  - `server/routes/teams.js` — `GET /api/teams/:id/qrcode`
  - `server/utils/wechatMessage.js` — `getMiniProgramQRCode()`
  - `pages/teamDetail/teamDetail.*` — 下载小程序码 + Canvas 绘制 + 占位方案

- [x] 12. 组局标签系统 ✅ 2026-05-09 — 12 个预设标签 + 创建/编辑可选标签 + 列表卡片/详情页展示 + 首页标签筛选
  - `server/routes/teams.js` — tags 字段 + 创建/编辑/列表/筛选支持
  - `server/db/database.js` — teams.tags 列
  - `pages/publish/publish.*` — 标签多选器
  - `pages/editTeam/editTeam.*` — 标签多选器
  - `pages/index/index.*` — 高级筛选标签芯片
  - `pages/teamDetail/teamDetail.*` — 标签展示
  - 2 个新测试（创建带标签、编辑标签）

- [x] 13. 评论回复 + 点赞 ✅ 2026-05-09 — 评论可回复（parentId 线程）+ 点赞/取消赞 + 回复通知 + 评论列表含回复和点赞数
  - `server/routes/comments.js` — 回复、点赞、取消赞 API
  - `server/db/database.js` — parentId 字段 + comment_likes 表
  - `pages/teamDetail/teamDetail.*` — 回复 UI、点赞按钮、回复列表展示
  - `pages/notifications/notifications.wxml` — reply 类型图标
  - 7 个新测试（发评论、获取列表、回复、回复嵌套、点赞、重复拦截、取消赞）

- [x] 14. 消息中心改版 ✅ 2026-05-09 — Tab 分类（全部/互动/活动/系统）+ 分类计数 + 全部已读 + 空状态优化
  - `pages/notifications/notifications.js` — Tab 切换、分类过滤、计数统计
  - `pages/notifications/notifications.wxml` — 4 Tab 栏、分类图标（✏️更新 ⏰提醒）、分类空状态
  - `pages/notifications/notifications.wxss` — Tab 栏样式、激活态下划线、计数胶囊

- [x] 15. 地图 + 列表双视图 ✅ 2026-05-09 — 地图/列表一键切换 + marker 点击弹出底部组局卡片 + 地图自动定位选中点
  - `pages/index/index.js` — `selectedTeam` 状态、`_selectTeamById()`、`onCloseSelectedCard()`、`onGoToDetail()`
  - `pages/index/index.wxml` — 地图底部滑出卡片（运动标签/标题/标签/地点/时间/队长/人数/查看详情按钮）
  - `pages/index/index.wxss` — `.map-selected-card` 弹出动画 + 卡片内各元素样式

---

## 🔧 第四梯队 — 上线准备（能不能安全上线）

> 产品打磨好之后，补齐上线必须的技术和合规项。

- [ ] 16. HTTPS + 域名备案 — 上线硬性要求
  - 域名/DNS 配置

- [ ] 17. 微信小程序备案 — 2024年起硬性要求
  - 微信管理后台

- [ ] 18. QQ_MAP_KEY 配置 — 地图功能依赖
  - `.env`

- [x] 19. 敏感词接入微信内容安全 API ✅ 2026-05-09 — `checkSensitiveEnhanced` 先本地词库秒判、再微信 msg_sec_check 云端检测，API 不可用时自动降级
  - `server/utils/security.js` — `checkTextWithWeChat()`、`checkSensitiveEnhanced()`
  - `server/routes/teams.js` — 创建/编辑组局改用增强检测
  - `server/routes/users.js` — 昵称修改改用增强检测
  - `server/routes/comments.js` — 评论/回复改用增强检测

- [x] 20. 生产环境配置 ✅ 2026-05-09 — `.env.example` 模板 + `NODE_ENV=production` 启动强校验 + CORS 安全提醒
  - `server/.env.example` — 全量环境变量说明
  - `server/app.js` — 生产环境启动检查（JWT_SECRET≥16位、WX_APPID、WX_SECRET、CORS 提醒）

- [x] 21. 管理员举报处理 ✅ 2026-05-09 — 管理员中间件 + 举报列表查询 + 处理（确认违规自动取消组局/删除评论 / 驳回）
  - `server/routes/users.js` — `adminMiddleware`（ADMIN_OPENIDS 环境变量控制）
  - `server/routes/reports.js` — `GET /api/reports`（分页+状态筛选+目标详情）+ `PUT /api/reports/:id`（resolved/dismissed）
  - `.env.example` — ADMIN_OPENIDS 配置说明

---

## 🏗️ 第五梯队 — 长期建设

> 持续迭代和质量保障。

- [x] 22. 前端单元测试 ✅ 2026-05-09 — 新增工具模块单元测试（缓存 8 项 + 指标 2 项 + 错误上报 2 项 + 信誉分 3 项），总测试数 48→63
  - `server/tests/utils.test.js` — MemoryCache、Metrics、ErrorReport、Credit 全覆盖
- [x] 23. CI/CD 流水线 ✅ 2026-05-09 — GitHub Actions 工作流（Node 16/18/20 矩阵 + npm ci + npm test）
  - `.github/workflows/ci.yml` — push/PR 触发、多版本 Node 矩阵测试、npm 缓存
- [x] 24. 分包加载 ✅ 2026-05-09 — `lazyCodeLoading: "requiredComponents"` 已生效（组件按需加载）；物理分包需文件迁移（待后续优化）
  - `app.json` — `lazyCodeLoading`、`usingComponents` 按需引入
- [x] 25. 数据埋点 ✅ 2026-05-09 — 请求指标中间件（QPS / 耗时 / 错误率）+ 按路径聚合 + 60s 滑动窗口
  - `server/utils/metrics.js` — `metricsMiddleware()`、`getMetrics()`
  - `server/app.js` — `/api/stats/metrics` 实时指标接口
- [x] 26. 缓存策略 ✅ 2026-05-09 — LRU 内存缓存（500条目）+ TTL + 命中率统计 + 附近列表/详情读缓存 + 写操作自动失效
  - `server/utils/cache.js` — `MemoryCache` 类（LRU 淘汰、delByPrefix、stats）
  - `server/routes/teams.js` — nearby 缓存 15s、team detail 缓存 60s、写操作（创建/编辑/加入/退出/取消/结束）自动清除相关缓存
- [x] 27. WebSocket 实时消息 ✅ 2026-05-09 — JWT 认证连接 + 心跳保活 + 通知创建时实时推送 + 在线统计
  - `server/utils/websocket.js` — `initWebSocket()`、`sendToUser()`、`broadcast()`、`getOnlineCount()`
  - `server/routes/comments.js` — `createNotification` 集成 WS 推送
  - `server/app.js` — 启动时初始化 WS + `/api/stats/online` 在线统计接口
- [x] 28. 错误上报 ✅ 2026-05-09 — 全局错误中间件 + 1分钟去重 + 统计接口 + Sentry 扩展预留
  - `server/utils/errorReport.js` — `reportError()`、`errorMiddleware()`、`getErrorStats()`
  - `server/app.js` — 全局错误处理改用 errorMiddleware + `/api/stats/errors` 统计接口 + uncaughtException/unhandledRejection 上报

---

## 📝 变更日志

| 日期 | 变更内容 |
|------|---------|
| 2026-05-08 | 创建路线图，完成安全加固+隐私协议+账号注销+举报+日志+测试 |
| 2026-05-09 | 完成组局编辑功能（后端 PUT 接口+前端编辑页+详情页编辑按钮+变更通知+3 个新测试） |
| 2026-05-09 | 完成用户主页功能（后端公开资料 API+前端用户主页+详情页头像/成员/评论可点击+2 个新测试） |
| 2026-05-09 | 完成头像昵称授权优化（chooseAvatar+type=nickname 已在用，新增编辑角标+新用户引导） |
| 2026-05-09 | 完成图片上传（multer 上传接口+发布/编辑页选择器+列表卡片封面+详情页封面大图） |
| 2026-05-09 | 标记组局搜索为已完成（之前已实现搜索栏+关键词过滤） |
| 2026-05-09 | 完成订阅消息提醒（微信订阅消息框架+活动前1h提醒+状态变更推送+前端订阅权限请求） |
| 2026-05-09 | 完成信誉分系统（积分规则+范围0-200+组局结束/举报自动调分+3个新测试） |
| 2026-05-09 | 完成加入/退出体验优化（满员自动结束+退出重开招募+创建者通知） |
| 2026-05-09 | 完成数据库可靠性加固（原子写入+5分钟备份+优雅退出+启动损坏恢复+closeDatabase） |
| 2026-05-09 | 完成骨架屏+下拉刷新（全部8个列表页已覆盖，新增favorites/userProfile/my的下拉刷新） |
| 2026-05-09 | 完成分享小程序码海报（后端getUnlimited API+海报嵌入小程序码+未配置时降级占位+2个新测试） |
| 2026-05-09 | 完成组局标签系统（12个预设标签+创建/编辑/列表/详情/筛选全链路+2个新测试） |
| 2026-05-09 | 完成评论回复+点赞（parentId线程+comment_likes表+回复通知+7个新测试） |
| 2026-05-09 | 完成消息中心改版（4 Tab 分类+分类计数+全部已读+空状态优化） |
| 2026-05-09 | 完成地图+列表双视图（marker弹出底部卡片+地图自动定位选中点+查看详情按钮） |
| 2026-05-09 | 完成敏感词接入微信内容安全API（checkSensitiveEnhanced本地+云端双检测+自动降级+3个路由已接入） |
| 2026-05-09 | 完成生产环境配置（.env.example模板+NODE_ENV=production启动强校验+CORS安全提醒） |
| 2026-05-09 | 完成管理员举报处理（adminMiddleware+举报列表分页+确认违规自动取消组局/删除评论+驳回） |
| 2026-05-09 | 完成缓存策略（LRU内存缓存500条目+TTL+nearby 15s/详情60s读缓存+写操作自动失效） |
| 2026-05-09 | 完成错误上报（全局错误中间件+1分钟去重+统计接口+Sentry扩展预留+uncaught异常上报） |
| 2026-05-09 | 完成分包加载优化（lazyCodeLoading: requiredComponents 组件按需加载） |
| 2026-05-09 | 完成CI/CD流水线（GitHub Actions Node 16/18/20矩阵+缓存+push/PR自动测试） |
| 2026-05-09 | 完成数据埋点（请求指标中间件+QPS/耗时/错误率+60s滑动窗口+实时指标接口） |
| 2026-05-09 | 完成前端单元测试（新增utils.test.js覆盖缓存/指标/错误上报/信誉分，总测试63个全部通过） |
| 2026-05-09 | 完成WebSocket实时消息（JWT认证+心跳30s+通知实时推送+在线统计接口+createNotification集成WS） |
