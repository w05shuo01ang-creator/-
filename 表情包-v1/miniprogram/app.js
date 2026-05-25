App({
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请升级基础库到 2.2.3 以上')
      return
    }
    wx.cloud.init({
      traceUser: true
    })
    this.ensureUid()
    this.globalData.cloudReady = true
  },

  ensureUid() {
    let uid = wx.getStorageSync('_local_uid')
    if (!uid) {
      uid = 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
      wx.setStorageSync('_local_uid', uid)
    }
    this.globalData.uid = uid
  },

  getUid() {
    return this.globalData.uid
  },

  globalData: {
    openid: '',
    userInfo: null,
    cloudReady: false,
    uid: ''
  }
})
