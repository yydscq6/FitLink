# 开发记忆 — 运动组局小程序

> 快速参考，每次开发前必读

---

## 项目结构

```
sport-miniprogram/
├── app.js / app.json / app.wxss     ← 小程序入口（已改为云开发调用）
├── pages/                            ← 前端页面（12 个）
├── components/                       ← 公共组件
├── utils/format.wxs                  ← WXS 格式化工具
├── assets/                           ← 静态资源（图标、tabbar）
├── cloudfunctions/                   ← 云函数（替代原 server/）
│   └── api/
│       ├── index.js                  ← 云函数入口（action 路由）
│       ├── package.json              ← 依赖 wx-server-sdk
│       ├── routes/                   ← 路由处理（5 个文件）
│       │   ├── users.js              ← 用户登录/资料
│       │   ├── teams.js              ← 组局 CRUD + 推荐算法
│       │   ├── comments.js           ← 评论 + 点赞
│       │   ├── notifications.js      ← 通知管理
│       │   └── reports.js            ← 举报处理
│       └── utils/
│           ├── db.js                 ← 云数据库初始化
│           ├── auth.js               ← openid 鉴权
│           └── activity.js           ← 活跃度追踪 + 推荐第五维
├── server/                           ← 旧后端（保留备用，已不使用）
├── ROADMAP.md                        ← 功能路线图（28项全完成）
└── DEVELOPMENT_MEMORY.md             ← 本文件（快速参考）
```

---

## 云函数 Action 速查

前端调用方式：`wx.cloud.callFunction({ name: 'api', data: { action: '...', ...params } })`

| Action | 功能 | 认证 |
|--------|------|------|
| `users.login` | 微信登录（自动获取 openid） | ✗ |
| `users.me` | 我的资料 | ✓ |
| `users.updateMe` | 更新资料 | ✓ |
| `users.getById` | 他人主页 | ✗ |
| `teams.nearby` | 附近组局（支持 `mode=recommended` 智能推荐） | ✗ |
| `teams.create` | 创建组局 | ✓ |
| `teams.detail` | 组局详情 | ✗ |
| `teams.update` | 编辑组局 | ✓ |
| `teams.join` | 加入 | ✓ |
| `teams.quit` | 退出 | ✓ |
| `teams.cancel` | 取消 | ✓ |
| `teams.end` | 结束 | ✓ |
| `teams.toggleFavorite` | 收藏切换 | ✓ |
| `teams.myFavorites` | 我的收藏 | ✓ |
| `teams.myCreated` | 我发起的 | ✓ |
| `teams.myJoined` | 我参与的 | ✓ |
| `teams.qrcode` | 小程序码 | ✗ |
| `comments.list` | 评论列表 | ✗ |
| `comments.create` | 发评论/回复 | ✓ |
| `comments.like` | 点赞 | ✓ |
| `comments.unlike` | 取消赞 | ✓ |
| `notifications.list` | 通知列表 | ✓ |
| `notifications.markRead` | 标记已读 | ✓ |
| `notifications.markAllRead` | 全部已读 | ✓ |
| `reports.create` | 提交举报 | ✓ |
| `reports.list` | 举报列表（管理员） | ✓+admin |
| `reports.resolve` | 处理举报（管理员） | ✓+admin |

---

## 云数据库集合（MongoDB）

在云开发控制台创建以下 8 个集合：

| 集合名 | 关键字段 |
|--------|---------|
| `users` | openid, nickname, avatarUrl, creditScore, sportPrefs, lastActiveAt, joinCount30d, createCount30d, activeLevel |
| `teams` | leaderId, sportType, title, tags[], status, startTime/endTime |
| `team_members` | teamId, userId, role(leader/member), joinedAt |
| `comments` | teamId, userId, content, parentId |
| `comment_likes` | commentId, userId |
| `notifications` | userId, type, title, content, teamId, isRead |
| `favorites` | userId, teamId |
| `reports` | reporterId, targetType, targetId, reason, status |

> **注意**：云数据库 _id 由系统自动生成（字符串），不再是自增整数。

---

## 配置项

```bash
# app.js 中需配置：
cloudEnv: 'prod-xxx'          # 云开发环境 ID（在云开发控制台查看）

# 腾讯地图 Key（app.js 中 _callGeocoder 方法）：
QQ_MAP_KEY=xxx                # 用于逆地理编码

# 云函数环境变量（可选，在云开发控制台配置）：
ADMIN_OPENIDS=                # 管理员 openid，逗号分隔
```

---

## 运行命令

```bash
# 云函数安装依赖
cd cloudfunctions/api
npm install

# 部署云函数（在微信开发者工具中）：
# 1. 右键 cloudfunctions/api → 上传并部署：云端安装依赖
# 2. 或右键 → 上传并部署：所有文件

# 前端
# 用微信开发者工具打开 sport-miniprogram 目录
# 确保已开通云开发（开发 → 云开发）
# 创建 8 个数据库集合（见上方"云数据库集合"）
```

