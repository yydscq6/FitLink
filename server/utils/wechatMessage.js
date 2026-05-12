/**
 * 微信订阅消息工具
 * 需要配置环境变量：WX_APPID, WX_SECRET, WX_TEMPLATE_REMINDER, WX_TEMPLATE_STATUS
 * 未配置时静默跳过，不影响应用正常运行
 */
const axios = require("axios");
const logger = require("./logger");

const WX_APPID = process.env.WX_APPID;
const WX_SECRET = process.env.WX_SECRET;

// 订阅消息模板 ID（在微信后台配置后填入 .env）
const TPL_REMINDER = process.env.WX_TEMPLATE_REMINDER || "";    // 活动提醒模板
const TPL_STATUS   = process.env.WX_TEMPLATE_STATUS   || "";    // 状态变更模板

// access_token 缓存
let tokenCache = { token: "", expiresAt: 0 };

/**
 * 获取微信 access_token（带缓存）
 */
async function getAccessToken() {
  if (!WX_APPID || !WX_SECRET) return null;
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 60000) {
    return tokenCache.token;
  }
  try {
    const res = await axios.get("https://api.weixin.qq.com/cgi-bin/token", {
      params: { grant_type: "client_credential", appid: WX_APPID, secret: WX_SECRET },
      timeout: 10000,
    });
    if (res.data.access_token) {
      tokenCache = { token: res.data.access_token, expiresAt: now + (res.data.expires_in - 300) * 1000 };
      return tokenCache.token;
    }
    logger.error("获取 access_token 失败: " + JSON.stringify(res.data));
    return null;
  } catch (err) {
    logger.error("获取 access_token 异常: " + err.message);
    return null;
  }
}

/**
 * 发送订阅消息
 * @param {string} openid - 用户 openid
 * @param {string} templateId - 模板 ID
 * @param {object} data - 模板数据
 * @param {string} page - 跳转小程序页面路径
 */
async function sendSubscribeMessage(openid, templateId, data, page) {
  if (!openid || !templateId) return false;
  const token = await getAccessToken();
  if (!token) {
    logger.warn("订阅消息跳过：未配置 WX_APPID 或获取 token 失败");
    return false;
  }
  try {
    const res = await axios.post(
      "https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=" + token,
      { touser: openid, template_id: templateId, page: page || "", data: data },
      { timeout: 10000 }
    );
    if (res.data.errcode === 0) {
      logger.info("订阅消息发送成功: openid=" + openid);
      return true;
    }
    // 43101 = 用户拒绝订阅，静默处理
    if (res.data.errcode !== 43101) {
      logger.warn("订阅消息发送失败: " + JSON.stringify(res.data));
    }
    return false;
  } catch (err) {
    logger.error("订阅消息异常: " + err.message);
    return false;
  }
}

/**
 * 发送活动提醒（活动开始前 1 小时）
 */
async function sendActivityReminder(openid, teamTitle, startTime, venueName, teamId) {
  if (!TPL_REMINDER) return false;
  const data = {
    thing1: { value: teamTitle },           // 组局标题
    time2: { value: startTime },             // 活动时间
    thing3: { value: venueName || "待定" },  // 活动地点
  };
  return sendSubscribeMessage(openid, TPL_REMINDER, data, "/pages/teamDetail/teamDetail?id=" + teamId);
}

/**
 * 发送状态变更通知
 */
async function sendStatusChange(openid, teamTitle, statusText, teamId) {
  if (!TPL_STATUS) return false;
  const data = {
    thing1: { value: teamTitle },           // 组局标题
    thing2: { value: statusText },           // 变更内容
  };
  return sendSubscribeMessage(openid, TPL_STATUS, data, "/pages/teamDetail/teamDetail?id=" + teamId);
}

/**
 * 获取小程序码（getUnlimited）
 * @param {string} scene - 场景值（最长32字符）
 * @param {string} page - 小程序页面路径（不带前导 /）
 * @returns {Buffer|null} 图片 Buffer 或 null
 */
async function getMiniProgramQRCode(scene, page) {
  const token = await getAccessToken();
  if (!token) {
    logger.warn('小程序码跳过：未配置 WX_APPID 或获取 token 失败');
    return null;
  }
  try {
    const res = await axios.post(
      'https://api.weixin.qq.com/wxa/getwxacodeunlimited?access_token=' + token,
      { scene: scene.substring(0, 32), page: page, width: 280, is_hyaline: true },
      { responseType: 'arraybuffer', timeout: 15000 }
    );
    // 成功返回图片 Buffer，失败返回 JSON
    const contentType = res.headers['content-type'] || '';
    if (contentType.includes('image')) {
      return Buffer.from(res.data);
    }
    // 返回了 JSON 说明失败
    const errInfo = JSON.parse(Buffer.from(res.data).toString());
    logger.error('获取小程序码失败: ' + JSON.stringify(errInfo));
    return null;
  } catch (err) {
    logger.error('获取小程序码异常: ' + err.message);
    return null;
  }
}

module.exports = { sendSubscribeMessage, sendActivityReminder, sendStatusChange, getAccessToken, getMiniProgramQRCode };