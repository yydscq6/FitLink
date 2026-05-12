/**
 * 安全工具 — 限流、XSS 过滤、敏感词 + 微信内容安全 API
 */
const rateLimit = require('express-rate-limit');
const xss = require('xss');
const axios = require('axios');
const logger = require('./logger');
const { getAccessToken } = require('./wechatMessage');

// ============== 接口限流 ==============

/** 通用限流：60 次/分钟 */
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { code: -1, message: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** 登录限流：10 次/分钟 */
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { code: -1, message: '登录请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** 写操作限流：30 次/分钟 */
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { code: -1, message: '操作过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============== XSS 过滤 ==============

const xssOptions = {
  whiteList: {},        // 不允许任何 HTML 标签
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style'],
};

/**
 * 过滤单个字符串
 */
function sanitize(str) {
  if (typeof str !== 'string') return str;
  return xss(str.trim(), xssOptions);
}

/**
 * 递归过滤对象中所有字符串字段
 */
function sanitizeBody(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'string') {
      result[key] = sanitize(obj[key]);
    } else if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
      result[key] = sanitizeBody(obj[key]);
    } else if (Array.isArray(obj[key])) {
      result[key] = obj[key].map(item =>
        typeof item === 'string' ? sanitize(item) : item
      );
    } else {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Express 中间件：自动消毒 req.body 中的字符串
 */
function sanitizeMiddleware(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeBody(req.body);
  }
  next();
}

// ============== 敏感词过滤 ==============

// 基础敏感词库（实际项目应从文件/数据库加载，这里列出常见类别）
const SENSITIVE_WORDS = [
  // 政治敏感
  '习近平', '毛泽东', '六四', '天安门', '法轮功', '台独', '藏独', '疆独',
  // 暴力色情
  '色情', '裸体', '性交', '嫖娼', '赌博', '博彩', '赌场', '彩票预测',
  // 广告诈骗
  '代开发票', '办证', '贷款', '刷单', '兼职日赚', '免费领', '点击就送',
  // 侮辱性词汇
  '傻逼', '操你', '狗日', '王八蛋', '贱人', '婊子',
  // 违禁品
  '冰毒', '大麻', '海洛因', '摇头丸', 'K粉',
];

/**
 * 检测文本是否包含敏感词
 * @returns {{ pass: boolean, word?: string }}
 */
function checkSensitive(text) {
  if (!text || typeof text !== 'string') return { pass: true };
  const lower = text.toLowerCase();
  for (const word of SENSITIVE_WORDS) {
    if (lower.indexOf(word.toLowerCase()) > -1) {
      return { pass: false, word };
    }
  }
  return { pass: true };
}

/**
 * 调用微信内容安全 API（msg_sec_check）
 * 文档：https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/sec-check/security.msgSecCheck.html
 * @param {string} content - 要检测的文本
 * @returns {{ pass: boolean, errcode?: number }}
 */
async function checkTextWithWeChat(content) {
  // 未配置 WX_APPID 时跳过微信检测，仅用本地词库
  const token = await getAccessToken();
  if (!token) {
    logger.warn('[内容安全] 未配置 WX_APPID，跳过微信安全检测');
    return { pass: true };
  }
  try {
    const res = await axios.post(
      'https://api.weixin.qq.com/wxa/msg_sec_check?access_token=' + token,
      { content, version: 2, scene: 2 },
      { timeout: 5000 }
    );
    // errcode=0 通过，87014 为含违规内容
    if (res.data.errcode === 0) return { pass: true };
    if (res.data.errcode === 87014) return { pass: false, errcode: 87014 };
    // 其他错误码（如频率限制），降级为通过
    logger.warn('[内容安全] 微信 API 异常: ' + JSON.stringify(res.data));
    return { pass: true };
  } catch (err) {
    logger.warn('[内容安全] 微信 API 调用失败: ' + err.message);
    return { pass: true };
  }
}

/**
 * 增强版敏感词检测：先本地词库，再微信云端
 * @param {string} text - 待检测文本
 * @param {boolean} useWeChat - 是否调用微信 API（默认 true，测试可关闭）
 * @returns {Promise<{ pass: boolean, word?: string, source?: string }>}
 */
async function checkSensitiveEnhanced(text, useWeChat = true) {
  // 第一步：本地快速检测
  const local = checkSensitive(text);
  if (!local.pass) return { ...local, source: 'local' };

  // 第二步：微信内容安全 API（仅当配置了 WX_APPID 且 useWeChat=true 时）
  if (useWeChat && process.env.WX_APPID) {
    const wx = await checkTextWithWeChat(text);
    if (!wx.pass) return { pass: false, word: '微信安全检测不通过', source: 'wechat' };
  }

  return { pass: true };
}

/**
 * 用 * 替换敏感词
 */
function filterSensitive(text) {
  if (!text || typeof text !== 'string') return text;
  let result = text;
  for (const word of SENSITIVE_WORDS) {
    const idx = result.toLowerCase().indexOf(word.toLowerCase());
    if (idx > -1) {
      const stars = '*'.repeat(word.length);
      result = result.substring(0, idx) + stars + result.substring(idx + word.length);
    }
  }
  return result;
}

module.exports = {
  generalLimiter,
  loginLimiter,
  writeLimiter,
  sanitize,
  sanitizeBody,
  sanitizeMiddleware,
  checkSensitive,
  checkTextWithWeChat,
  checkSensitiveEnhanced,
  filterSensitive,
};
