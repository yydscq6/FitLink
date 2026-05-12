const express = require('express');
const axios = require('axios');
const router = express.Router();

const QQ_MAP_KEY = process.env.QQ_MAP_KEY;
const GEOCODER_URL = 'https://apis.map.qq.com/ws/geocoder/v1/';

// Key 未配置时拦截
router.use((req, res, next) => {
  if (!QQ_MAP_KEY) {
    console.error('[地图代理] QQ_MAP_KEY 未配置');
    return res.json({ status: 1, message: '地图服务未配置' });
  }
  next();
});

/**
 * 反向地理编码：经纬度 → 地址
 * GET /api/map/geocoder?location=39.9042,116.4074
 */
router.get('/geocoder', async (req, res) => {
  try {
    const { location } = req.query;
    if (!location || !/^-?\d+\.?\d*,-?\d+\.?\d*$/.test(location)) {
      return res.json({ status: 1, message: 'location 参数格式错误，应为 lat,lng' });
    }

    const resp = await axios.get(GEOCODER_URL, {
      params: {
        location,
        key: QQ_MAP_KEY,
        get_poi: 0,
      },
      timeout: 5000,
    });

    res.json(resp.data);
  } catch (err) {
    console.error('[地图代理] 反向地理编码失败:', err.message);
    res.json({ status: 1, message: '地图服务暂时不可用' });
  }
});

/**
 * 地点搜索
 * GET /api/map/search?keyword=篮球馆&region=北京
 */
router.get('/search', async (req, res) => {
  try {
    const { keyword, region } = req.query;
    if (!keyword) {
      return res.json({ status: 1, message: '缺少 keyword 参数' });
    }

    const resp = await axios.get('https://apis.map.qq.com/ws/place/v1/suggestion/', {
      params: {
        keyword,
        region: region || '',
        key: QQ_MAP_KEY,
        page_size: 10,
      },
      timeout: 5000,
    });

    res.json(resp.data);
  } catch (err) {
    console.error('[地图代理] 地点搜索失败:', err.message);
    res.json({ status: 1, message: '地图服务暂时不可用' });
  }
});

module.exports = router;
