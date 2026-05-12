const app = getApp();
Page({
  data: { teamList: [], isLoading: true, loadError: "", page: 1, hasMore: true, isLoadingMore: false },
  onLoad() { this.fetchList(true); },
  onShow() { this.fetchList(true); },
  onPullDownRefresh() { this.fetchList(true); },
  onReachBottom() { if (this.data.hasMore && !this.data.isLoadingMore) this.fetchList(false); },
  fetchList(refresh) {
    if (!app.globalData.isLogin) { this.setData({ isLoading: false, loadError: "请先登录" }); return; }
    const targetPage = refresh ? 1 : this.data.page;
    this.setData({ isLoading: refresh && this.data.teamList.length === 0, loadError: "" });
    app.request({ url: "/teams/my/joined", method: "GET", data: { page: targetPage, pageSize: 20 } })
      .then((res) => {
        if (res.code !== 0) throw new Error(res.message || "加载失败");
        const newList = res.data && res.data.list ? res.data.list : [];
        const total = res.data && res.data.pagination ? res.data.pagination.total : 0;
        const merged = refresh ? newList : this.data.teamList.concat(newList);
        this.setData({ teamList: merged, page: targetPage + 1, hasMore: merged.length < total, isLoading: false, isLoadingMore: false });
        if (refresh) wx.stopPullDownRefresh();
      })
      .catch((err) => {
        this.setData({ loadError: err.message || "网络异常", isLoading: false, isLoadingMore: false });
        if (refresh) wx.stopPullDownRefresh();
      });
  },
  goToDetail(e) { wx.navigateTo({ url: "/pages/teamDetail/teamDetail?id=" + e.currentTarget.dataset.id }); },
  goToHome() { wx.switchTab({ url: "/pages/index/index" }); },
});
