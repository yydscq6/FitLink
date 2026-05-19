// pages/my/my.js
const app = getApp();

// 与首页运动筛选栏顺序一致：篮球 → 羽毛球 → 跑步 → 足球 → 网球 → 游泳 → 排球 → 其他
const ALL_SPORT_TYPES = [
  { value: 'basketball', emoji: '🏀', name: '篮球' },
  { value: 'badminton', emoji: '🏸', name: '羽毛球' },
  { value: 'running', emoji: '🏃', name: '跑步' },
  { value: 'football', emoji: '⚽', name: '足球' },
  { value: 'tennis', emoji: '🎾', name: '网球' },
  { value: 'swimming', emoji: '🏊', name: '游泳' },
  { value: 'volleyball', emoji: '🏐', name: '排球' },
  { value: 'pingpong', emoji: '🏓', name: '乒乓球' },
  { value: 'hiking', emoji: '🥾', name: '爬山' },
  { value: 'cycling', emoji: '🚴', name: '骑行' },
  { value: 'fitness', emoji: '🏋️', name: '健身' },
  { value: 'other', emoji: '🎯', name: '其他' },
];

/**
 * 生成运动偏好选项（带选中状态，避免 WXML 中 indexOf 不可靠）
 */
function buildSportPrefOptions(sportPrefs) {
  return ALL_SPORT_TYPES.map(function(item) {
    return { value: item.value, emoji: item.emoji, name: item.name, selected: sportPrefs.indexOf(item.value) > -1 };
  });
}

