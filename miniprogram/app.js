const api = require('./utils/api')

App({
  async onLaunch() {
    if (!wx.cloud) {
      wx.showModal({
        title: '版本过低',
        content: '请升级微信后重试',
        showCancel: false
      })
      return
    }

    wx.cloud.init({ traceUser: true })

    try {
      this.globalData.session = await api.bootstrap()
    } catch (error) {
      console.error('初始化失败', error)
    } finally {
      this.globalData.ready = true
      this._readyResolvers.splice(0).forEach(resolve => resolve())
    }
  },

  whenReady() {
    if (this.globalData.ready) return Promise.resolve()
    return new Promise(resolve => this._readyResolvers.push(resolve))
  },

  _readyResolvers: [],

  globalData: {
    ready: false,
    session: null
  }
})

