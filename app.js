/**
 * 运动组队小程序 - app.js
 * 应用入口：全局状态管理、登录态维护、地理位置初始化
 * 使用微信云开发（云函数 + 云数据库）
 */
var locationService = require('./utils/location');

/**
 * URL → 云函数 action 映射
 * 将原来的 RESTful URL 转换为云函数的 action + 参数格式
 */
function mapUrlToAction(url, method) {
  // 去掉查询参数和前缀
  const clean = url.split('?')[0].replace(/^\/api\//, '').replace(/^\//, '');

  // 精确匹配
  const exactMap = {
    'users/login':       'users.login',
    'teams/nearby':      'teams.nearby',
    'teams/my/created':  'teams.myCreated',
    'teams/my/joined':   'teams.myJoined',
    'teams/my/favorites': 'teams.myFavorites',
    'notifications':     'notifications.list',
    'notifications/read': 'notifications.markRead',
    'notifications/read-all': 'notifications.markAllRead',
  };

  if (exactMap[clean]) return { action: exactMap[clean] };

  // users/me（区分 GET / PUT）
  if (clean === 'users/me') {
    return { action: method === 'PUT' ? 'users.updateMe' : 'users.me' };
  }

  // teams 模式匹配
  const teamsMatch = clean.match(/^teams\/([^/]+)$/);
  if (teamsMatch) {
    if (method === 'PUT') return { action: 'teams.update', teamId: teamsMatch[1] };
    return { action: 'teams.detail', teamId: teamsMatch[1] };
  }

  const teamsActionMatch = clean.match(/^teams\/([^/]+)\/(join|quit|cancel|end|favorite|qrcode)$/);
  if (teamsActionMatch) {
    const actionMap = {
      join: 'teams.join', quit: 'teams.quit', cancel: 'teams.cancel',
      end: 'teams.end', favorite: 'teams.toggleFavorite', qrcode: 'teams.qrcode',
    };
    return { action: actionMap[teamsActionMatch[2]], teamId: teamsActionMatch[1] };
  }

  if (method === 'POST' && clean === 'teams') return { action: 'teams.create' };

  // comments 模式匹配
  const commentsMatch = clean.match(/^comments\/([^/]+)$/);
  if (commentsMatch) {
    if (method === 'POST') return { action: 'comments.create', teamId: commentsMatch[1] };
    return { action: 'comments.list', teamId: commentsMatch[1] };
  }

  const commentsLikeMatch = clean.match(/^comments\/([^/]+)\/like$/);
  if (commentsLikeMatch) {
    if (method === 'DELETE') return { action: 'comments.unlike', commentId: commentsLikeMatch[1] };
    return { action: 'comments.like', commentId: commentsLikeMatch[1] };
  }

  // reports
  if (clean === 'reports' && method === 'POST') return { action: 'reports.create' };
  if (clean === 'reports' && method === 'GET') return { action: 'reports.list' };

  // users/:id
  const usersIdMatch = clean.match(/^users\/([^/]+)$/);
  if (usersIdMatch) return { action: 'users.getById', userId: usersIdMatch[1] };

  return null;
}

const appInstance = {
  globalData: {
    // 用户信息
    userInfo: null,
    token: null,
    // 地理位置
    location: null,
    locationName: '',
    // 登录态
    isLogin: false,
    // 云开发环境 ID（在微信公众平台 → 开发 → 云开发中查看）
    cloudEnv: 'cloud1-5ghdrhutc3470ef7', // 云开发环境 ID
  },

  onLaunch() {
    // 初始化云开发
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: this.globalData.cloudEnv,
        traceUser: true,
      });
    }

    this.checkLogin();
    this.initLocation();
    this._generateMarkerImage();
  },

  /**
   * 全局错误监控
   */
  onError(err) {
    console.error('[App.onError]', err);
  },

  onPageNotFound(res) {
    console.warn('[App.onPageNotFound]', res.path);
    wx.switchTab({ url: '/pages/index/index' });
  },

  /**
   * 生成地图标记图片（绿色圆形 marker）
   */
  _generateMarkerImage() {
    try {
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: 48, height: 48 });
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0a9a5d';
      ctx.beginPath();
      ctx.arc(24, 24, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(24, 24, 10, 0, Math.PI * 2);
      ctx.fill();
      wx.canvasToTempFilePath({
        canvas: canvas,
        x: 0, y: 0,
        width: 48, height: 48,
        destWidth: 48, destHeight: 48,
        success: (res) => {
          this.globalData.markerImagePath = res.tempFilePath;
        },
        fail: () => {},
      });
    } catch (e) {
      console.log('OffscreenCanvas not supported');
    }
  },

  /**
   * 检查登录态（读取本地缓存 + 验证有效性）
   */
  checkLogin() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.globalData.userInfo = userInfo;
      this.globalData.isLogin = true;

      // 云开发不需要 token，直接调用云函数验证
      this.callApi({ action: 'users.me' }).then((res) => {
        if (res.code === 0 && res.data) {
          this.globalData.userInfo = { ...userInfo, ...res.data };
          wx.setStorageSync('userInfo', this.globalData.userInfo);
        } else if (res.code === 401) {
          this.globalData.userInfo = null;
          this.globalData.isLogin = false;
          wx.removeStorageSync('userInfo');
        }
      }).catch(() => {});
    }
  },

  /**
   * 初始化地理位置
   * 优先使用未过期缓存，否则发起 GPS 定位 + 反向地理编码
   */
  initLocation() {
    // 先从 locationService 读取未过期缓存
    var cached = locationService.getCachedLocation();
    if (cached) {
      this.globalData.location = cached;
      this.globalData.locationName = locationService.getCachedLocationName();
      return; // 缓存有效，无需立即请求 GPS
    }

    // 缓存过期或不存在，发起真实定位
    var self = this;
    locationService.getCurrentLocation({ useCache: false })
      .then(function (result) {
        self.globalData.location = result.location;
        self.globalData.locationName = result.locationName;
        // 通知等待定位的页面
        self._notifyLocationReady(result);
      })
      .catch(function (err) {
        if (err && err.noPermission) {
          console.warn('[app] 用户拒绝定位权限');
        } else {
          console.warn('[app] 定位失败:', err);
        }
        // 定位失败时不阻塞，页面会使用默认位置
      });
  },

  /**
   * 定位就绪回调队列
   * 页面可以在 onLoad 中注册回调，等待定位完成后执行
   */
  _locationReadyCallbacks: [],
  _locationReady: false,

  /**
   * 注册定位完成回调
   * @param {Function} callback - 回调函数，参数为 { location, locationName }
   */
  onLocationReady(callback) {
    if (this._locationReady && this.globalData.location) {
      // 定位已完成，立即回调
      callback({
        location: this.globalData.location,
        locationName: this.globalData.locationName,
      });
    } else {
      this._locationReadyCallbacks.push(callback);
    }
  },

  /**
   * 通知所有等待定位的页面
   */
  _notifyLocationReady(result) {
    this._locationReady = true;
    var cbs = this._locationReadyCallbacks;
    this._locationReadyCallbacks = [];
    cbs.forEach(function (cb) {
      try {
        cb(result);
      } catch (e) {
        console.error('[app] locationReady callback error:', e);
      }
    });
  },

  /**
   * 统一登录（微信登录 → 云函数）
   * 云开发无需 wx.login 获取 code，直接调用云函数即可获取 openid
   * @returns {Promise}
   */
  login() {
    return this.callApi({ action: 'users.login' }).then((res) => {
      if (res.code !== 0) throw new Error(res.message || '登录失败');
      const { token, userInfo: user } = res.data || {};
      if (!user) throw new Error('登录数据异常');

      wx.setStorageSync('userInfo', user);
      this.globalData.userInfo = user;
      this.globalData.isLogin = true;

      return user;
    });
  },

  /**
   * 更新全局位置并缓存
   */
  setLocation(location, locationName) {
    this.globalData.location = location;
    this.globalData.locationName = locationName || '';
    locationService.setCachedLocation(location, locationName);
  },

  /**
   * 调用云函数（底层方法）
   * @param {object} data - 传递给云函数的参数（必须包含 action 字段）
   * @returns {Promise}
   */
  callApi(data) {
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: 'api',
        data,
        success: (res) => {
          resolve(res.result);
        },
        fail: (err) => {
          console.error('[callApi fail]', data.action, err);
          reject(new Error('网络请求失败，请检查网络连接'));
        },
      });
    });
  },

  /**
   * 发起请求（兼容旧接口，内部自动转换为云函数调用）
   * 保留此方法以减少页面 JS 文件的改动量
   *
   * @param {object} opts - { url, method, data, timeout }
   * @returns {Promise} resolve(response data)
   */
  request(opts) {
    const method = (opts.method || 'GET').toUpperCase();
    const url = opts.url || '';

    // 文件上传：使用云存储
    if (url.indexOf('/upload/image') > -1) {
      return this._uploadImage(opts.data);
    }

    // URL → action 映射
    const mapped = mapUrlToAction(url, method);
    if (!mapped) {
      console.error('[request] 无法映射 URL:', url, method);
      return Promise.reject(new Error('未知接口: ' + url));
    }

    // 解析 URL 中的查询参数（如 /notifications?unreadOnly=1&pageSize=1）
    let queryParams = {};
    const qIdx = url.indexOf('?');
    if (qIdx > -1) {
      url.substring(qIdx + 1).split('&').forEach(function(pair) {
        const parts = pair.split('=');
        if (parts.length === 2) queryParams[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
      });
    }

    // 合并参数：URL 中解析出的 ID + 查询参数 + 请求 data
    const callData = { ...mapped, ...queryParams, ...(opts.data || {}) };

    return this.callApi(callData).then((result) => {
      // 401 处理
      if (result && result.code === 401) {
        const wasLogin = this.globalData.isLogin;
        this.globalData.userInfo = null;
        this.globalData.isLogin = false;
        wx.removeStorageSync('userInfo');
        if (wasLogin) {
          wx.showToast({ title: '登录已过期，请重新登录', icon: 'none', duration: 2000 });
        }
      }
      return result;
    });
  },

  /**
   * 图片上传到云存储
   */
  _uploadImage(data) {
    return new Promise((resolve, reject) => {
      if (!data || !data.filePath) {
        return reject(new Error('缺少文件路径'));
      }
      const cloudPath = 'uploads/' + Date.now() + '-' + Math.random().toString(36).substr(2, 8) + '.jpg';
      wx.cloud.uploadFile({
        cloudPath,
        filePath: data.filePath,
        success: (res) => {
          resolve({ code: 0, data: { fileID: res.fileID } });
        },
        fail: (err) => {
          console.error('[upload] fail:', err);
          reject(new Error('上传失败'));
        },
      });
    });
  },
};

App(appInstance);
