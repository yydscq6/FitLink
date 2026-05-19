// pages/editTeam/editTeam.js
const app = getApp();
const SPORT_TYPES = [
  { value: "basketball", name: "🏀 篮球" },
  { value: "football", name: "⚽ 足球" },
  { value: "badminton", name: "🏸 羽毛球" },
  { value: "running", name: "🏃 跑步" },
  { value: "tennis", name: "🎾 网球" },
  { value: "swimming", name: "🏊 游泳" },
  { value: "volleyball", name: "🏐 排球" },
  { value: "pingpong", name: "🏓 乒乓球" },
  { value: "hiking", name: "🥾 爬山" },
  { value: "cycling", name: "🚴 骑行" },
  { value: "fitness", name: "🏋️ 健身" },
  { value: "other", name: "🎯 其他" },
];
function buildDateOptions() {
  var dates = [];
  var now = new Date();
  for (var i = -1; i < 7; i++) {
    var d = new Date(now.getTime() + i * 86400000);
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    var wd = ["周日","周一","周二","周三","周四","周五","周六"][d.getDay()];
    var label = i === 0 ? "今天 " + m + "-" + day : i === -1 ? "昨天 " + m + "-" + day : wd + " " + m + "-" + day;
    dates.push({ label: label, value: d.getFullYear() + "-" + m + "-" + day });
  }
  return dates;
}
function buildTimeOptions() {
  var times = [];
  for (var h = 6; h <= 23; h++) for (var m = 0; m < 60; m += 30) {
    times.push(String(h).padStart(2,"0") + ":" + String(m).padStart(2,"0"));
  }
  return times;
}
var DATE_OPTIONS = buildDateOptions();
var TIME_OPTIONS = buildTimeOptions();
var ALL_TAGS = ['新手友好', '高手局', 'AA制', '免费', '长期约', '周末常约', '工作日约', '女性专场', '男性专场', '学生局', '养生局', '竞技局'];
function buildTagOptions(selectedTags) {
  return ALL_TAGS.map(function(tag) {
    return { value: tag, selected: selectedTags.indexOf(tag) > -1 };
  });
}
Page({
  _destroyed: false,
  _uploadTimer: null,
  data: {
    teamId: "",
    sportTypes: SPORT_TYPES.map(function(item){ return item.name; }),
    sportTypeIndex: 0,
    title: "",
    description: "",
    location: null,
    locationName: "",
    activityTime: "",
    timeArray: [DATE_OPTIONS.map(function(d){ return d.label; }), TIME_OPTIONS],
    timeIndex: [0, 16],
    maxMembers: "",
    fee: "",
    contact: "",
    originalMaxMembers: 0,
    currentMembers: 0,
    coverImageUrl: "",
    coverImagePreview: "",
    coverImageUploading: false,
    submitting: false,
    loading: true,
    tagOptions: buildTagOptions([]),
    selectedTags: [],
  },
  onLoad: function(options) {
    var self = this;
    if (!app.globalData.isLogin) {
      wx.showToast({ title: "请先登录", icon: "none" });
      setTimeout(function(){ wx.navigateBack(); }, 1500);
      return;
    }
    var teamData = null;
    if (options.teamData) {
      try { teamData = JSON.parse(decodeURIComponent(options.teamData)); }
      catch(e) { console.error("parse error:", e); }
    }
    if (!teamData || !teamData._id) {
      wx.showToast({ title: "参数错误", icon: "none" });
      setTimeout(function(){ wx.navigateBack(); }, 1500);
      return;
    }
    this._initForm(teamData);
  },
  onUnload: function() {
    this._destroyed = true;
    if (this._uploadTimer) { clearTimeout(this._uploadTimer); this._uploadTimer = null; }
  },
  _initForm: function(team) {
    var sportIdx = -1;
    for (var i = 0; i < SPORT_TYPES.length; i++) { if (SPORT_TYPES[i].value === team.sportType) { sportIdx = i; break; } }
    var sportTypeIndex = sportIdx >= 0 ? sportIdx : 0;
    var timeIndex = [0, 16];
    var activityTimeDisplay = "";
    if (team.startTime) {
      var raw = team.startTime.replace("T", " ").replace("Z", "");
      var dotIdx = raw.indexOf(".");
      if (dotIdx > -1) raw = raw.substring(0, dotIdx);
      raw = raw.replace(/-/g, "/");
      var startTime = new Date(raw);
      if (!isNaN(startTime.getTime())) {
        var y = startTime.getFullYear();
        var m = String(startTime.getMonth() + 1).padStart(2, "0");
        var d = String(startTime.getDate()).padStart(2, "0");
        var dateStr = y + "-" + m + "-" + d;
        var dateIdx = -1;
        for (var j = 0; j < DATE_OPTIONS.length; j++) { if (DATE_OPTIONS[j].value === dateStr) { dateIdx = j; break; } }
        var hh = String(startTime.getHours()).padStart(2, "0");
        var mm = String(startTime.getMinutes()).padStart(2, "0");
        var timeStr = hh + ":" + mm;
        var timeIdx = TIME_OPTIONS.indexOf(timeStr);
        timeIndex = [dateIdx >= 0 ? dateIdx : 0, timeIdx >= 0 ? timeIdx : 16];
        activityTimeDisplay = dateStr + " " + timeStr;
      }
    }
    var loc = team.location || {};
    var locationName = loc.name || team.venueName || "";
    this.setData({
      teamId: team._id,
      sportTypeIndex: sportTypeIndex,
      title: team.title || "",
      description: team.description || "",
      location: (loc.longitude && loc.latitude) ? { longitude: loc.longitude, latitude: loc.latitude } : null,
      locationName: locationName,
      activityTime: activityTimeDisplay,
      timeIndex: timeIndex,
      maxMembers: String(team.maxMembers || ""),
      fee: team.fee || "免费",
      contact: team.contact || "",
      originalMaxMembers: team.maxMembers || 0,
      currentMembers: team.currentMembers || 0,
      coverImageUrl: team.coverImage || "",
      coverImagePreview: team.coverImage || "",
      selectedTags: Array.isArray(team.tags) ? team.tags : [],
      tagOptions: buildTagOptions(Array.isArray(team.tags) ? team.tags : []),
      loading: false,
    });
  },
  onSportTypeChange: function(e) { this.setData({ sportTypeIndex: e.detail.value }); },
  onTitleInput: function(e) { this.setData({ title: e.detail.value }); },
  onDescInput: function(e) { this.setData({ description: e.detail.value }); },
  onToggleTag: function(e) {
    var tag = e.currentTarget.dataset.tag;
    var tags = this.data.selectedTags.slice();
    var idx = tags.indexOf(tag);
    if (idx > -1) { tags.splice(idx, 1); }
    else if (tags.length < 5) { tags.push(tag); }
    else { wx.showToast({ title: '最多选择5个标签', icon: 'none' }); return; }
    this.setData({ selectedTags: tags, tagOptions: buildTagOptions(tags) });
  },
  onChooseLocation: function() {
    var self = this;
    wx.chooseLocation({
      success: function(res) {
        if (res.latitude && res.longitude) {
          var location = { longitude: res.longitude, latitude: res.latitude };
          var locationName = res.name || res.address || '当前位置';
          self.setData({ location: location, locationName: locationName });
        }
      },
      fail: function(err) {
        if (err.errMsg && err.errMsg.indexOf('cancel') > -1) return;
        console.error('chooseLocation fail', err);
        wx.showToast({ title: '选择位置失败，请重试', icon: 'none' });
      },
    });
  },
  onTimeChange: function(e) {
    var idx = e.detail.value;
    var dateOpt = DATE_OPTIONS[idx[0]];
    var timeStr = TIME_OPTIONS[idx[1]];
    this.setData({ timeIndex: idx, activityTime: dateOpt.value + " " + timeStr });
  },
  onTimeColumnChange: function(e) {
    var column = e.detail.column;
    var value = e.detail.value;
    var timeIndex = this.data.timeIndex.slice();
    timeIndex[column] = value;
    this.setData({ timeIndex: timeIndex });
  },
  onMaxMembersInput: function(e) { this.setData({ maxMembers: e.detail.value }); },
  onFeeInput: function(e) { this.setData({ fee: e.detail.value }); },
  onContactInput: function(e) { this.setData({ contact: e.detail.value }); },
  onChooseCover: function() {
    if (this.data.coverImageUploading || this.data.coverImageUrl) return;
    var self = this;
    wx.chooseImage({
      count: 1, sizeType: ["compressed"], sourceType: ["album", "camera"],
      success: function(res) {
        try {
          var tempFilePath = res.tempFilePaths && res.tempFilePaths[0];
          if (!tempFilePath) { wx.showToast({ title: '未获取到图片', icon: 'none' }); return; }
          self.setData({ coverImagePreview: tempFilePath });
          self._uploadCover(tempFilePath);
        } catch (e) {
          console.error('[editTeam] chooseImage callback error:', e);
          wx.showToast({ title: '选择图片出错', icon: 'none' });
        }
      },
      fail: function(err) {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') > -1) return;
        wx.showToast({ title: '选择图片失败', icon: 'none' });
      },
    });
  },
  _uploadCover: function(filePath) {
    var self = this;
    if (!filePath) { wx.showToast({ title: '图片路径无效', icon: 'none' }); return; }
    self.setData({ coverImageUploading: true });
    var cloudPath = 'covers/' + Date.now() + '-' + Math.random().toString(36).substr(2, 8) + '.jpg';
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath,
      success: function(res) {
        if (self._destroyed) return;
        if (res.fileID) {
          self.setData({ coverImageUrl: res.fileID });
          wx.showToast({ title: '封面已添加', icon: 'success' });
        } else {
          wx.showToast({ title: '上传失败', icon: 'none' });
        }
      },
      fail: function(err) {
        if (self._destroyed) return;
        console.error('[editTeam] upload fail:', err);
        wx.showToast({ title: '上传失败', icon: 'none' });
      },
      complete: function() {
        if (!self._destroyed) { self.setData({ coverImageUploading: false }); }
      },
    });
  },
  onRemoveCover: function() { this.setData({ coverImageUrl: "", coverImagePreview: "" }); },
  onSubmit: function() {
    var title = this.data.title;
    var description = this.data.description;
    var location = this.data.location;
    var maxMembers = this.data.maxMembers;
    var submitting = this.data.submitting;
    var currentMembers = this.data.currentMembers;
    var originalMaxMembers = this.data.originalMaxMembers;
    var activityTime = this.data.activityTime;
    if (submitting) return;
    if (!title || !title.trim()) { wx.showToast({ title: "请输入标题", icon: "none" }); return; }
    if (title.trim().length > 50) { wx.showToast({ title: "标题不能超过50字", icon: "none" }); return; }
    if (description && description.length > 500) { wx.showToast({ title: "描述不能超过500字", icon: "none" }); return; }
    if (!location) { wx.showToast({ title: "请选择活动地点", icon: "none" }); return; }
    if (!activityTime) { wx.showToast({ title: "请选择活动时间", icon: "none" }); return; }
    if (!maxMembers || isNaN(parseInt(maxMembers)) || parseInt(maxMembers) < 2) { wx.showToast({ title: "人数上限至少为2人", icon: "none" }); return; }
    if (parseInt(maxMembers) > 100) { wx.showToast({ title: "人数上限不能超过100", icon: "none" }); return; }
    if (parseInt(maxMembers) < currentMembers) { wx.showToast({ title: "人数不能少于当前已加入的 " + currentMembers + " 人", icon: "none" }); return; }
    var self = this;
    var newMax = parseInt(maxMembers);
    if (newMax < originalMaxMembers) {
      wx.showModal({
        title: "减少人数",
        content: "人数上限将从 " + originalMaxMembers + " 人减少为 " + newMax + " 人，已有 " + currentMembers + " 人参加。确定继续吗？",
        confirmColor: "#0a9a5d",
        success: function(r) { if (r.confirm) self._doSubmit(); },
      });
      return;
    }
    this._doSubmit();
  },
  _doSubmit: function() {
    var self = this;
    this.setData({ submitting: true });
    var teamId = this.data.teamId;
    var sportType = SPORT_TYPES[this.data.sportTypeIndex].value;
    app.request({
      url: "/teams/" + teamId,
      method: "PUT",
      data: {
        sportType: sportType,
        title: this.data.title.trim(),
        description: (this.data.description || "").trim(),
        location: { name: this.data.locationName, address: this.data.locationName, longitude: this.data.location.longitude, latitude: this.data.location.latitude },
        activityTime: this.data.activityTime,
        maxMembers: parseInt(this.data.maxMembers),
        fee: this.data.fee || "免费",
        contact: (this.data.contact || "").trim(),
        coverImage: this.data.coverImageUrl || "",
        tags: this.data.selectedTags,
      },
    }).then(function(res) {
      if (res.code === 0) {
        wx.showToast({ title: "编辑成功", icon: "success" });
        setTimeout(function(){ wx.navigateBack(); }, 1200);
      } else if (res.code === 401) {
        wx.showToast({ title: "请先登录", icon: "none" });
      } else {
        wx.showToast({ title: res.message || "编辑失败", icon: "none" });
      }
    }).catch(function(err) {
      wx.showToast({ title: err.message || "网络错误", icon: "none" });
    }).finally(function() {
      self.setData({ submitting: false });
    });
  },
});