// pages/publish/publish.js
const app = getApp();
const locationService = require('../../utils/location');

const SPORT_TYPES = [
  { value: 'basketball', name: '🏀 篮球' },
  { value: 'football', name: '⚽ 足球' },
  { value: 'badminton', name: '🏸 羽毛球' },
  { value: 'running', name: '🏃 跑步' },
  { value: 'tennis', name: '🎾 网球' },
  { value: 'swimming', name: '🏊 游泳' },
  { value: 'volleyball', name: '🏐 排球' },
  { value: 'pingpong', name: '🏓 乒乓球' },
  { value: 'hiking', name: '🥾 爬山' },
  { value: 'cycling', name: '🚴 骑行' },
  { value: 'fitness', name: '🏋️ 健身' },
  { value: 'other', name: '🎯 其他' },
];

/**
 * 生成未来 7 天日期选项
 */
function buildDateOptions() {
  const dates = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const weekDay = ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
    const label = i === 0 ? `今天 ${m}-${day}` : `${weekDay} ${m}-${day}`;
    dates.push({ label, value: `${d.getFullYear()}-${m}-${day}` });
  }
  return dates;
}

/**
 * 生成时间选项（6:00 ~ 23:30，间隔30分钟）
 */
function buildTimeOptions() {
  const times = [];
  for (let h = 6; h <= 23; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      times.push(`${hh}:${mm}`);
    }
  }
  return times;
}

const DATE_OPTIONS = buildDateOptions();
const TIME_OPTIONS = buildTimeOptions();

const ALL_TAGS = ['新手友好', '高手局', 'AA制', '免费', '长期约', '周末常约', '工作日约', '女性专场', '男性专场', '学生局', '养生局', '竞技局'];

/**
 * 生成标签选项（带选中状态）
 */
function buildTagOptions(selectedTags) {
  return ALL_TAGS.map(function(tag) {
    return { value: tag, selected: selectedTags.indexOf(tag) > -1 };
  });
}

