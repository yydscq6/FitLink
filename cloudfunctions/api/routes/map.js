/**
 * 地图相关服务（云函数内调用腾讯地图 API）
 *
 * 需要在云函数环境变量中配置：
 *   QQ_MAP_KEY = 你的腾讯地图 WebServiceAPI Key
 *
 * 设置方式：微信公众平台 → 云开发 → 设置 → 环境变量
 */

const https = require('https');

// 从环境变量读取 Key
const QQ_MAP_KEY = process.env.QQ_MAP_KEY || '';

/**
 * 发起 HTTPS GET 请求
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('JSON 解析失败'));
        }
      });
    }).on('error', reject).on('timeout', function () {
      this.destroy();
      reject(new Error('请求超时'));
    });
  });
}

/**
 * 反向地理编码：经纬度 → 地址
 * event.latitude, event.longitude
 */
async function geocoder(event) {
  if (!QQ_MAP_KEY) {
    return { code: -1, message: '地图服务未配置（缺少 QQ_MAP_KEY）' };
  }

  const lat = event.latitude;
  const lng = event.longitude;

  if (!lat || !lng) {
    return { code: -1, message: '缺少经纬度参数' };
  }

  const url = `https://apis.map.qq.com/ws/geocoder/v1/?location=${lat},${lng}&key=${QQ_MAP_KEY}&get_poi=0`;

  try {
    const resp = await httpsGet(url);
    if (resp.status === 0 && resp.result) {
      const addr = resp.result;
      // 优先返回地标名，其次格式化地址
      const address = addr.formatted_addresses
        ? (addr.formatted_addresses.recommend || addr.formatted_addresses.standard_address || '')
        : (addr.address || '');
      return { code: 0, address: address };
    }
    return { code: -1, message: resp.message || '地理编码失败' };
  } catch (err) {
    console.error('[map.geocoder] 请求失败:', err.message);
    return { code: -1, message: '地图服务暂时不可用' };
  }
}

/**
 * 地点搜索
 * event.keyword, event.latitude, event.longitude
 */
async function search(event) {
  if (!QQ_MAP_KEY) {
    return { code: -1, message: '地图服务未配置' };
  }

  const keyword = event.keyword;
  if (!keyword) {
    return { code: -1, message: '缺少搜索关键词' };
  }

  let url = `https://apis.map.qq.com/ws/place/v1/suggestion/?keyword=${encodeURIComponent(keyword)}&key=${QQ_MAP_KEY}&page_size=10`;
  if (event.latitude && event.longitude) {
    url += `&location=${event.latitude},${event.longitude}`;
  }

  try {
    const resp = await httpsGet(url);
    if (resp.status === 0 && resp.data) {
      return {
        code: 0,
        data: resp.data.map((item) => ({
          id: item.id,
          title: item.title,
          address: item.address,
          location: item.location,
          province: item.province,
          city: item.city,
          district: item.district,
        })),
      };
    }
    return { code: -1, message: resp.message || '搜索失败' };
  } catch (err) {
    console.error('[map.search] 请求失败:', err.message);
    return { code: -1, message: '地图服务暂时不可用' };
  }
}

module.exports = {
  geocoder,
  search,
};
