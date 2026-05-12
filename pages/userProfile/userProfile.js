// pages/userProfile/userProfile.js
var app = getApp();
var SPORT_EMOJI = { basketball: "🏀", badminton: "🏸", running: "🏃", football: "⚽", tennis: "🎾", swimming: "🏊", volleyball: "🏐", pingpong: "🏓", hiking: "🥾", cycling: "🚴", fitness: "🏋️", other: "🎯" };
var SPORT_NAME = { basketball: "篮球", badminton: "羽毛球", running: "跑步", football: "足球", tennis: "网球", swimming: "游泳", volleyball: "排球", pingpong: "乒乓球", hiking: "爬山", cycling: "骑行", fitness: "健身", other: "其他" };
var STATUS_NAME = { recruiting: "招募中", ongoing: "进行中", ended: "已结束", cancelled: "已取消" };
var ALL_PREFS = [
  { value: "basketball", emoji: "🏀", name: "篮球" },
  { value: "badminton", emoji: "🏸", name: "羽毛球" },
  { value: "running", emoji: "🏃", name: "跑步" },
  { value: "football", emoji: "⚽", name: "足球" },
  { value: "tennis", emoji: "🎾", name: "网球" },
  { value: "swimming", emoji: "🏊", name: "游泳" },
  { value: "volleyball", emoji: "🏐", name: "排球" },
  { value: "pingpong", emoji: "🏓", name: "乒乓球" },
  { value: "hiking", emoji: "🥾", name: "爬山" },
  { value: "cycling", emoji: "🚴", name: "骑行" },
  { value: "fitness", emoji: "🏋️", name: "健身" },
  { value: "other", emoji: "🎯", name: "其他" },
];

Page({
  data: {
    userId: "",
    userInfo: null,
    isLoading: true,
    loadError: "",
    sportPrefs: [],
    stats: { createdCount: 0, joinedCount: 0 },
    createdTeams: [],
    joinedTeams: [],
    activeTab: "created",
  },

  onLoad: function(options) {
    console.log('[userProfile] onLoad options:', JSON.stringify(options));
    if (options.id) {
      this.setData({ userId: options.id });
      this.fetchProfile(options.id);
    } else {
      this.setData({ isLoading: false, loadError: "参数错误" });
    }
  },

  onPullDownRefresh: function() {
    if (this.data.userId) this.fetchProfile(this.data.userId, true);
  },

  fetchProfile: function(uid, isRefresh) {
    var self = this;
    this.setData({ isLoading: !isRefresh, loadError: "" });
    var requestUrl = "/users/" + uid;
    console.log("[userProfile] fetchProfile uid:", uid, "url:", requestUrl);
    app.request({ url: requestUrl, method: "GET" })
      .then(function(res) {
        console.log("[userProfile] response:", JSON.stringify(res).substring(0, 300));
        if (!res) throw new Error("服务器无响应");
        if (res.code !== 0) throw new Error(res.message || "加载失败");
        var d = res.data;
        var prefs = [];
        if (d.sportPrefs) {
          var raw = d.sportPrefs;
          if (typeof raw === "string") { try { prefs = JSON.parse(raw); } catch(e){} }
          else if (Array.isArray(raw)) prefs = raw;
        }
        self.setData({
          userInfo: d,
          sportPrefs: prefs,
          stats: d.stats || { createdCount: 0, joinedCount: 0 },
          createdTeams: (d.createdTeams || []).map(function(t) {
            return {
              _id: t._id, sportType: t.sportType,
              sportEmoji: SPORT_EMOJI[t.sportType] || "🎯",
              sportName: SPORT_NAME[t.sportType] || "其他",
              title: t.title, venueName: t.venueName,
              startTime: t.startTime, maxMembers: t.maxMembers,
              currentMembers: t.currentMembers, status: t.status,
              statusName: STATUS_NAME[t.status] || t.status,
            };
          }),
          joinedTeams: (d.joinedTeams || []).map(function(t) {
            return {
              _id: t._id, sportType: t.sportType,
              sportEmoji: SPORT_EMOJI[t.sportType] || "🎯",
              sportName: SPORT_NAME[t.sportType] || "其他",
              title: t.title, venueName: t.venueName,
              startTime: t.startTime, maxMembers: t.maxMembers,
              currentMembers: t.currentMembers, status: t.status,
              statusName: STATUS_NAME[t.status] || t.status,
            };
          }),
          isLoading: false,
        });
        if (isRefresh) wx.stopPullDownRefresh();
      })
      .catch(function(err) {
        console.error("[userProfile] fetchProfile error:", err);
        var msg = err.message || "网络异常";
        // 提供更友好的错误提示
        if (msg.indexOf("timeout") > -1 || msg.indexOf("超时") > -1) {
          msg = "请求超时，请检查网络后重试";
        } else if (msg.indexOf("网络") > -1 || msg.indexOf("network") > -1) {
          msg = "网络连接失败，请检查网络";
        }
        self.setData({ loadError: msg, isLoading: false });
        if (isRefresh) wx.stopPullDownRefresh();
      });
  },

  onTabChange: function(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  goToTeam: function(e) {
    var id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: "/pages/teamDetail/teamDetail?id=" + id });
  },

  getCreditLevel: function(score) {
    if (!score && score !== 0) return "normal";
    if (score >= 150) return "excellent";
    if (score >= 120) return "good";
    if (score >= 80) return "normal";
    if (score >= 50) return "warning";
    return "poor";
  },

  onRetry: function() { if (this.data.userId) this.fetchProfile(this.data.userId); },
});