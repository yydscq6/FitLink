# 代码审查修复 - sport-miniprogram
**日期**: 2026-04-29
**目标**: 修复代码审查中发现的 P0/P1 级 bug、安全和性能问题

## 修复清单

### P0 - 关键 Bug
| # | 文件 | 问题 | 修复 |
|---|------|------|------|
| 1 | publish.js | 时间选择器引用不存在的 timeIndex/timeArray | 新增 buildDateOptions() 生成未来7天、buildTimeOptions() 生成6:00-23:30；data 中初始化 timeArray/timeIndex；重写 onTimeChange 解析选中值 |
| 2 | publish.wxml | 缺少 bindcolumnchange 事件绑定 | 添加 bindcolumnchange="onTimeColumnChange" |
| 3 | index.js | hasMore 用 this.data.teamList.length（刷新前旧值） | 改用 merged 变量，refresh 时 merged = newList，hasMore = merged.length < total |
| 4 | teamDetail.* | 详情页只有空脚手架 | 完整实现：API 请求详情、加入/退出组局、队员列表、地图导航、复制联系方式、分享 |

### P1 - 重要修复
| # | 文件 | 问题 | 修复 |
|---|------|------|------|
| 5 | index.js | onShow 每次触发 fetchTeamList | 增加 _lastShowTime 节流，30s 内不重复请求 |
| 6 | index.js | 快速切换筛选时请求竞态 | 增加 requestRef.__abort 标记，新请求废弃旧请求结果 |
| 7 | publish.js | 无输入校验 + 无防重复提交 | 标题≤50字、描述≤500字、人数2-100、联系方式≤50字；submitting 防抖 |
| 8 | app.js | 401 只清除登录态无提示 | 增加 wasLogin 判断，token 过期时 toast 提示"登录已过期" |
| 9 | index.wxml | 头像图片未懒加载 | 添加 lazy-load 属性 |
| 10 | sitemap.json | app.json 引用但文件不存在 | 创建 sitemap.json |

## 涉及文件
- sport-miniprogram/app.js (401 handling)
- sport-miniprogram/pages/publish/publish.js (time picker + validation)
- sport-miniprogram/pages/publish/publish.wxml (columnchange binding)
- sport-miniprogram/pages/index/index.js (hasMore + throttle + abort)
- sport-miniprogram/pages/index/index.wxml (lazy-load)
- sport-miniprogram/pages/teamDetail/teamDetail.js (new - full impl)
- sport-miniprogram/pages/teamDetail/teamDetail.json (new)
- sport-miniprogram/pages/teamDetail/teamDetail.wxml (new)
- sport-miniprogram/pages/teamDetail/teamDetail.wxss (new)
- sport-miniprogram/sitemap.json (new)

## 待后续处理
- 腾讯地图 Key 移到后端代理（P0 安全）
- API 地址切换为正式域名（Cloudflare Tunnel 不适合生产）
- urlCheck 上线前改回 true
- 运动类型统一配置（目前散落3处）