---

## 常见问题

| 问题 | 解决 |
|------|------|
| 云函数调用报错"找不到" | 确认已在开发者工具右键部署云函数 |
| 数据库操作报权限错误 | 在云开发控制台设置集合权限为"所有用户可读，仅创建者可写"或自定义安全规则 |
| `wx.cloud.callFunction` 返回 undefined | 检查 `app.js` 中 `cloudEnv` 是否填了正确的环境 ID |
| 小程序码生成失败 | 需在云开发控制台开通 `cloud.openapi` 权限 |
| WXML 中 `indexOf` 判断不生效 | 预计算选中状态到 JS（如 `buildTagOptions`），模板用 `item.selected` |
| 运动偏好/标签点击无反应 | 同上，`indexOf` 在 WXML 视图层不可靠 |
| 组局详情页标签不显示 | 检查 CSS：`color: #ffffff` 在白色背景上不可见，需改为深色 |
| 云函数超时 | 云函数默认超时 20 秒，复杂查询需优化（如 nearby 接口限制 200 条） |
| 云存储上传失败 | 检查文件大小（单文件 ≤ 100MB）和格式 |

---

## 智能推荐算法（首页 GET /api/teams/nearby?mode=recommended）

五维综合评分，分数越高排序越靠前：

| 维度 | 权重 | 说明 |
|------|------|------|
| 运动偏好 | ×1.5 乘数 | 用户「我的」页设置的偏好运动类型匹配时加 50% |
| 时间紧迫度 | -0.5 ~ +1.0 | 0~4h 内最高，4~24h 中等，1~7天低，已过期 -0.5 惩罚 |
| 距离远近 | 0 ~ 1.0 | 对数衰减，0km→1.0，5km→0.55，20km→0 |
| 剩余名额 | 0 ~ 0.15 | 名额越充足，越容易加入 |
| **活跃度匹配** | **0 ~ 0.3** | **基于用户活跃等级的个性化匹配（见下方）** |

**触发条件**：首页无显式筛选（运动类型=全部、无时间/标签/距离筛选）时自动启用。
**缓存策略**：推荐模式按用户缓存（含偏好差异），默认模式按街区缓存。

---

## 活跃度追踪系统（activity.js）

### 用户活跃等级（activeLevel）

通过 `calcActiveLevel(user)` 实时计算，查询 lastActiveAt + 近30天参与组局次数：

| 等级 | 条件 | 行为特征 |
|------|------|---------|
| `high` | 7天内活跃 且 30天参与≥2次 | 经常发起/加入组局 |
| `mid` | 7天内活跃（参与少）或 14天内活跃且有参与 | 偶尔参与 |
| `low` | 30天内活跃但无参与 | 浏览但不行动 |
| `dormant` | 30天以上未活跃 | 沉睡/流失用户 |

### 第五维：活跃度匹配策略（calcActiveMatch）

不同活跃度用户需要不同队伍信号来促成行动：

**低活/沉睡用户 → "临门一脚"策略：**
- spotsLeft ≤ 1 → +0.25（"就差你了"）
- spotsLeft ≤ 2 → +0.15
- 12h 内开始 → +0.20（"马上就开打"）
- 12~24h 开始 → +0.10
- 队长信用分 ≥ 120 → +0.05（降低信任顾虑）

**高活用户 → "充足空间"策略：**
- 3 ≤ spotsLeft ≤ max-1 → +0.15（有余位不抢）
- 12~72h 后开始 → +0.10（有准备时间）
- 6h 内创建的新队伍 → +0.10（喜欢尝鲜）

**中活用户 → 平衡策略：**
- 2 ≤ spotsLeft ≤ 5 → +0.10
- 2~48h 后开始 → +0.10

### 活跃度统计字段（users 集合）

| 字段 | 类型 | 说明 |
|------|------|------|
| `lastActiveAt` | ISO string | 最后活跃时间（每次云函数调用自动更新） |
| `joinCount30d` | number | 近30天参与组局次数 |
| `createCount30d` | number | 近30天发起组局次数 |
| `activeLevel` | string | 活跃等级：high/mid/low/dormant |

### 触发时机

| 事件 | 行为 |
|------|------|
| 任何云函数调用 | `trackActivity()` 异步更新 lastActiveAt（index.js 中间件） |
| 创建组局 | `refreshActivityStats()` 异步更新 joinCount30d/createCount30d/activeLevel |
| 加入组局 | `refreshActivityStats()` 异步更新 joinCount30d/activeLevel |
| 首页推荐请求 | `calcActiveLevel()` 实时查询计算（确保评分准确） |
| 用户登录（新用户） | 初始化 lastActiveAt、joinCount30d=0、createCount30d=0、activeLevel='mid' |