Page({
  data: {
    userInfo: {},
    isLogin: false,
    unreadCount: 0,
    creditLevel: 'normal',
    // 运动偏好（预计算选中状态，避免 WXML indexOf 问题）
    sportPrefOptions: buildSportPrefOptions([]),
    sportPrefs: [],
    // 新用户引导
    showProfileGuide: false,
  },

  onLoad() {
    this.updateUserInfo();
  },

  onShow() {
    this.updateUserInfo();
    this.fetchUnreadCount();
  },

  onPullDownRefresh() {
    // 重新从服务器获取最新用户信息
    if (!app.globalData.isLogin) {
      wx.stopPullDownRefresh();
      return;
    }
    app.request({ url: '/users/me', method: 'GET' })
      .then((res) => {
        if (res.code === 0) {
          app.globalData.userInfo = { ...app.globalData.userInfo, ...res.data };
          wx.setStorageSync('userInfo', app.globalData.userInfo);
          this.updateUserInfo();
        }
        this.fetchUnreadCount();
        wx.stopPullDownRefresh();
      })
      .catch(() => {
        wx.stopPullDownRefresh();
      });
  },

  updateUserInfo() {
    const userInfo = app.globalData.userInfo || {};
    let sportPrefs = [];
    try {
      const raw = userInfo.sportPrefs;
      if (raw) {
        sportPrefs = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
      }
    } catch (e) { sportPrefs = []; }
    // 修复旧版无效头像路径（http://tmp/ 开头的是已过期的临时路径）
    if (userInfo.avatarUrl && userInfo.avatarUrl.indexOf('http://tmp/') > -1) {
      userInfo.avatarUrl = '';
      app.globalData.userInfo = userInfo;
      wx.setStorageSync('userInfo', userInfo);
    }
    // 判断是否需要显示引导（头像为空或昵称为默认值）
    const isDefaultProfile = app.globalData.isLogin && (!userInfo.avatarUrl || userInfo.nickname === '微信用户');
    const guideDismissed = wx.getStorageSync('profileGuideDismissed');
    this.setData({
      userInfo,
      isLogin: app.globalData.isLogin,
      creditLevel: this.getCreditLevel(userInfo.creditScore),
      sportPrefs,
      sportPrefOptions: buildSportPrefOptions(sportPrefs),
      showProfileGuide: isDefaultProfile && !guideDismissed,
    });
  },

  getCreditLevel(score) {
    if (!score && score !== 0) return 'normal';
    if (score >= 150) return 'excellent';
    if (score >= 120) return 'good';
    if (score >= 80) return 'normal';
    if (score >= 50) return 'warning';
    return 'poor';
  },

  fetchUnreadCount() {
    if (!app.globalData.isLogin) {
      // 清除 tab bar 徽章
      wx.removeTabBarBadge({ index: 2 }).catch(() => {});
      return;
    }
    app.request({ url: '/notifications?unreadOnly=1&pageSize=1', method: 'GET' })
      .then((res) => {
        if (res.code === 0) {
          const count = res.data?.unreadCount || 0;
          this.setData({ unreadCount: count });
          // 设置 tab bar 未读徽章
          if (count > 0) {
            wx.setTabBarBadge({
              index: 2,
              text: count > 99 ? '99+' : String(count),
            }).catch(() => {});
          } else {
            wx.removeTabBarBadge({ index: 2 }).catch(() => {});
          }
        }
      })
      .catch(() => {});
  },

  onLogin() {
    app.login()
      .then(() => {
        this.updateUserInfo();
        wx.showToast({ title: '登录成功', icon: 'success' });
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '登录失败', icon: 'none' });
      });
  },

  // 头像图片加载失败时回退到默认头像
  onAvatarError() {
    if (this.data.userInfo && this.data.userInfo.avatarUrl) {
      const userInfo = { ...this.data.userInfo, avatarUrl: '' };
      this.setData({ userInfo });
      app.globalData.userInfo = userInfo;
      wx.setStorageSync('userInfo', userInfo);
      // 异步清除服务端无效头像
      if (app.globalData.isLogin) {
        app.request({ url: '/users/me', method: 'PUT', data: { avatarUrl: '' } }).catch(() => {});
      }
    }
  },

  // 头像选择（新版 chooseAvatar 接口，返回临时文件路径）
  // 先上传到云存储获取 fileID，再更新用户信息
  onChooseAvatar(e) {
    const tempFilePath = e.detail.avatarUrl;
    if (!tempFilePath) return;

    wx.showLoading({ title: '上传中...' });
    const cloudPath = 'avatars/' + Date.now() + '-' + Math.random().toString(36).substr(2, 8) + '.jpg';

    wx.cloud.uploadFile({
      cloudPath,
      filePath: tempFilePath,
      success: (uploadRes) => {
        if (!uploadRes.fileID) {
          wx.hideLoading();
          wx.showToast({ title: '上传失败', icon: 'none' });
          return;
        }
        // 用云存储 fileID 更新用户头像
        app.request({ url: '/users/me', method: 'PUT', data: { avatarUrl: uploadRes.fileID } })
          .then((res) => {
            wx.hideLoading();
            if (res.code === 0) {
              const updated = res.data;
              app.globalData.userInfo = { ...app.globalData.userInfo, ...updated };
              wx.setStorageSync('userInfo', app.globalData.userInfo);
              this.updateUserInfo();
              wx.showToast({ title: '头像已更新', icon: 'success' });
            } else {
              wx.showToast({ title: res.message || '更新失败', icon: 'none' });
            }
          })
          .catch(() => {
            wx.hideLoading();
            wx.showToast({ title: '更新失败', icon: 'none' });
          });
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('[onChooseAvatar] upload fail:', err);
        wx.showToast({ title: '上传失败，请重试', icon: 'none' });
      },
    });
  },

  // 昵称输入
  onNicknameInput(e) {
    this._pendingNickname = e.detail.value;
  },

  // 保存昵称
  onSaveNickname() {
    const nickname = this._pendingNickname;
    if (!nickname || !nickname.trim()) return;
    if (nickname.trim().length > 20) {
      wx.showToast({ title: '昵称不能超过20字', icon: 'none' });
      return;
    }
    app.request({ url: '/users/me', method: 'PUT', data: { nickname: nickname.trim() } })
      .then((res) => {
        if (res.code === 0) {
          const updated = res.data;
          app.globalData.userInfo = { ...app.globalData.userInfo, ...updated };
          wx.setStorageSync('userInfo', app.globalData.userInfo);
          this.updateUserInfo();
          wx.showToast({ title: '昵称已更新', icon: 'success' });
        }
      })
      .catch(() => {
        wx.showToast({ title: '更新失败', icon: 'none' });
      });
  },

  onNotifications() {
    if (!app.globalData.isLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/notifications/notifications' });
  },

  onMyTeams() {
    if (!app.globalData.isLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/myTeams/myTeams' });
  },

  onMyJoins() {
    if (!app.globalData.isLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/joinedTeams/joinedTeams' });
  },

  onFavorites() {
    if (!app.globalData.isLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/favorites/favorites' });
  },

  /**
   * 关闭新用户引导
   */
  onDismissGuide() {
    this.setData({ showProfileGuide: false });
    wx.setStorageSync('profileGuideDismissed', true);
  },

  /**
   * 切换运动偏好
   */
  onToggleSportPref(e) {
    if (!app.globalData.isLogin) return;
    const value = e.currentTarget.dataset.value;
    let prefs = [...this.data.sportPrefs];
    const idx = prefs.indexOf(value);
    if (idx > -1) {
      prefs.splice(idx, 1);
    } else {
      prefs.push(value);
    }
    this.setData({ sportPrefs: prefs, sportPrefOptions: buildSportPrefOptions(prefs) });

    // 立即同步到全局（首页 onShow 能读到最新偏好）
    const prefsStr = JSON.stringify(prefs);
    app.globalData.userInfo = { ...app.globalData.userInfo, sportPrefs: prefsStr };
    wx.setStorageSync('userInfo', app.globalData.userInfo);

    // 异步保存到后端
    app.request({
      url: '/users/me',
      method: 'PUT',
      data: { sportPrefs: prefsStr },
    }).then((res) => {
      if (res.code === 0) {
        app.globalData.userInfo = { ...app.globalData.userInfo, ...res.data };
        wx.setStorageSync('userInfo', app.globalData.userInfo);
      }
    }).catch(() => {});
  },

  onSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  onLogout() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          app.globalData.token = null;
          app.globalData.userInfo = null;
          app.globalData.isLogin = false;
          wx.removeStorageSync('token');
          wx.removeStorageSync('userInfo');
          this.updateUserInfo();
          wx.showToast({ title: '已退出登录', icon: 'success' });
        }
      },
    });
  },
});
