// pages/teamDetail/teamDetail.js
const app = getApp();

// 运动类型 emoji & 中文映射
const SPORT_EMOJI = {
  basketball: '🏀', badminton: '🏸', running: '🏃',
  football: '⚽', tennis: '🎾', swimming: '🏊',
  volleyball: '🏐', pingpong: '🏓', hiking: '🥾',
  cycling: '🚴', fitness: '🏋️', other: '🏐',
};
const SPORT_NAME = {
  basketball: '篮球', badminton: '羽毛球', running: '跑步',
  football: '足球', tennis: '网球', swimming: '游泳',
  volleyball: '排球', pingpong: '乒乓球', hiking: '爬山',
  cycling: '骑行', fitness: '健身', other: '其他',
};
const STATUS_NAME = {
  recruiting: '招募中', ongoing: '进行中',
  ended: '已结束', cancelled: '已取消',
};

Page({
  data: {
    teamId: '',
    team: null,
    isLoading: true,
    loadError: '',
    isJoining: false,
    // 评论
    comments: [],
    commentText: '',
    isSendingComment: false,
    isLoadingComments: false,
    replyTo: 0,         // 回复目标评论 ID
    replyToName: '',    // 回复目标昵称
    // 海报
    showPoster: false,
    posterImage: '',
    isGeneratingPoster: false,
    // 收藏
    isFavorited: false,
  },

  onLoad(options) {
    let teamId = '';

    // 优先从 id 参数获取（正常跳转）
    if (options.id) {
      teamId = options.id;
    }
    // 扫描小程序码进入时，scene 参数需要解码
    else if (options.scene) {
      try {
        teamId = decodeURIComponent(options.scene);
      } catch (e) {
        teamId = options.scene;
      }
    }

    if (teamId) {
      this.setData({ teamId });
      this.fetchDetail(teamId);
    } else {
      this.setData({ isLoading: false, loadError: '参数错误' });
    }

    // 上一次已知状态（用于检测变化）
    this._lastStatus = '';
  },

  onShow() {
    // 从编辑页面返回时刷新详情
    if (this.data.teamId && this.data.team) {
      this.fetchDetail(this.data.teamId, true);
    }
    // 开启状态轮询（每 30 秒检查一次队伍状态）
    this._startStatusPolling();
  },

  onHide() {
    this._stopStatusPolling();
  },

  onUnload() {
    this._stopStatusPolling();
  },

  /**
   * 开启队伍状态轮询
   * 仅对招募中的队伍生效，每 30 秒静默检查一次
   */
  _startStatusPolling() {
    this._stopStatusPolling(); // 先清除旧的
    if (!this.data.teamId) return;
    // 只有招募中的队伍才需要轮询
    if (this.data.team && this.data.team.status !== 'recruiting') return;

    this._pollTimer = setInterval(() => {
      if (!this.data.teamId) return;
      app.request({
        url: `/teams/${this.data.teamId}`,
        method: 'GET',
      }).then((res) => {
        if (res.code !== 0 || !res.data) return;
        const newStatus = res.data.status;
        const oldStatus = this._lastStatus || this.data.team?.status;

        if (newStatus !== oldStatus) {
          this._lastStatus = newStatus;
          // 状态变化！刷新详情 + 提示用户
          this.fetchDetail(this.data.teamId, true);
          if (newStatus === 'ended') {
            wx.showToast({ title: '🎉 组局已满员！', icon: 'success', duration: 3000 });
          } else if (newStatus === 'cancelled') {
            wx.showToast({ title: '组局已被取消', icon: 'none', duration: 3000 });
          }
        } else {
          // 状态没变，但人数可能变了，静默更新数据
          this.setData({
            'team.currentMembers': res.data.currentMembers,
            'team.maxMembers': res.data.maxMembers,
          });
        }
      }).catch(() => {});
    }, 30000); // 30 秒间隔
  },

  /**
   * 停止轮询
   */
  _stopStatusPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  onPullDownRefresh() {
    if (this.data.teamId) {
      this.fetchDetail(this.data.teamId, true);
    }
  },

  onShareAppMessage() {
    const team = this.data.team;
    return {
      title: team ? `${team.sportType ? team.sportType : ''}组局：${team.title}` : '运动组局',
      path: `/pages/teamDetail/teamDetail?id=${this.data.teamId}`,
    };
  },

  /**
   * 加载组局详情
   */
  fetchDetail(id, isRefresh = false) {
    this.setData({ isLoading: !isRefresh, loadError: '' });

    app.request({
      url: `/teams/${id}`,
      method: 'GET',
    }).then((res) => {
      const { code, data, message } = res;
      if (code !== 0) throw new Error(message || '加载失败');

      console.log('[fetchDetail] tags:', data.tags, 'type:', typeof data.tags);
      this.setData({
        team: data,
        isFavorited: data.isFavorited || false,
        isLoading: false,
      });
      this._lastStatus = data.status; // 同步状态基线，供轮询检测变化
      // 如果队伍已结束/已取消，停止轮询
      if (data.status !== 'recruiting') {
        this._stopStatusPolling();
      }
      this.fetchComments();
      if (isRefresh) wx.stopPullDownRefresh();
    }).catch((err) => {
      this.setData({
        loadError: err.message || '网络异常',
        isLoading: false,
      });
      if (isRefresh) wx.stopPullDownRefresh();
    });
  },

  /**
   * 加入组局（带确认弹窗）
   */
  onJoin() {
    if (!app.globalData.isLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    if (this.data.isJoining) return;

    const team = this.data.team;
    const sportEmoji = SPORT_EMOJI[team.sportType] || '🏐';
    const sportName = SPORT_NAME[team.sportType] || '运动';
    const confirmContent = `即将加入「${sportEmoji} ${sportName}」组局，确定吗？`;

    wx.showModal({
      title: '加入组局',
      content: confirmContent,
      confirmText: '确定加入',
      confirmColor: '#0a9a5d',
      success: (res) => {
        if (!res.confirm) return;
        this._doJoin();
      },
    });
  },

  /**
   * 执行加入请求（支持时间冲突确认）
   * @param {boolean} forceJoin - 是否强制加入（跳过冲突检查）
   */
  _doJoin(forceJoin) {
    this.setData({ isJoining: true });
    app.request({
      url: `/teams/${this.data.teamId}/join`,
      method: 'POST',
      data: forceJoin ? { forceJoin: true } : {},
    }).then((res) => {
      if (res.code === 0) {
        wx.showToast({ title: '加入成功 🎉', icon: 'success' });
        this.fetchDetail(this.data.teamId, true);
        // 请求订阅消息权限（加入成功后引导用户开启提醒）
        this._requestSubscribe();
      } else if (res.code === -2) {
        // 时间冲突：弹窗让用户确认
        wx.showModal({
          title: '⏰ 时间冲突',
          content: res.message,
          confirmText: '确定加入',
          confirmColor: '#0a9a5d',
          success: (modalRes) => {
            if (modalRes.confirm) {
              this._doJoin(true); // 用户确认，强制加入
            }
          },
        });
      } else {
        wx.showToast({ title: res.message || '加入失败', icon: 'none' });
      }
    }).catch((err) => {
      wx.showToast({ title: err.message || '网络错误', icon: 'none' });
    }).finally(() => {
      this.setData({ isJoining: false });
    });
  },

  /**
   * 退出组局（带确认弹窗）
   */
  onQuit() {
    const team = this.data.team;
    const sportEmoji = SPORT_EMOJI[team.sportType] || '🏐';
    wx.showModal({
      title: '退出组局',
      content: `退出后你的名额将被释放，其他小伙伴可以加入。确定退出「${sportEmoji} ${team.title}」吗？`,
      confirmText: '确定退出',
      confirmColor: '#e74c3c',
      success: (res) => {
        if (!res.confirm) return;
        app.request({
          url: `/teams/${this.data.teamId}/quit`,
          method: 'POST',
        }).then((res) => {
          if (res.code === 0) {
            wx.showToast({ title: '已退出组局', icon: 'success' });
            this.fetchDetail(this.data.teamId, true);
          } else {
            wx.showToast({ title: res.message || '操作失败', icon: 'none' });
          }
        }).catch((err) => {
          wx.showToast({ title: err.message || '网络错误', icon: 'none' });
        });
      },
    });
  },

  /**
   * 拨打电话
   */
  onCall() {
    const contact = this.data.team?.contact;
    if (!contact) return;
    // 如果是手机号直接拨打
    if (/^1\d{10}$/.test(contact)) {
      wx.makePhoneCall({ phoneNumber: contact });
    } else {
      wx.setClipboardData({
        data: contact,
        success: () => wx.showToast({ title: '已复制联系方式', icon: 'success' }),
      });
    }
  },

  /**
   * 查看地图
   */
  onOpenMap() {
    const team = this.data.team;
    if (!team?.location?.latitude) return;
    wx.openLocation({
      latitude: team.location.latitude,
      longitude: team.location.longitude,
      name: team.location.name || team.venueName || '',
      address: team.location.address || team.location.name || '',
      scale: 15,
    });
  },

  // =============================================
  // 队长管理
  // =============================================

  /**
   * 取消组局
   */
  onCancelTeam() {
    wx.showModal({
      title: '取消组局',
      content: '取消后所有队员将收到通知，组局不可恢复。确定取消吗？',
      confirmText: '确定取消',
      confirmColor: '#e74c3c',
      success: (res) => {
        if (!res.confirm) return;
        app.request({
          url: `/teams/${this.data.teamId}/cancel`,
          method: 'POST',
        }).then((res) => {
          if (res.code === 0) {
            wx.showToast({ title: '组局已取消', icon: 'success' });
            this.fetchDetail(this.data.teamId, true);
          } else {
            wx.showToast({ title: res.message || '操作失败', icon: 'none' });
          }
        }).catch((err) => {
          wx.showToast({ title: err.message || '网络错误', icon: 'none' });
        });
      },
    });
  },

  /**
   * 结束组局（提前结束招募）
   */
  onEndTeam() {
    const team = this.data.team;
    wx.showModal({
      title: '结束招募',
      content: `当前已有 ${team.currentMembers}/${team.maxMembers} 人参加。确定结束招募吗？结束后不再接受新成员。`,
      confirmText: '结束招募',
      confirmColor: '#0a9a5d',
      success: (res) => {
        if (!res.confirm) return;
        app.request({
          url: `/teams/${this.data.teamId}/end`,
          method: 'POST',
        }).then((res) => {
          if (res.code === 0) {
            wx.showToast({ title: '已结束招募', icon: 'success' });
            this.fetchDetail(this.data.teamId, true);
          } else {
            wx.showToast({ title: res.message || '操作失败', icon: 'none' });
          }
        }).catch((err) => {
          wx.showToast({ title: err.message || '网络错误', icon: 'none' });
        });
      },
    });
  },

  /**
   * 查看用户主页
   */
  onGoToUser(e) {
    const userId = e.currentTarget.dataset.userid;
    console.log('[onGoToUser] userId:', userId, 'type:', typeof userId, 'dataset:', JSON.stringify(e.currentTarget.dataset));
    if (!userId) {
      console.warn('[onGoToUser] userId is falsy, skip');
      return;
    }
    // 不跳转自己（类型安全：dataset 返回 string，globalData.id 可能是 number）
    const currentUserId = app.globalData.userInfo ? app.globalData.userInfo.id : null;
    if (currentUserId && String(currentUserId) === String(userId)) {
      console.log('[onGoToUser] is self, skip');
      return;
    }
    wx.navigateTo({
      url: '/pages/userProfile/userProfile?id=' + userId,
      fail: (err) => {
        console.error('[onGoToUser] navigateTo fail:', err);
        wx.showToast({ title: '页面跳转失败', icon: 'none' });
      },
    });
  },

  /**
   * 编辑组局（队长）
   */
  onEditTeam() {
    const team = this.data.team;
    if (!team) return;
    // 只传递编辑页面需要的字段，避免 URL 过长
    const editData = {
      _id: team._id,
      sportType: team.sportType,
      title: team.title,
      description: team.description,
      location: team.location,
      venueName: team.venueName,
      startTime: team.startTime,
      maxMembers: team.maxMembers,
      currentMembers: team.currentMembers,
      fee: team.fee,
      contact: team.contact,
      coverImage: team.coverImage || '',
      tags: Array.isArray(team.tags) ? team.tags : [],
    };
    wx.navigateTo({
      url: '/pages/editTeam/editTeam?teamData=' + encodeURIComponent(JSON.stringify(editData)),
    });
  },

  /**
   * 收藏/取消收藏
   */
  onToggleFavorite() {
    if (!app.globalData.isLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    app.request({
      url: `/teams/${this.data.teamId}/favorite`,
      method: 'POST',
    }).then((res) => {
      if (res.code === 0) {
        this.setData({ isFavorited: res.data.favorited });
        wx.showToast({ title: res.data.favorited ? '已收藏' : '已取消收藏', icon: 'success' });
      }
    }).catch(() => {});
  },

  // =============================================
  // 举报
  // =============================================

  onReport() {
    if (!app.globalData.isLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    const reasons = [
      { text: '垃圾广告', value: 'spam' },
      { text: '不当内容', value: 'inappropriate' },
      { text: '欺诈诈骗', value: 'fraud' },
      { text: '暴力血腥', value: 'violence' },
      { text: '其他原因', value: 'other' },
    ];
    wx.showActionSheet({
      itemList: reasons.map(r => r.text),
      success: (res) => {
        const selected = reasons[res.tapIndex];
        wx.showModal({
          title: '举报原因：' + selected.text,
          editable: true,
          placeholderText: '补充说明（可选）',
          success: (modalRes) => {
            if (!modalRes.confirm) return;
            app.request({
              url: '/reports',
              method: 'POST',
              data: {
                targetType: 'team',
                targetId: this.data.teamId,
                reason: selected.value,
                description: modalRes.content || '',
              },
            }).then((r) => {
              wx.showToast({ title: r.message || '举报已提交', icon: r.code === 0 ? 'success' : 'none' });
            }).catch(() => {
              wx.showToast({ title: '举报失败', icon: 'none' });
            });
          },
        });
      },
    });
  },

  /**
   * 请求微信订阅消息权限（加入组局成功后调用）
   */
  _requestSubscribe() {
    // 请求订阅消息权限（加入成功后引导用户开启提醒）
    wx.requestSubscribeMessage({
      tmplIds: [
        'XlbAjAHqhp4pq2RVFVXRJ_29tfPWMAmTRtJG2nQ4hi4', // 组局成功
        'zfuwiRlb-YOSpAHqM79maZJafwPS5andsheaqqnDPQQ', // 组局取消
        'Q5wJpHL0g4rR6bA6hoKqViX1bbXqdis550aMyZtcbS8', // 组局结束
      ],
      success(res) { console.log('[subscribe] result:', res); },
      fail(err) { console.log('[subscribe] fail:', err); },
    });
  },

  /**
   * 重试
   */
  onRetry() {
    if (this.data.teamId) {
      this.fetchDetail(this.data.teamId);
    }
  },

  /**
   * 返回首页
   */
  onGoHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  // =============================================
  // 评论功能
  // =============================================

  /**
   * 加载评论列表
   */
  fetchComments() {
    if (!this.data.teamId) return;
    this.setData({ isLoadingComments: true });
    app.request({
      url: '/comments/' + this.data.teamId,
      method: 'GET',
      data: { pageSize: 100 },
    }).then((res) => {
      if (res.code === 0) {
        this.setData({
          comments: res.data?.list || [],
          isLoadingComments: false,
        });
      } else {
        this.setData({ isLoadingComments: false });
      }
    }).catch(() => {
      this.setData({ isLoadingComments: false });
    });
  },

  /**
   * 评论输入
   */
  onCommentInput(e) {
    this.setData({ commentText: e.detail.value });
  },

  /**
   * 发送评论/回复
   */
  onSendComment() {
    const content = this.data.commentText;
    if (!content || !content.trim()) {
      wx.showToast({ title: '请输入评论内容', icon: 'none' });
      return;
    }
    if (content.trim().length > 500) {
      wx.showToast({ title: '评论不能超过500字', icon: 'none' });
      return;
    }
    if (this.data.isSendingComment) return;

    this.setData({ isSendingComment: true });
    const postData = { content: content.trim() };
    if (this.data.replyTo) {
      postData.parentId = this.data.replyTo;
    }

    app.request({
      url: '/comments/' + this.data.teamId,
      method: 'POST',
      data: postData,
    }).then((res) => {
      if (res.code === 0) {
        this.setData({
          commentText: '',
          replyTo: 0,
          replyToName: '',
          isSendingComment: false,
        });
        // 重新加载评论列表
        this.fetchComments();
        wx.pageScrollTo({ scrollTop: 99999, duration: 300 });
      } else {
        wx.showToast({ title: res.message || '评论失败', icon: 'none' });
        this.setData({ isSendingComment: false });
      }
    }).catch((err) => {
      wx.showToast({ title: err.message || '网络错误', icon: 'none' });
      this.setData({ isSendingComment: false });
    });
  },

  /**
   * 回复评论
   */
  onReplyComment(e) {
    const commentId = e.currentTarget.dataset.id;
    const nickname = e.currentTarget.dataset.name;
    this.setData({ replyTo: commentId, replyToName: nickname });
    // 聚焦输入框
    // wx.createSelectorQuery().select('.comment-input').node().exec(); // 可选
  },

  /**
   * 取消回复
   */
  onCancelReply() {
    this.setData({ replyTo: 0, replyToName: '' });
  },

  /**
   * 点赞/取消点赞评论
   */
  onLikeComment(e) {
    if (!app.globalData.isLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    const commentId = e.currentTarget.dataset.id;
    const isLiked = e.currentTarget.dataset.liked;

    const method = isLiked ? 'DELETE' : 'POST';
    app.request({
      url: '/comments/' + commentId + '/like',
      method: method,
    }).then((res) => {
      if (res.code === 0) {
        // 更新本地评论数据
        const { likeCount, isLiked: newLiked } = res.data;
        this._updateCommentLike(commentId, likeCount, newLiked);
      } else {
        wx.showToast({ title: res.message || '操作失败', icon: 'none' });
      }
    }).catch(() => {
      wx.showToast({ title: '网络错误', icon: 'none' });
    });
  },

  /**
   * 更新本地评论点赞状态
   */
  _updateCommentLike(commentId, likeCount, isLiked) {
    const comments = this.data.comments.map(c => {
      if (c._id === commentId) {
        return { ...c, likeCount, isLiked };
      }
      if (c.replies && c.replies.length > 0) {
        return {
          ...c,
          replies: c.replies.map(r => r._id === commentId ? { ...r, likeCount, isLiked } : r),
        };
      }
      return c;
    });
    this.setData({ comments });
  },

  // =============================================
  // 分享海报
  // =============================================

  /**
   * 生成海报按钮点击
   */
  onGeneratePoster() {
    this.setData({ showPoster: true, posterImage: '', isGeneratingPoster: true });
    // 先下载小程序码，再绘制海报
    this._downloadQRCode().then((qrImagePath) => {
      this._qrImagePath = qrImagePath;
      setTimeout(() => {
        this._drawPoster();
      }, 100);
    });
  },

  /**
   * 下载组局小程序码（云开发版本，自动缓存）
   * @returns {Promise<string|null>} 临时文件路径，null 表示不可用
   */
  _downloadQRCode() {
    return new Promise((resolve) => {
      app.callApi({
        action: 'teams.qrcode',
        teamId: this.data.teamId,
      }).then((res) => {
        if (res.code === 0 && res.data && res.data.fileID) {
          // 从云存储下载临时文件
          wx.cloud.downloadFile({
            fileID: res.data.fileID,
            success: (dlRes) => {
              resolve(dlRes.tempFilePath);
            },
            fail: () => {
              console.warn('[QRCode] 云存储下载失败');
              resolve(null);
            },
          });
        } else {
          // 后端返回错误，打印提示（海报会用占位图替代）
          if (res.message && res.message !== 'qrcode_unavailable') {
            console.warn('[QRCode] 生成失败:', res.message);
          }
          resolve(null);
        }
      }).catch(() => resolve(null));
    });
  },

  /**
   * 关闭海报弹窗
   */
  onClosePoster() {
    this.setData({ showPoster: false, posterImage: '' });
  },

  /**
   * 保存海报到相册
   */
  onSavePoster() {
    if (!this.data.posterImage) {
      wx.showToast({ title: '海报尚未生成', icon: 'none' });
      return;
    }
    wx.saveImageToPhotosAlbum({
      filePath: this.data.posterImage,
      success: () => {
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.includes('deny')) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中开启相册保存权限',
            confirmText: '去设置',
            success: (r) => { if (r.confirm) wx.openSetting(); },
          });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      },
    });
  },

  /**
   * Canvas 绘制海报
   */
  _drawPoster() {
    const team = this.data.team;
    if (!team) return;

    const query = wx.createSelectorQuery();
    query.select('#posterCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          // 降级：使用旧版 Canvas 2D API
          this._drawPosterLegacy();
          return;
        }
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getWindowInfo().pixelRatio;
        const W = 600;
        const H = 900;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.scale(dpr, dpr);

        this._renderPosterContent(ctx, W, H, canvas);
      });
  },

  /**
   * 旧版 Canvas 兼容（Canvas 2D node 不可用时降级）
   */
  _drawPosterLegacy() {
    const ctx = wx.createCanvasContext('posterCanvas', this);
    const W = 600;
    const H = 900;
    this._renderPosterLegacy(ctx, W, H);
  },

  /**
   * 渲染海报内容（新版 Canvas 2D）
   */
  _renderPosterContent(ctx, W, H, canvas) {
    const team = this.data.team;
    const sportType = team.sportType || 'other';
    const sportEmoji = SPORT_EMOJI[sportType] || '🏐';
    const sportName = SPORT_NAME[sportType] || '运动';

    // 背景
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // 顶部绿色渐变条
    const gradient = ctx.createLinearGradient(0, 0, W, 0);
    gradient.addColorStop(0, '#0a9a5d');
    gradient.addColorStop(1, '#0bc77a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, 180);

    // 标题文字（白色）
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🏃 运动组局', W / 2, 70);

    ctx.font = '24px sans-serif';
    ctx.fillText('一起运动，遇见更好的自己', W / 2, 115);

    // 运动类型大 emoji
    ctx.font = '72px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(sportEmoji, W / 2, 260);

    // 运动类型名
    ctx.fillStyle = '#0a9a5d';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(sportName, W / 2, 300);

    // 组局标题
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 32px sans-serif';
    const title = team.title || '运动组局';
    const maxTitleLen = 14;
    const displayTitle = title.length > maxTitleLen ? title.substring(0, maxTitleLen) + '...' : title;
    ctx.fillText(displayTitle, W / 2, 365);

    // 分割线
    ctx.strokeStyle = '#e8eaed';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60, 395);
    ctx.lineTo(W - 60, 395);
    ctx.stroke();

    // 信息行
    const infoItems = [];
    infoItems.push({ icon: '📍', label: team.location?.name || team.venueName || '待定' });
    infoItems.push({ icon: '🕐', label: this._formatDateShort(team.startTime) });
    infoItems.push({ icon: '👥', label: `${team.currentMembers || 0}/${team.maxMembers}人` });
    if (team.fee) {
      infoItems.push({ icon: '💰', label: team.fee });
    }

    let infoY = 440;
    ctx.textAlign = 'left';
    ctx.font = '26px sans-serif';
    infoItems.forEach((item) => {
      ctx.fillStyle = '#999999';
      ctx.fillText(item.icon, 80, infoY);
      ctx.fillStyle = '#333333';
      const maxLabelLen = 18;
      const label = item.label.length > maxLabelLen ? item.label.substring(0, maxLabelLen) + '...' : item.label;
      ctx.fillText(label, 120, infoY);
      infoY += 50;
    });

    // 队长信息
    const leader = team.leaderId;
    if (leader) {
      ctx.fillStyle = '#999999';
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('👤 发起人：' + (leader.nickname || ''), 80, infoY + 20);
    }

    // 小程序码区域
    const qrSize = 140;
    const qrX = (W - qrSize) / 2;
    const qrY = H - 280;

    // 小程序码背景框
    ctx.fillStyle = '#f8f9fa';
    ctx.strokeStyle = '#e8eaed';
    ctx.lineWidth = 1;
    const boxPad = 12;
    const boxX = qrX - boxPad;
    const boxY = qrY - boxPad;
    const boxW = qrSize + boxPad * 2;
    const boxH = qrSize + boxPad * 2 + 40;
    // 绘制圆角矩形（兼容写法）
    const r = 12;
    ctx.beginPath();
    ctx.moveTo(boxX + r, boxY);
    ctx.lineTo(boxX + boxW - r, boxY);
    ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + r, r);
    ctx.lineTo(boxX + boxW, boxY + boxH - r);
    ctx.arcTo(boxX + boxW, boxY + boxH, boxX + boxW - r, boxY + boxH, r);
    ctx.lineTo(boxX + r, boxY + boxH);
    ctx.arcTo(boxX, boxY + boxH, boxX, boxY + boxH - r, r);
    ctx.lineTo(boxX, boxY + r);
    ctx.arcTo(boxX, boxY, boxX + r, boxY, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 尝试绘制小程序码
    const drawFooter = () => {
      // 底部渐变条
      ctx.fillStyle = gradient;
      ctx.fillRect(0, H - 100, W, 100);

      // 底部提示文字
      ctx.fillStyle = '#ffffff';
      ctx.font = '22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('长按识别小程序码，加入组局', W / 2, H - 55);
      ctx.font = '18px sans-serif';
      ctx.fillText('运动组局 · 让运动更有趣', W / 2, H - 28);

      // 导出为图片
      setTimeout(() => {
        wx.canvasToTempFilePath({
          canvas: canvas,
          x: 0, y: 0,
          width: W, height: H,
          destWidth: W * 2, destHeight: H * 2,
          success: (res) => {
            this.setData({ posterImage: res.tempFilePath, isGeneratingPoster: false });
          },
          fail: (err) => {
            console.error('canvasToTempFilePath fail', err);
            this.setData({ isGeneratingPoster: false });
            wx.showToast({ title: '海报生成失败', icon: 'none' });
          },
        });
      }, 200);
    };

    if (this._qrImagePath && canvas.createImage) {
      // 有小程序码图片，绘制到海报
      const img = canvas.createImage();
      img.onload = () => {
        ctx.drawImage(img, qrX, qrY, qrSize, qrSize);
        // 小程序码下方提示
        ctx.fillStyle = '#666666';
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('扫码加入组局', W / 2, qrY + qrSize + 28);
        drawFooter();
      };
      img.onerror = () => {
        // 图片加载失败，绘制占位
        this._drawQRPlaceholder(ctx, qrX, qrY, qrSize, W);
        drawFooter();
      };
      img.src = this._qrImagePath;
    } else {
      // 无小程序码，绘制占位
      this._drawQRPlaceholder(ctx, qrX, qrY, qrSize, W);
      drawFooter();
    }
  },

  /**
   * 绘制小程序码占位图案
   */
  _drawQRPlaceholder(ctx, x, y, size, W) {
    // 占位方块（模拟二维码外观）
    ctx.fillStyle = '#e8eaed';
    ctx.fillRect(x, y, size, size);

    // 三个定位方块
    const s = size / 7;
    ctx.fillStyle = '#333333';
    // 左上
    ctx.fillRect(x + s * 0.5, y + s * 0.5, s * 2, s * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + s * 1, y + s * 1, s, s);
    ctx.fillStyle = '#333333';
    // 右上
    ctx.fillRect(x + s * 4.5, y + s * 0.5, s * 2, s * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + s * 5, y + s * 1, s, s);
    ctx.fillStyle = '#333333';
    // 左下
    ctx.fillRect(x + s * 0.5, y + s * 4.5, s * 2, s * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + s * 1, y + s * 5, s, s);
    ctx.fillStyle = '#333333';
    // 中间随机点
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if ((r + c) % 2 === 0) {
          ctx.fillRect(x + s * (1.5 + c * 0.8), y + s * (1.5 + r * 0.8), s * 0.6, s * 0.6);
        }
      }
    }

    // 中心小图标
    ctx.fillStyle = '#0a9a5d';
    ctx.font = '28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏃', x + size / 2, y + size / 2);
    ctx.textBaseline = 'alphabetic';

    // 提示文字
    ctx.fillStyle = '#999999';
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('小程序码待配置', W / 2, y + size + 28);
  },

  /**
   * 旧版 Canvas 渲染（兼容）
   */
  _renderPosterLegacy(ctx, W, H) {
    const team = this.data.team;
    const sportType = team.sportType || 'other';
    const sportEmoji = SPORT_EMOJI[sportType] || '🏐';
    const sportName = SPORT_NAME[sportType] || '运动';

    // 背景
    ctx.setFillStyle('#ffffff');
    ctx.fillRect(0, 0, W, H);

    // 顶部渐变
    ctx.setFillStyle('#0a9a5d');
    ctx.fillRect(0, 0, W, 180);

    ctx.setFillStyle('#ffffff');
    ctx.setFontSize(36);
    ctx.setTextAlign('center');
    ctx.fillText('🏃 运动组局', W / 2, 70);
    ctx.setFontSize(24);
    ctx.fillText('一起运动，遇见更好的自己', W / 2, 115);

    // 运动 emoji
    ctx.setFontSize(72);
    ctx.fillText(sportEmoji, W / 2, 260);

    ctx.setFillStyle('#0a9a5d');
    ctx.setFontSize(28);
    ctx.fillText(sportName, W / 2, 300);

    // 标题
    ctx.setFillStyle('#1a1a1a');
    ctx.setFontSize(32);
    const title = team.title || '运动组局';
    const maxTitleLen = 14;
    const displayTitle = title.length > maxTitleLen ? title.substring(0, maxTitleLen) + '...' : title;
    ctx.fillText(displayTitle, W / 2, 365);

    // 分割线
    ctx.setStrokeStyle('#e8eaed');
    ctx.setLineWidth(1);
    ctx.beginPath();
    ctx.moveTo(60, 395);
    ctx.lineTo(W - 60, 395);
    ctx.stroke();

    // 信息
    const infoItems = [
      { icon: '📍', label: team.location?.name || team.venueName || '待定' },
      { icon: '🕐', label: this._formatDateShort(team.startTime) },
      { icon: '👥', label: `${team.currentMembers || 0}/${team.maxMembers}人` },
    ];
    if (team.fee) infoItems.push({ icon: '💰', label: team.fee });

    let infoY = 440;
    ctx.setTextAlign('left');
    ctx.setFontSize(26);
    infoItems.forEach((item) => {
      ctx.setFillStyle('#999999');
      ctx.fillText(item.icon, 80, infoY);
      ctx.setFillStyle('#333333');
      const maxLabelLen = 18;
      const label = item.label.length > maxLabelLen ? item.label.substring(0, maxLabelLen) + '...' : item.label;
      ctx.fillText(label, 120, infoY);
      infoY += 50;
    });

    if (team.leaderId) {
      ctx.setFillStyle('#999999');
      ctx.setFontSize(24);
      ctx.fillText('👤 发起人：' + (team.leaderId.nickname || ''), 80, infoY + 20);
    }

    // 小程序码占位
    const qrSize = 140;
    const qrX = (W - qrSize) / 2;
    const qrY = H - 280;
    ctx.setFillStyle('#f0f1f3');
    ctx.fillRect(qrX, qrY, qrSize, qrSize);
    ctx.setFillStyle('#999999');
    ctx.setFontSize(20);
    ctx.setTextAlign('center');
    ctx.fillText('小程序码', W / 2, qrY + qrSize / 2);
    ctx.fillText('扫码加入组局', W / 2, qrY + qrSize + 28);

    // 底部
    ctx.setFillStyle('#0a9a5d');
    ctx.fillRect(0, H - 100, W, 100);
    ctx.setFillStyle('#ffffff');
    ctx.setFontSize(22);
    ctx.setTextAlign('center');
    ctx.fillText('长按识别小程序码，加入组局', W / 2, H - 55);
    ctx.setFontSize(18);
    ctx.fillText('运动组局 · 让运动更有趣', W / 2, H - 28);

    ctx.draw(false, () => {
      setTimeout(() => {
        wx.canvasToTempFilePath({
          canvasId: 'posterCanvas',
          x: 0, y: 0,
          width: W, height: H,
          destWidth: 1200, destHeight: 1800,
          success: (res) => {
            this.setData({
              posterImage: res.tempFilePath,
              isGeneratingPoster: false,
            });
          },
          fail: () => {
            this.setData({ isGeneratingPoster: false });
            wx.showToast({ title: '海报生成失败', icon: 'none' });
          },
        }, this);
      }, 200);
    });
  },

  /**
   * 格式化日期（简短版，用于海报）
   */
  _formatDateShort(dateStr) {
    if (!dateStr) return '待定';
    try {
      // 兼容 ISO 格式
      const s = dateStr.replace('T', ' ').replace('Z', '').replace(/\.\d+/, '');
      const d = new Date(s.replace(/-/g, '/'));
      if (isNaN(d.getTime())) return dateStr;
      const month = d.getMonth() + 1;
      const day = d.getDate();
      const hour = d.getHours().toString().padStart(2, '0');
      const min = d.getMinutes().toString().padStart(2, '0');
      return `${month}月${day}日 ${hour}:${min}`;
    } catch (e) {
      return dateStr;
    }
  },
});