### 文件位置

```
cloudfunctions/api/utils/activity.js   ← 活跃度追踪模块
├── trackActivity(openid)              ← 更新 lastActiveAt
├── calcActiveLevel(user)              ← 计算活跃等级
├── calcActiveMatch(team, level)       ← 推荐第五维评分
└── refreshActivityStats(userId)       ← 刷新统计字段
```

---

## 小程序码系统

### 生成流程

```
用户点击"生成海报"
  → 前端调用 teams.qrcode (teamId)
  → 后端检查云存储缓存（qrcodes/{teamId}.png）
    → 有缓存 → 直接返回 fileID
    → 无缓存 → cloud.openapi.wxacode.getUnlimited 生成
              → 上传到云存储 → 返回 fileID
  → 前端下载临时文件 → Canvas 绘制海报
```

### 关键配置

| 配置项 | 值 | 说明 |
|--------|---|------|
| scene 参数 | 直接用 teamId（≤32字符） | MongoDB _id 通常 24 字符，符合限制 |
| page 参数 | `pages/teamDetail/teamDetail` | 扫码后跳转的页面 |
| lineColor | `{r:10, g:154, b:93}` | 主题绿色 |
| width | 430 | 小程序码宽度 |
| 缓存路径 | `qrcodes/{teamId}.png` | 云存储，避免重复生成 |

### 扫码进入处理

`teamDetail.js` 的 `onLoad` 同时支持：
- `options.id` — 正常页面跳转
- `options.scene` — 扫描小程序码进入（自动 decodeURIComponent）

### 常见错误码

| errCode | 含义 | 解决 |
|---------|------|------|
| 45157 | 小程序未发布 | 在微信开发者工具上传并发布 |
| 45158 | 页面路径错误 | 检查 page 参数 |
| 45159 | 生成数量超限 | 联系微信客服提升配额 |
| 45160 | 小程序信息不全 | 在公众平台完善头像和名称 |
| 40001 | access_token 错误 | 检查云开发环境配置 |

### 前置条件

1. 小程序需**已发布**（或在开发/体验版中测试）
2. 云函数需有 `wxacode.getUnlimited` 接口权限
3. 云存储需有 `qrcodes/` 目录的写入权限

---

## 通知推送机制

### 三层通知架构

| 层级 | 机制 | 触发时机 | 用户感知 |
|------|------|---------|---------|
| **L1: 应用内通知** | `notifications` 集合 | 任何状态变更时写入 | 用户打开"我的"tab 看到未读徽章 |
| **L2: 详情页轮询** | 30 秒定时器 | 用户在组局详情页时 | 状态变化时弹 toast 提示 |
| **L3: 订阅消息** | `subscribeMessage.send` | 满员/取消/结束时 | 微信聊天列表收到服务通知 |

### L1: 应用内通知（已实现）

所有通知写入 `notifications` 集合，前端在"我的"tab `onShow` 时拉取未读数。

| 事件 | 接收人 | type |
|------|--------|------|
| 有人加入队伍 | 队长 | `join` |
| **组局满员** | **全体队员（除加入者）** | `match_success` |
| 队伍被取消 | 全体队员（除队长） | `cancelled` |
| 组局结束 | 全体队员（除队长） | `ended` |
| 队伍信息更新 | 全体队员（除编辑者） | `update` |
| 评论被回复 | 被回复人 | `reply` |

### L2: 详情页轮询（已实现）

```
teamDetail.js:
onShow → _startStatusPolling()  // 每 30 秒 GET /teams/:id
onHide → _stopStatusPolling()
onUnload → _stopStatusPolling()

轮询逻辑：
1. 检查 status 是否变化（recruiting → ended/cancelled）
2. 状态变化 → fetchDetail 全量刷新 + toast 提示
3. 状态未变 → 静默更新 currentMembers
4. 队伍已结束/已取消 → 自动停止轮询
```

### L3: 订阅消息（已配置完成 ✅）

**模板 ID**：
| 类型 | 模板 ID | 字段 |
|------|---------|------|
| 组局成功 | `XlbAjAHqhp4pq2RVFVXRJ_29tfPWMAmTRtJG2nQ4hi4` | thing7=活动名称, time2=报名时间, thing9=活动地址, time5=开始时间 |
| 组局取消 | `zfuwiRlb-YOSpAHqM79maZJafwPS5andsheaqqnDPQQ` | thing1=运动名称, thing2=取消原因, thing4=运动地点, time3=运动时间 |
| 组局结束 | `Q5wJpHL0g4rR6bA6hoKqViX1bbXqdis550aMyZtcbS8` | thing1=任务名称, time2=完成日期 |

