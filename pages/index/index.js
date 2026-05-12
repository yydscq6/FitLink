/**
 * 首页 index.js
 * 功能：定位 → 获取附近组局列表 → 筛选 → 跳转详情
 */

const app = getApp();
const locationService = require('../../utils/location');

// 运动类型中文名 + emoji 映射（WXS 也用，保持一致）
// 全部运动类型（默认顺序）
const ALL_SPORT_TYPES = [
  { value: 'basketball', emoji: '🏀', name: '篮球' },
  { value: 'badminton',  emoji: '🏸', name: '羽毛球' },
  { value: 'running',    emoji: '🏃', name: '跑步' },
  { value: 'football',   emoji: '⚽', name: '足球' },
  { value: 'tennis',     emoji: '🎾', name: '网球' },
  { value: 'swimming',   emoji: '🏊', name: '游泳' },
  { value: 'volleyball', emoji: '🏐', name: '排球' },
  { value: 'pingpong',   emoji: '🏓', name: '乒乓球' },
  { value: 'hiking',     emoji: '🥾', name: '爬山' },
  { value: 'cycling',    emoji: '🚴', name: '骑行' },
  { value: 'fitness',    emoji: '🏋️', name: '健身' },
  { value: 'other',      emoji: '🎯', name: '其他' },
];

// 地图反向地理编码已由后端代理（/api/map/geocoder），无需客户端 Key

