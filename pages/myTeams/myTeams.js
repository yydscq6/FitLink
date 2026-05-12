// pages/myTeams/myTeams.js
const app = getApp();

Page({
  data: {
    teamList: [],
    isLoading: true,
    loadError: '',
    page: 1,
    hasMore: true,
    isLoadingMore: false,
    statusFilter: 'all',
    statusOptions: [
      { value: 'all', label: '全部' },
      { value: 'recruiting', label: '招募中' },
      { value: 'ongoing', label: '进行中' },
      { value: 'ended', label: '已结束' },
    ],
  },

  onLoad() { this.fetchList(true); },
  onShow() { this.fetchList(true); },
  onPullDownRefresh() { this.fetchList(true); },
  onReachBottom() {
    if (this.data.hasMore && !this.data.isLoadingMore) this.fetchList(false);
  },

  fetchList(refresh) {
    if (!app.globalData.isLogin) {
      this.setData({ isLoading: false, loadError: '请先登录' });
      return;
    }
    const targetPage = refresh ? 1 : this.data.page;
    this.setData({ isLoading: refresh && this.data.teamList.length === 0, loadError: '' });
    const params = { page: targetPage, pageSize: 20 };
    if (this.data.statusFilter !== 'all') params.status = this.data.statusFilter;

    app.request({ url: '/teams/my/created', method: 'GET', data: params })
      .then((res) => {
        if (res.code !== 0) throw new Error(res.message || '加载失败');
        const newList = res.data && res.data.list ? res.data.list : [];
        const total = res.data && res.data.pagination ? res.data.pagination.total : 0;
        const merged = refresh ? newList : this.data.teamList.concat(newList);
        this.setData({ teamList: merged, page: targetPage + 1, hasMore: merged.length < total, isLoading: false, isLoadingMore: false });
        if (refresh) wx.stopPullDownRefresh();
      })
      .catch((err) => {
        this.setData({ loadError: err.message || '网络异常', isLoading: false, isLoadingMore: false });
        if (refresh) wx.stopPullDownRefresh();
      });
  },

  onStatusChange(e) {
    const status = e.currentTarget.dataset.status;
    if (status === this.data.statusFilter) return;
    this.setData({ statusFilter: status, page: 1, hasMore: true });
    this.fetchList(true);
  },

  goToDetail(e) {
    wx.navigateTo({ url: '/pages/teamDetail/teamDetail?id=' + e.currentTarget.dataset.id });
  },

  goToPublish() {
    wx.switchTab({ url: '/pages/publish/publish' });
  },
});