**推送时机**：
| 事件 | 推送给 | 模板类型 |
|------|--------|---------|
| 组局满员 | 全体队员（除加入者） | `match_success` |
| 队伍被取消 | 全体队员（除队长） | `cancelled` |
| 组局结束 | 全体队员（除队长） | `ended` |

**授权时机**：加入组局成功后自动弹出授权弹窗（`_requestSubscribe`）

**注意事项**：
- 订阅消息是「一次授权一次推送」，用户每次加入操作都会重新请求授权
- 授权失败不影响主流程（静默处理）
- 需在云函数中开通 `subscribeMessage.send` 接口权限

---

## 冲突处理机制

### 设计原则：软拦截 + 确认放行

冲突检测采用「首次警告 → 用户确认 → 强制放行」模式，不硬性阻断用户操作。

| 场景 | 首次请求返回 | 用户确认后 |
|------|-------------|-----------|
| 加入时间冲突的组局 | `code: -2` + 冲突队伍信息 | `forceJoin: true` 跳过检查 |
| 创建重复组局 | `code: -2` + 已有队伍信息 | `forceCreate: true` 跳过检查 |

### 1. 时间冲突检测（加入组局时）

**触发条件**：用户点击"加入组局"
**检测逻辑**：查询用户所有活跃成员记录 → 与新队伍时间做重叠检测
**冲突定义**：两个队伍的 [startTime, endTime] 有交集（默认活动时长 2h）
**排除**：已结束/已取消的队伍、当前队伍本身

```
用户加入 Team B (8pm-10pm)
  → 查到已加入 Team A (8:30pm-10:30pm)
  → 时间重叠！返回 code: -2
  → 前端弹窗："你已有一个时间重叠的组局：「Team A」(篮球)，确定还要加入吗？"
  → 用户点确定 → 前端重试 forceJoin: true → 加入成功
```

### 2. 重复组局检测（创建组局时）

**触发条件**：队长点击"发布组局"
**检测逻辑**：查询该队长的招募中队伍 → 同运动类型 + 时间 ±4h 窗口
**冲突定义**：同一运动类型 + 精确时间重叠 + 状态为 recruiting

```
队长创建 "周六篮球局" (Sat 8pm)
  → 查到已有 "周六晚篮球" (Sat 7:30pm) 招募中
  → 重复！返回 code: -2
  → 前端弹窗："你已有一个相似的组局：「周六晚篮球」，确定还要创建吗？"
  → 用户点确定 → 前端重试 forceCreate: true → 创建成功
```

### 3. 自加入防护（加入组局时）

**规则**：队长不能加入自己创建的队伍
**返回**：`code: -1, message: '你是队长，无需加入自己的组局'`

### 工具函数

| 函数 | 位置 | 说明 |
|------|------|------|
| `hasTimeOverlap(startA, endA, startB, endB)` | teams.js | 时间段重叠检测 |
| `checkTimeConflict(userId, startTime, endTime, excludeTeamId)` | teams.js | 用户级时间冲突查询 |
| `checkDuplicateTeam(leaderId, sportType, startTime, endTime)` | teams.js | 队长级重复组局查询 |

### 错误码约定

| code | 含义 | 前端处理 |
|------|------|---------|
| `0` | 成功 | 正常处理 |
| `-1` | 业务错误 | showToast 提示 |
| `-2` | 冲突警告 | showModal 确认弹窗，确认后带 force 参数重试 |
| `401` | 未登录 | 跳转登录 |
| `403` | 无权限 | 提示无权限 |
| `404` | 接口不存在 | 检查 action 拼写 |

---

## 上线待办（云开发版本）

1. ✅ 云开发迁移完成（代码已就绪）
2. ✅ 云开发环境 ID 已配置（`cloud1-5ghdrhutc3470ef7`）
3. ✅ 五维推荐算法 + 活跃度追踪系统
4. ✅ 冲突处理（时间冲突 + 重复组局 + 自加入防护）
5. ✅ 三层通知推送（应用内 + 轮询 + 订阅消息）
6. ✅ 订阅消息模板已配置（3 个模板 ID）
7. ✅ 小程序码生成 + 缓存 + 扫码进入
8. ✅ `scope.writePhotosAlbum` 权限已添加
9. ⚠️ 替换 TabBar 图标（当前为 67 字节占位符）
10. ⚠️ 配置 `QQ_MAP_KEY`（腾讯地图 Key，https://lbs.qq.com 申请）
11. ⚠️ 在云开发控制台创建 8 个数据库集合，设置权限
12. ⚠️ 右键 `cloudfunctions/api` → 上传并部署：云端安装依赖
13. ⚠️ 微信小程序备案
14. ⚠️ 真机全流程测试
15. ⚠️ 提交微信审核

---

*最后更新：2026-05-09（云开发迁移完成 + 活跃度追踪系统 + 五维推荐算法）*