Page({
  data: {
    // 定位
    location: null,           // { longitude, latitude }
    locationName: '',
    hasLocation: false,

    // 列表
    teamList: [],
    filteredList: [],         // 搜索过滤后的列表（供 WXML 使用）
    page: 1,
    pageSize: 20,
    hasMore: true,
    isLoading: false,
    isLoadingMore: false,
    isRefreshing: false,
    loadError: '',

    // 筛选
    currentSportType: 'all',
    sportFilterList: ALL_SPORT_TYPES.slice(0, -1), // 默认不含 "其他"，按需动态排序

    // 搜索
    searchKeyword: '',
    isSearchFocused: false,

    // 高级筛选
    showAdvancedFilter: false,
    timeFilter: 'all',       // all | today | tomorrow | week
    filterTag: '',            // 标签筛选
    minSpots: '',            // 最少剩余名额
    maxDistance: '',          // 最大距离(km)

    // 收藏
    favoriteIds: [],

    // 推荐模式
    recommendMode: false,   // true 时显示"智能推荐"标识

    // 视图模式: list | map
    viewMode: 'list',
    mapMarkers: [],
    mapCenter: { longitude: 116.4074, latitude: 39.9042 },
    mapScale: 12,
    selectedTeam: null,        // 地图上选中的组局（底部卡片）

    // 登录
    showLoginModal: false,
    isLoginRequired: false,
  },

  // =============================================
  // 生命周期
  // =============================================

  onLoad() {
    // 检查登录态
    if (!app.globalData.isLogin) {
      this.setData({ showLoginModal: true });
    }

    // 构建运动筛选栏（根据用户偏好排序）
    this._buildSportFilterList();

    // 尝试从全局数据获取已有位置
    if (app.globalData.location) {
      this.setData({
        location: app.globalData.location,
        locationName: app.globalData.locationName,
        hasLocation: true,
      });
      this.fetchTeamList(true);
    } else {
      // 无缓存，等待 app.js 定位结果（可能正在 GPS 定位中）
      this.setData({ isLoading: true });

      var self = this;
      app.onLocationReady(function (result) {
        if (self._destroyed) return;
        self._updateLocation(result.location, result.locationName);
      });

      // 超时保底：5 秒后如果还没定位成功，使用默认位置
      this._locationTimeout = setTimeout(function () {
        if (!self.data.hasLocation && !self._destroyed) {
          console.warn('[index] 定位超时，使用默认位置');
          var defaultLocation = { longitude: 116.4074, latitude: 39.9042 };
          self._updateLocation(defaultLocation, '北京市');
        }
      }, 5000);
    }
  },

  onUnload() {
    this._destroyed = true;
    if (this._locationTimeout) {
      clearTimeout(this._locationTimeout);
      this._locationTimeout = null;
    }
  },

  /**
   * 构建运动筛选栏列表（偏好运动排在前面）
   * 用户偏好 ["basketball","pingpong","hiking"] → 首页显示 全部 | 篮球 | 乒乓球 | 爬山 | 羽毛球 | ...
   */
  _buildSportFilterList() {
    let prefs = [];
    const userInfo = app.globalData.userInfo;
    if (userInfo && userInfo.sportPrefs) {
      try {
        prefs = typeof userInfo.sportPrefs === 'string'
          ? JSON.parse(userInfo.sportPrefs)
          : (Array.isArray(userInfo.sportPrefs) ? userInfo.sportPrefs : []);
      } catch (e) { prefs = []; }
    }

    // 分成两组：偏好运动 和 其余运动
    const preferred = [];
    const rest = [];
    ALL_SPORT_TYPES.forEach(function(item) {
      if (item.value === 'other') return; // "其他" 放最后
      if (prefs.indexOf(item.value) > -1) {
        preferred.push(item);
      } else {
        rest.push(item);
      }
    });

    // 偏好在前 + 其余在后（不含"其他"，筛选栏不显示它）
    const list = preferred.concat(rest);
    this.setData({ sportFilterList: list });
  },

  // 页面是否已销毁
  _destroyed: false,
  _locationTimeout: null,

  _lastShowTime: 0,

  onShow() {
    // 检查登录态（从其他页面返回时可能状态已变）
    if (!app.globalData.isLogin && !this.data.showLoginModal) {
      this.setData({ showLoginModal: true });
    } else if (app.globalData.isLogin && this.data.showLoginModal) {
      this.setData({ showLoginModal: false });
    }

    // 用户偏好可能在「我的」页修改，每次 onShow 重新排序
    this._buildSportFilterList();

    // 同步全局位置（发布页可能更新了位置）
    const globalLoc = app.globalData.location;
    if (globalLoc && (
      !this.data.location ||
      globalLoc.longitude !== this.data.location.longitude ||
      globalLoc.latitude !== this.data.location.latitude
    )) {
      this.setData({
        location: globalLoc,
        locationName: app.globalData.locationName || '当前位置',
        hasLocation: true,
      });
      // 位置变了，强制刷新列表
      this._lastShowTime = 0;
    }

    // 节流：距离上次刷新超过 30s 才重新请求，避免频繁切换 tab 重复加载
    const now = Date.now();
    if (this.data.hasLocation && now - this._lastShowTime > 30000) {
      this._lastShowTime = now;
      this.onPullRefresh();
    }
  },

  onShareAppMessage() {
    return {
      title: '一起运动！发现附近的组局',
      path: '/pages/index/index',
    };
  },

  // =============================================
  // 定位相关
  // =============================================

  /**
   * 选择位置（用户主动）
   */
  onChooseLocation() {
    this.chooseLocation();
  },

  /**
   * 刷新位置
   */
  onRefreshLocation(e) {
    e.stopPropagation();
    this.chooseLocation();
  },

  /**
   * 调用微信地图选点（用户主动选择位置）
   * wx.chooseLocation 自带地图界面和授权流程，无需 wx.getLocation
   */
  chooseLocation() {
    locationService.chooseLocation()
      .then((result) => {
        this._updateLocation(result.location, result.locationName);
      })
      .catch((err) => {
        // 用户取消选择不算失败，静默处理
        if (err.errMsg && err.errMsg.indexOf('cancel') > -1) return;
        console.error('chooseLocation fail', err);
        wx.showToast({ title: '选择位置失败，请重试', icon: 'none' });
      });
  },

  _updateLocation(location, locationName) {
    app.setLocation(location, locationName);
    this.setData({
      location,
      locationName: locationName || '未知位置',
      hasLocation: true,
    });
    // 刷新列表
    this.fetchTeamList(true);
  },

  // =============================================
  // 数据加载
  // =============================================

  /**
   * 获取附近组局列表
   * @param {boolean} refresh 是否刷新（重置列表）
   */
  fetchTeamList(refresh = false) {
    if (!this.data.location) return;
    if (this.data.isLoading) return;

    // 取消上一次未完成的请求（防止竞态）
    if (this._currentRequest) {
      this._currentRequest.__abort = true;
    }
    const requestRef = { __abort: false };
    this._currentRequest = requestRef;

    const { location, currentSportType, page, pageSize } = this.data;
    const targetPage = refresh ? 1 : page;

    this.setData({
      isLoading: !refresh,
      isLoadingMore: !refresh && !this.data.isLoadingMore,
      loadError: '',
    });

    const params = {
      longitude: location.longitude,
      latitude: location.latitude,
      radius: 5000,
      page: targetPage,
      pageSize,
    };
    if (currentSportType !== 'all') {
      params.sportType = currentSportType;
    }
    // 高级筛选参数
    if (this.data.timeFilter && this.data.timeFilter !== 'all') {
      params.timeFilter = this.data.timeFilter;
    }
    if (this.data.minSpots && parseInt(this.data.minSpots) > 0) {
      params.minSpots = this.data.minSpots;
    }
    if (this.data.maxDistance && parseFloat(this.data.maxDistance) > 0) {
      params.maxDistance = this.data.maxDistance;
    }
    if (this.data.filterTag) {
      params.tag = this.data.filterTag;
    }

    // 无显式筛选时启用智能推荐（综合偏好、距离、时间、名额评分）
    const hasExplicitFilter = (currentSportType && currentSportType !== 'all')
      || (this.data.timeFilter && this.data.timeFilter !== 'all')
      || this.data.filterTag
      || this.data.minSpots
      || this.data.maxDistance;
    if (!hasExplicitFilter) {
      params.mode = 'recommended';
    }

    app.request({
      url: '/teams/nearby',
      method: 'GET',
      data: params,
    }).then((res) => {
      // 如果请求已被标记为废弃（切换了筛选条件），丢弃结果
      if (requestRef.__abort) return;
      const { code, data, message } = res;
      if (code !== 0) throw new Error(message || '加载失败');

      const newList = data?.data?.list || [];
      const total = data?.data?.pagination?.total || 0;
      const favoriteIds = data?.data?.favoriteIds || this.data.favoriteIds;
      const serverMode = data?.data?.mode || 'distance';
      const merged = refresh ? newList : [...this.data.teamList, ...newList];

      this.setData({
        teamList: merged,
        page: targetPage + 1,
        hasMore: merged.length < total,
        isLoading: false,
        isLoadingMore: false,
        isRefreshing: false,
        favoriteIds: refresh ? (favoriteIds || []) : this.data.favoriteIds,
        recommendMode: refresh ? (serverMode === 'recommended') : this.data.recommendMode,
      });
      // 同步更新搜索过滤列表
      this._updateFilteredList();

      // 如果当前是地图视图，同步更新 markers
      if (this.data.viewMode === 'map') {
        this._buildMapMarkers();
      }
    }).catch((err) => {
      if (requestRef.__abort) return;
      this.setData({
        loadError: err.message || '网络异常，请重试',
        isLoading: false,
        isLoadingMore: false,
        isRefreshing: false,
      });
    });
  },

  /**
   * 下拉刷新
   */
  onPullRefresh() {
    if (!this.data.hasLocation) return;
    this.setData({ isRefreshing: true });
    this.fetchTeamList(true);
  },

  /**
   * 上拉加载更多
   */
  onLoadMore() {
    if (!this.data.hasMore || this.data.isLoadingMore || this.data.isLoading) return;
    this.fetchTeamList(false);
  },

  /**
   * 重试
   */
  onRetry() {
    this.fetchTeamList(true);
  },

  // =============================================
  // 筛选
  // =============================================

  onSportTypeChange(e) {
    const sportType = e.currentTarget.dataset.type;
    if (sportType === this.data.currentSportType) return;
    this.setData({
      currentSportType: sportType,
      page: 1,
      hasMore: true,
    });
    this.fetchTeamList(true);
    // 过滤列表会在 fetchTeamList 完成后自动更新
  },

  // =============================================
  // 搜索
  // =============================================

  onSearchInput(e) {
    const keyword = e.detail.value;
    this.setData({ searchKeyword: keyword });
    this._updateFilteredList();
  },

  onSearchFocus() {
    this.setData({ isSearchFocused: true });
  },

  onSearchBlur() {
    this.setData({ isSearchFocused: false });
  },

  onSearchConfirm() {
    this.setData({ isSearchFocused: false });
    this._updateFilteredList();
  },

  onClearSearch() {
    this.setData({ searchKeyword: '', filteredList: this.data.teamList });
  },

  /**
   * 获取过滤后的列表（搜索关键词 + 运动类型）
   */
  getFilteredList() {
    const { teamList, searchKeyword } = this.data;
    if (!searchKeyword || !searchKeyword.trim()) return teamList;
    const kw = searchKeyword.trim().toLowerCase();
    return teamList.filter(t =>
      (t.title && t.title.toLowerCase().indexOf(kw) > -1) ||
      (t.venueName && t.venueName.toLowerCase().indexOf(kw) > -1) ||
      (t.description && t.description.toLowerCase().indexOf(kw) > -1)
    );
  },

  /**
   * 更新 filteredList（供 WXML 模板使用）
   */
  _updateFilteredList() {
    this.setData({ filteredList: this.getFilteredList() });
  },

  // =============================================
  // 高级筛选
  // =============================================

  onToggleAdvancedFilter() {
    this.setData({ showAdvancedFilter: !this.data.showAdvancedFilter });
  },

  onTimeFilterChange(e) {
    const val = e.currentTarget.dataset.value;
    this.setData({ timeFilter: val });
    // 点击时间芯片后自动应用（因为时间是独立的即时筛选）
    this.setData({ showAdvancedFilter: false });
    this.fetchTeamList(true);
  },

  onTagFilterChange(e) {
    const val = e.currentTarget.dataset.value;
    this.setData({ filterTag: val });
    this.setData({ showAdvancedFilter: false });
    this.fetchTeamList(true);
  },

  onMinSpotsInput(e) {
    this.setData({ minSpots: e.detail.value });
  },

  onMaxDistanceInput(e) {
    this.setData({ maxDistance: e.detail.value });
  },

  onApplyAdvancedFilter() {
    this.setData({ showAdvancedFilter: false });
    this.fetchTeamList(true);
  },

  onResetAdvancedFilter() {
    this.setData({
      timeFilter: 'all',
      filterTag: '',
      minSpots: '',
      maxDistance: '',
      showAdvancedFilter: false,
    });
    this.fetchTeamList(true);
  },

  hasActiveFilters() {
    return this.data.timeFilter !== 'all' || this.data.minSpots || this.data.maxDistance;
  },

  // =============================================
  // 收藏
  // =============================================

  onToggleFavorite(e) {
    if (!app.globalData.isLogin) {
      this.setData({ showLoginModal: true });
      return;
    }
    const teamId = e.currentTarget.dataset.id;
    if (!teamId) return;
    app.request({
      url: `/teams/${teamId}/favorite`,
      method: 'POST',
    }).then((res) => {
      if (res.code === 0) {
        let ids = [...this.data.favoriteIds];
        if (res.data.favorited) {
          if (!ids.includes(teamId)) ids.push(teamId);
          wx.showToast({ title: '已收藏', icon: 'success' });
        } else {
          ids = ids.filter(id => id !== teamId);
          wx.showToast({ title: '已取消收藏', icon: 'none' });
        }
        this.setData({ favoriteIds: ids });
      }
    }).catch(() => {});
  },

  isFavorited(teamId) {
    return this.data.favoriteIds.indexOf(teamId) > -1;
  },

  // =============================================
  // 视图切换（列表 / 地图）
  // =============================================

  onToggleView() {
    const newMode = this.data.viewMode === 'list' ? 'map' : 'list';
    this.setData({ viewMode: newMode });
    if (newMode === 'map') {
      this._buildMapMarkers();
    }
  },

  /**
   * 将组局列表转为地图 marker
   */
  _buildMapMarkers() {
    const { teamList, location } = this.data;
    const sportEmoji = {
      basketball: '🏀', badminton: '🏸', running: '🏃',
      football: '⚽', tennis: '🎾', swimming: '🏊',
      volleyball: '🏐', pingpong: '🏓', hiking: '🥾',
      cycling: '🚴', fitness: '🏋️', other: '🏐',
    };
    const markers = teamList.map((t, idx) => {
      const lon = t.location ? t.location.longitude : (t.longitude || 0);
      const lat = t.location ? t.location.latitude : (t.latitude || 0);
      if (!lon || !lat) return null;
      const emoji = sportEmoji[t.sportType] || '🏐';
      const statusText = t.status === 'recruiting' ? '招募中' : t.status === 'ongoing' ? '进行中' : '';
      const calloutContent = `${emoji} ${t.title}\n📍 ${t.venueName || ''}\n👥 ${t.currentMembers || 0}/${t.maxMembers}人` + (statusText ? ` · ${statusText}` : '');
      return {
        id: t._id || idx,
        longitude: lon,
        latitude: lat,
        width: 30,
        height: 30,
        iconPath: app.globalData.markerImagePath || '/assets/marker.png',
        callout: {
          content: calloutContent,
          display: 'BYCLICK',
          padding: 12,
          borderRadius: 12,
          bgColor: '#ffffff',
          fontSize: 14,
          borderWidth: 1,
          borderColor: '#e8eaed',
          boxShadow: '0 4rpx 16rpx rgba(0,0,0,0.08)',
        },
        label: {
          content: emoji,
          color: '#ffffff',
          fontSize: 12,
          anchorX: -12,
          anchorY: -12,
          bgColor: '#0a9a5d',
          borderRadius: 16,
          padding: 6,
          textAlign: 'center',
        },
      };
    }).filter(Boolean);

    const center = location || { longitude: 116.4074, latitude: 39.9042 };
    this.setData({
      mapMarkers: markers,
      mapCenter: center,
    });
  },

  /**
   * 点击地图 marker 的 callout → 弹出底部卡片
   */
  onCalloutTap(e) {
    this._selectTeamById(e.markerId);
  },

  /**
   * 点击地图 marker → 弹出底部卡片 + 定位到该点
   */
  onMarkerTap(e) {
    this._selectTeamById(e.markerId);
  },

  /**
   * 根据 ID 选中组局，显示底部卡片并移动地图中心
   */
  _selectTeamById(teamId) {
    if (!teamId) return;
    const team = this.data.teamList.find(t => String(t._id) === String(teamId));
    if (!team) return;
    const lon = team.location ? team.location.longitude : (team.longitude || 0);
    const lat = team.location ? team.location.latitude : (team.latitude || 0);
    this.setData({
      selectedTeam: team,
      mapCenter: { longitude: lon, latitude: lat },
    });
  },

  /**
   * 关闭底部选中卡片
   */
  onCloseSelectedCard() {
    this.setData({ selectedTeam: null });
  },

  /**
   * 底部卡片「查看详情」跳转
   */
  onGoToDetail(e) {
    const teamId = e.currentTarget.dataset.id;
    if (teamId) {
      wx.navigateTo({ url: `/pages/teamDetail/teamDetail?id=${teamId}` });
    }
  },

  // =============================================
  // 跳转
  // =============================================

  goToTeamDetail(e) {
    const teamId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/teamDetail/teamDetail?id=${teamId}`,
    });
  },

  goToPublish() {
    if (!app.globalData.isLogin) {
      this.setData({ showLoginModal: true });
      return;
    }
    wx.switchTab({ url: '/pages/publish/publish' });
  },

  // =============================================
  // 登录
  // =============================================

  onCloseLoginModal() {
    this.setData({ showLoginModal: false });
  },

  /**
   * 查看协议/隐私政策
   */
  onViewAgreement(e) {
    const type = e.currentTarget.dataset.type || 'privacy';
    wx.navigateTo({ url: `/pages/agreement/agreement?type=${type}` });
  },

  /**
   * 微信登录（wx.login 静默登录，无需用户授权弹窗）
   */
  onLogin() {
    wx.showLoading({ title: '登录中...' });
    app.login()
      .then(() => {
        wx.hideLoading();
        this.setData({ showLoginModal: false });
        wx.showToast({ title: '登录成功', icon: 'success' });
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '登录失败', icon: 'none' });
      });
  },

  /**
   * 手机号快捷登录（需要在微信后台申请 getPhoneNumber 权限后才可使用）
   */
  onPhoneLogin(e) {
    const errMsg = e.detail?.errMsg || '';
    if (!errMsg.includes(':ok') && !errMsg.includes('ok')) {
      if (errMsg.includes('deny') || errMsg.includes('cancel')) {
        wx.showToast({ title: '您取消了授权', icon: 'none' });
      } else {
        wx.showToast({ title: '授权失败，请重试', icon: 'none' });
      }
      return;
    }
    this.onLogin();
  },
});
