const app = getApp();

// 通知分类定义
const TAB_ALL = 'all';
const TAB_INTERACT = 'interact';   // 互动：加入、退出、评论、回复、更新
const TAB_ACTIVITY = 'activity';   // 活动：提醒、结束、取消
const TAB_SYSTEM = 'system';       // 系统：举报处理等

const INTERACT_TYPES = ['join', 'quit', 'comment', 'reply', 'update'];
const ACTIVITY_TYPES = ['reminder', 'ended', 'cancelled'];
// 其余归为系统

function getCategory(type) {
  if (INTERACT_TYPES.includes(type)) return TAB_INTERACT;
  if (ACTIVITY_TYPES.includes(type)) return TAB_ACTIVITY;
  return TAB_SYSTEM;
}

Page({
  data: {
    list: [],               // 全量通知
    filteredList: [],       // 当前 tab 过滤后的列表
    isLoading: true,
    page: 1,
    hasMore: true,
    unreadCount: 0,
    // 分类 tab
    activeTab: TAB_ALL,
    tabs: [
      { key: TAB_ALL, label: '全部' },
      { key: TAB_INTERACT, label: '互动' },
      { key: TAB_ACTIVITY, label: '活动' },
      { key: TAB_SYSTEM, label: '系统' },
    ],
    tabCounts: { all: 0, interact: 0, activity: 0, system: 0 },
  },

  onLoad() { this.fetchList(true); },
  onShow() { this.fetchList(true); },
  onPullDownRefresh() { this.fetchList(true); },
  onReachBottom() {
    if (this.data.hasMore) this.fetchList(false);
  },

  /**
   * 切换分类 tab
   */
  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
    this._applyFilter();
  },

  /**
   * 根据当前 tab 过滤列表
   */
  _applyFilter() {
    const { list, activeTab } = this.data;
    let filtered = list;
    if (activeTab !== TAB_ALL) {
      filtered = list.filter(item => getCategory(item.type) === activeTab);
    }
    this.setData({ filteredList: filtered });
  },

  /**
   * 统计各分类数量
   */
  _countTabs(list) {
    const counts = { all: list.length, interact: 0, activity: 0, system: 0 };
    list.forEach(item => {
      const cat = getCategory(item.type);
      counts[cat]++;
    });
    return counts;
  },

  fetchList(refresh) {
    const targetPage = refresh ? 1 : this.data.page;
    this.setData({ isLoading: refresh && this.data.list.length === 0 });
    app.request({ url: "/notifications", method: "GET", data: { page: targetPage, pageSize: 50 } })
      .then((res) => {
        if (res.code !== 0) throw new Error(res.message);
        const newList = res.data && res.data.list ? res.data.list : [];
        const total = res.data && res.data.pagination ? res.data.pagination.total : 0;
        const merged = refresh ? newList : this.data.list.concat(newList);
        const tabCounts = this._countTabs(merged);
        this.setData({
          list: merged,
          page: targetPage + 1,
          hasMore: merged.length < total,
          isLoading: false,
          unreadCount: res.data.unreadCount || 0,
          tabCounts: tabCounts,
        });
        this._applyFilter();
        if (refresh) wx.stopPullDownRefresh();
        // 自动标记已读 + 清除 tab bar 徽章
        if (refresh && newList.length > 0) this.markAllRead();
      })
      .catch((err) => {
        this.setData({ isLoading: false });
        if (refresh) wx.stopPullDownRefresh();
      });
  },

  markAllRead() {
    app.request({ url: "/notifications/read-all", method: "POST", data: {} })
      .then(() => {
        // 将所有条目标记为已读
        const updated = this.data.list.map(item => ({ ...item, isRead: 1 }));
        this.setData({ list: updated, unreadCount: 0 });
        this._applyFilter();
        wx.removeTabBarBadge({ index: 2 }).catch(() => {});
      })
      .catch(() => {});
  },

  goToTeam(e) {
    const teamId = e.currentTarget.dataset.teamid;
    if (teamId) wx.navigateTo({ url: "/pages/teamDetail/teamDetail?id=" + teamId });
  },
});
