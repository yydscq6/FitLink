/**
 * 位置服务工具
 * 封装微信定位能力，提供：
 *   - 权限检查与引导
 *   - GPS 定位（wx.getLocation）
 *   - 反向地理编码（经纬度 → 地名）
 *   - 位置缓存与过期判断
 */

// 位置缓存有效期：10 分钟
const CACHE_TTL = 10 * 60 * 1000;
// 缓存 key
const CACHE_KEYS = {
  location: 'lastLocation',
  name: 'lastLocationName',
  timestamp: 'lastLocationTime',
};

/**
 * 读取缓存位置（未过期才返回）
 * @returns {{ longitude, latitude } | null}
 */
function getCachedLocation() {
  var ts = wx.getStorageSync(CACHE_KEYS.timestamp);
  if (!ts || Date.now() - ts > CACHE_TTL) return null;
  var loc = wx.getStorageSync(CACHE_KEYS.location);
  if (loc && loc.longitude && loc.latitude) return loc;
  return null;
}

/**
 * 读取缓存地名
 * @returns {string}
 */
function getCachedLocationName() {
  return wx.getStorageSync(CACHE_KEYS.name) || '';
}

/**
 * 写入位置缓存
 * @param {{ longitude, latitude }} location
 * @param {string} locationName
 */
function setCachedLocation(location, locationName) {
  wx.setStorageSync(CACHE_KEYS.location, location);
  wx.setStorageSync(CACHE_KEYS.name, locationName || '');
  wx.setStorageSync(CACHE_KEYS.timestamp, Date.now());
}

/**
 * 清除位置缓存
 */
function clearCachedLocation() {
  wx.removeStorageSync(CACHE_KEYS.location);
  wx.removeStorageSync(CACHE_KEYS.name);
  wx.removeStorageSync(CACHE_KEYS.timestamp);
}

/**
 * 获取 GPS 定位
 * 会先尝试 wx.getLocation(type: 'gcj02')，失败时降级到 type: 'wgs84'
 * @returns {Promise<{ longitude: number, latitude: number }>}
 */
function getGPSLocation() {
  return new Promise(function (resolve, reject) {
    // 优先用 gcj02 坐标（和腾讯地图一致）
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      highAccuracyExpireTime: 5000,
      success: function (res) {
        resolve({ longitude: res.longitude, latitude: res.latitude });
      },
      fail: function (err) {
        console.warn('[location] gcj02 定位失败，尝试 wgs84:', err.errMsg);
        // 降级到 wgs84（微信旧版兼容）
        wx.getLocation({
          type: 'wgs84',
          success: function (res2) {
            resolve({ longitude: res2.longitude, latitude: res2.latitude });
          },
          fail: function (err2) {
            reject(err2);
          },
        });
      },
    });
  });
}

/**
 * 反向地理编码：经纬度 → 地名
 * 使用云函数内部调用腾讯地图 API，不需要前端 Key
 *
 * @param {number} lat  纬度
 * @param {number} lng  经度
 * @returns {Promise<string>} 地名
 */
function reverseGeocode(lat, lng) {
  return new Promise(function (resolve, reject) {
    wx.cloud.callFunction({
      name: 'api',
      data: {
        action: 'map.geocoder',
        latitude: lat,
        longitude: lng,
      },
      success: function (res) {
        var result = res.result || {};
        if (result.code === 0 && result.address) {
          resolve(result.address);
        } else {
          resolve('');
        }
      },
      fail: function (err) {
        console.warn('[location] 反向地理编码失败:', err);
        resolve(''); // 失败不阻断流程
      },
    });
  });
}

/**
 * 检查定位权限
 * @returns {Promise<boolean>} 是否有权限
 */
function checkLocationPermission() {
  return new Promise(function (resolve) {
    wx.getSetting({
      success: function (res) {
        // 已授权或从未询问过（首次）
        if (res.authSetting['scope.userLocation'] !== false) {
          resolve(true);
        } else {
          // 用户拒绝过，引导去设置页
          wx.showModal({
            title: '需要定位权限',
            content: '请在系统设置中允许小程序获取位置信息，以便为您推荐附近的运动组局。',
            confirmText: '去设置',
            confirmColor: '#0a9a5d',
            success: function (modalRes) {
              if (modalRes.confirm) {
                wx.openSetting({
                  success: function (settingRes) {
                    resolve(!!settingRes.authSetting['scope.userLocation']);
                  },
                  fail: function () {
                    resolve(false);
                  },
                });
              } else {
                resolve(false);
              }
            },
          });
        }
      },
      fail: function () {
        resolve(true); // 获取失败时仍然尝试定位
      },
    });
  });
}

/**
 * 完整的定位流程：检查权限 → GPS 定位 → 反向地理编码
 *
 * @param {object} [options]
 * @param {boolean} [options.useCache=true]  是否使用缓存
 * @param {boolean} [options.showToast=true] 是否显示提示
 * @returns {Promise<{ location: { longitude, latitude }, locationName: string }>}
 */
function getCurrentLocation(options) {
  var opts = options || {};
  var useCache = opts.useCache !== false;

  // 1. 尝试缓存
  if (useCache) {
    var cached = getCachedLocation();
    if (cached) {
      return Promise.resolve({
        location: cached,
        locationName: getCachedLocationName(),
        fromCache: true,
      });
    }
  }

  // 2. 检查权限
  return checkLocationPermission().then(function (hasPermission) {
    if (!hasPermission) {
      return Promise.reject({ errMsg: 'getLocation:fail auth deny', noPermission: true });
    }

    // 3. GPS 定位
    return getGPSLocation().then(function (location) {
      // 4. 反向地理编码（并行发起，不阻塞返回）
      var namePromise = reverseGeocode(location.latitude, location.longitude);

      return namePromise.then(function (locationName) {
        var name = locationName || '当前位置';
        setCachedLocation(location, name);
        return {
          location: location,
          locationName: name,
          fromCache: false,
        };
      });
    });
  });
}

/**
 * 选择位置（微信内置地图选点）
 * @returns {Promise<{ location: { longitude, latitude }, locationName: string }>}
 */
function chooseLocation() {
  return new Promise(function (resolve, reject) {
    wx.chooseLocation({
      success: function (res) {
        if (res.latitude && res.longitude) {
          var location = { longitude: res.longitude, latitude: res.latitude };
          var locationName = res.name || res.address || '当前位置';
          setCachedLocation(location, locationName);
          resolve({ location: location, locationName: locationName });
        } else {
          reject({ errMsg: 'chooseLocation:fail no data' });
        }
      },
      fail: function (err) {
        reject(err);
      },
    });
  });
}

module.exports = {
  getCachedLocation: getCachedLocation,
  getCachedLocationName: getCachedLocationName,
  setCachedLocation: setCachedLocation,
  clearCachedLocation: clearCachedLocation,
  getGPSLocation: getGPSLocation,
  reverseGeocode: reverseGeocode,
  checkLocationPermission: checkLocationPermission,
  getCurrentLocation: getCurrentLocation,
  chooseLocation: chooseLocation,
};