Page({
  data: {
    sportTypes: SPORT_TYPES.map(item => item.name),
    sportTypeIndex: 0,
    title: '',
    description: '',
    location: null,
    locationName: '',
    activityTime: '',
    // 时间选择器
    timeArray: [DATE_OPTIONS.map(d => d.label), TIME_OPTIONS],
    timeIndex: [0, 16], // 默认：今天 14:00
    maxMembers: '',
    fee: '免费',
    contact: '',
    coverImageUrl: '',       // 服务器相对路径（提交用）
    coverImagePreview: '',   // 本地临时路径（预览用）
    coverImageUploading: false,
    isUploadingCover: false,
    submitting: false,
    // 标签
    tagOptions: buildTagOptions([]),
    selectedTags: [],
  },

  // 页面是否已卸载（防止异步回调在页面销毁后执行）
  _destroyed: false,
  _loginTimer: null,
  _uploadTimer: null,

  onLoad() {
    if (!app.globalData.isLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      this._loginTimer = setTimeout(() => {
        if (!this._destroyed) {
          wx.switchTab({ url: '/pages/index/index' });
        }
      }, 1500);
    }
  },

  onUnload() {
    this._destroyed = true;
    if (this._loginTimer) { clearTimeout(this._loginTimer); this._loginTimer = null; }
    if (this._uploadTimer) { clearTimeout(this._uploadTimer); this._uploadTimer = null; }
  },

  onSportTypeChange(e) {
    this.setData({ sportTypeIndex: e.detail.value });
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
  },

  onDescInput(e) {
    this.setData({ description: e.detail.value });
  },

  onToggleTag(e) {
    var tag = e.currentTarget.dataset.tag;
    var tags = this.data.selectedTags.slice();
    var idx = tags.indexOf(tag);
    if (idx > -1) {
      tags.splice(idx, 1);
    } else if (tags.length < 5) {
      tags.push(tag);
    } else {
      wx.showToast({ title: '最多选择5个标签', icon: 'none' });
      return;
    }
    this.setData({ selectedTags: tags, tagOptions: buildTagOptions(tags) });
  },

  onChooseLocation() {
    locationService.chooseLocation()
      .then((result) => {
        this.setData({
          location: result.location,
          locationName: result.locationName,
        });
      })
      .catch((err) => {
        if (err.errMsg && err.errMsg.indexOf('cancel') > -1) return;
        console.error('chooseLocation fail', err);
        wx.showToast({ title: '选择位置失败，请重试', icon: 'none' });
      });
  },

  onTimeChange(e) {
    const idx = e.detail.value; // [dateIndex, timeIndex]
    const dateOpt = DATE_OPTIONS[idx[0]];
    const timeStr = TIME_OPTIONS[idx[1]];
    this.setData({
      timeIndex: idx,
      activityTime: `${dateOpt.value} ${timeStr}`,
    });
  },

  onTimeColumnChange(e) {
    // 多列联动时实时更新选中索引
    const { column, value } = e.detail;
    const timeIndex = [...this.data.timeIndex];
    timeIndex[column] = value;
    this.setData({ timeIndex });
  },

  onMaxMembersInput(e) {
    this.setData({ maxMembers: e.detail.value });
  },

  onFeeInput(e) {
    this.setData({ fee: e.detail.value });
  },

  onContactInput(e) {
    this.setData({ contact: e.detail.value });
  },

  /**
   * 选择封面图
   */
  onChooseCover() {
    if (this.data.coverImageUploading) return;
    if (this.data.coverImageUrl) return;
    var self = this;
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: function(res) {
        try {
          var tempFilePath = res.tempFilePaths && res.tempFilePaths[0];
          if (!tempFilePath) {
            wx.showToast({ title: '未获取到图片', icon: 'none' });
            return;
          }
          // 立即用本地路径预览（真机上 HTTP URL 无法显示）
          self.setData({ coverImagePreview: tempFilePath });
          self._uploadCover(tempFilePath);
        } catch (e) {
          console.error('[publish] chooseImage callback error:', e);
          wx.showToast({ title: '选择图片出错', icon: 'none' });
        }
      },
      fail: function(err) {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') > -1) return;
        wx.showToast({ title: '选择图片失败', icon: 'none' });
      },
    });
  },

  /**
   * 上传封面图到云存储
   */
  _uploadCover(filePath) {
    var self = this;
    if (!filePath) {
      wx.showToast({ title: '图片路径无效', icon: 'none' });
      return;
    }

    self.setData({ coverImageUploading: true, isUploadingCover: true });

    var finished = false;
    var finish = function() {
      if (finished) return;
      finished = true;
      if (self._uploadTimer) { clearTimeout(self._uploadTimer); self._uploadTimer = null; }
      if (!self._destroyed) {
        self.setData({ coverImageUploading: false, isUploadingCover: false });
      }
    };

    var cloudPath = 'covers/' + Date.now() + '-' + Math.random().toString(36).substr(2, 8) + '.jpg';

    var uploadTask = wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath,
      success: function(res) {
        if (self._destroyed) { finish(); return; }
        if (res.fileID) {
          self.setData({ coverImageUrl: res.fileID });
          wx.showToast({ title: '封面已添加', icon: 'success' });
        } else {
          wx.showToast({ title: '上传失败', icon: 'none' });
        }
      },
      fail: function(err) {
        if (self._destroyed) { finish(); return; }
        console.error('[publish] upload fail:', err);
        wx.showToast({ title: '上传失败，请检查网络', icon: 'none' });
      },
      complete: function() {
        finish();
      },
    });

    // 30 秒超时保底（真机网络差时 complete 可能不触发）
    self._uploadTimer = setTimeout(function() {
      if (!finished) {
        console.warn('[publish] upload timeout, aborting');
        try { uploadTask.abort(); } catch(e) {}
        finish();
        if (!self._destroyed) {
          wx.showToast({ title: '上传超时，请重试', icon: 'none' });
        }
      }
    }, 30000);
  },

  /**
   * 删除封面图
   */
  onRemoveCover() {
    this.setData({ coverImageUrl: '', coverImagePreview: '' });
  },

  onSubmit(forceCreate) {
    const { sportTypeIndex, title, description, location, locationName, activityTime, maxMembers, fee, contact, submitting } = this.data;

    // 防重复提交
    if (submitting) return;

    // 输入校验
    if (!title || !title.trim()) {
      wx.showToast({ title: '请输入标题', icon: 'none' });
      return;
    }
    if (title.trim().length > 50) {
      wx.showToast({ title: '标题不能超过50字', icon: 'none' });
      return;
    }
    if (description && description.length > 500) {
      wx.showToast({ title: '描述不能超过500字', icon: 'none' });
      return;
    }
    if (!location) {
      wx.showToast({ title: '请选择活动地点', icon: 'none' });
      return;
    }
    if (!activityTime) {
      wx.showToast({ title: '请选择活动时间', icon: 'none' });
      return;
    }
    if (!maxMembers || isNaN(parseInt(maxMembers)) || parseInt(maxMembers) < 2) {
      wx.showToast({ title: '人数上限至少为2人', icon: 'none' });
      return;
    }
    if (parseInt(maxMembers) > 100) {
      wx.showToast({ title: '人数上限不能超过100', icon: 'none' });
      return;
    }
    if (contact && contact.length > 50) {
      wx.showToast({ title: '联系方式不能超过50字', icon: 'none' });
      return;
    }

    const sportType = SPORT_TYPES[sportTypeIndex].value;

    this.setData({ submitting: true });

    const postData = {
      sportType,
      title: title.trim(),
      description: (description || '').trim(),
      location: {
        name: locationName,
        address: locationName,
        longitude: location.longitude,
        latitude: location.latitude,
      },
      activityTime: activityTime,
      maxMembers: parseInt(maxMembers),
      fee: fee || '免费',
      contact: (contact || '').trim(),
      coverImage: this.data.coverImageUrl || '',
      tags: this.data.selectedTags,
    };
    if (forceCreate) postData.forceCreate = true;

    app.request({
      url: '/teams',
      method: 'POST',
      data: postData,
    }).then((res) => {
      if (res.code === 0) {
        // 发布成功后，更新全局位置为发布地点，确保首页能查到
        if (this.data.location) {
          app.setLocation(this.data.location, this.data.locationName || '');
        }
        wx.showToast({ title: '发布成功', icon: 'success' });
        setTimeout(() => {
          wx.switchTab({ url: '/pages/index/index' });
        }, 1500);
      } else if (res.code === -2) {
        // 重复组局：弹窗让用户确认
        wx.showModal({
          title: '📋 检测到相似组局',
          content: res.message,
          confirmText: '仍然创建',
          confirmColor: '#0a9a5d',
          success: (modalRes) => {
            if (modalRes.confirm) {
              this.onSubmit(true); // 用户确认，强制创建
            }
          },
        });
      } else if (res.code === 401) {
        // token 失效，跳回首页触发登录
        wx.showToast({ title: '请先登录', icon: 'none' });
        setTimeout(() => {
          wx.switchTab({ url: '/pages/index/index' });
        }, 1500);
      } else {
        wx.showToast({ title: res.message || '发布失败', icon: 'none' });
      }
    }).catch((err) => {
      wx.showToast({ title: err.message || '网络错误', icon: 'none' });
    }).finally(() => {
      this.setData({ submitting: false });
    });
  },
});
