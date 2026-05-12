const app = getApp();
Page({
  data: {
    cacheSize: "0KB",
    version: "1.0.0",
    isLogin: false,
  },
  onLoad() {
    this.calcCache();
    this.setData({ isLogin: app.globalData.isLogin });
  },
  onShow() {
    this.setData({ isLogin: app.globalData.isLogin });
  },
  calcCache() {
    try {
      const info = wx.getStorageInfoSync();
      this.setData({ cacheSize: info.currentSize + "KB" });
    } catch (e) {}
  },
  onClearCache() {
    wx.showModal({
      title: "清除缓存",
      content: "确定清除本地缓存？（不会清除登录信息）",
      success: (res) => {
        if (res.confirm) {
          const token = wx.getStorageSync("token");
          const userInfo = wx.getStorageSync("userInfo");
          const lastLocation = wx.getStorageSync("lastLocation");
          const lastLocationName = wx.getStorageSync("lastLocationName");
          wx.clearStorageSync();
          if (token) wx.setStorageSync("token", token);
          if (userInfo) wx.setStorageSync("userInfo", userInfo);
          if (lastLocation) wx.setStorageSync("lastLocation", lastLocation);
          if (lastLocationName) wx.setStorageSync("lastLocationName", lastLocationName);
          this.calcCache();
          wx.showToast({ title: "缓存已清除", icon: "success" });
        }
      }
    });
  },
  onAbout() {
    wx.showModal({ title: "关于", content: "运动组局 v1.0.0\n发现附近的运动组局，一起运动吧！", showCancel: false });
  },
  onFeedback() {
    wx.showModal({
      title: "意见反馈",
      content: "如有问题或建议，请添加客服微信反馈，我们会尽快处理。",
      confirmText: "复制微信号",
      success: (res) => {
        if (res.confirm) {
          wx.setClipboardData({
            data: "sport-mini-support",
            success: () => wx.showToast({ title: "微信号已复制", icon: "success" }),
          });
        }
      },
    });
  },
  onPrivacy() {
    wx.navigateTo({ url: '/pages/agreement/agreement?type=privacy' });
  },
  onTerms() {
    wx.navigateTo({ url: '/pages/agreement/agreement?type=terms' });
  },
  onDeleteAccount() {
    if (!app.globalData.isLogin) {
      wx.showToast({ title: "请先登录", icon: "none" });
      return;
    }
    wx.showModal({
      title: "⚠️ 注销账号",
      content: "注销后您的数据将被匿名化处理，此操作不可恢复。确定注销吗？",
      confirmText: "继续注销",
      confirmColor: "#e74c3c",
      success: (res) => {
        if (!res.confirm) return;
        wx.showModal({
          title: "最后确认",
          editable: true,
          placeholderText: '请输入"确认注销"',
          content: "",
          confirmText: "确认注销",
          confirmColor: "#e74c3c",
          success: (res2) => {
            if (!res2.confirm) return;
            const input = res2.content;
            if (input !== "确认注销") {
              wx.showToast({ title: '请输入"确认注销"', icon: "none" });
              return;
            }
            wx.showLoading({ title: "注销中..." });
            app.request({
              url: "/users/delete-account",
              method: "POST",
              data: { confirmText: input },
            }).then((r) => {
              wx.hideLoading();
              if (r.code === 0) {
                // 清除登录态
                app.globalData.token = null;
                app.globalData.userInfo = null;
                app.globalData.isLogin = false;
                wx.removeStorageSync("token");
                wx.removeStorageSync("userInfo");
                this.setData({ isLogin: false });
                wx.showToast({ title: "账号已注销", icon: "success" });
                setTimeout(() => {
                  wx.switchTab({ url: "/pages/index/index" });
                }, 1500);
              } else {
                wx.showToast({ title: r.message || "注销失败", icon: "none" });
              }
            }).catch(() => {
              wx.hideLoading();
              wx.showToast({ title: "网络错误", icon: "none" });
            });
          },
        });
      },
    });
  },
});
