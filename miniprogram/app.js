App({
  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({
        title: '版本过低',
        content: '请升级微信后重试',
        showCancel: false
      })
      this.finishLaunch()
      return
    }

    wx.cloud.init({ traceUser: true })
    this.finishLaunch()
  },

  finishLaunch() {
    this.globalData.ready = true
    this._readyResolvers.splice(0).forEach(resolve => resolve())
  },

  whenReady() {
    if (this.globalData.ready) return Promise.resolve()
    return new Promise(resolve => this._readyResolvers.push(resolve))
  },

  _readyResolvers: [],

  globalData: {
    ready: false
  }
})
