const api = require('../../utils/api')

Page({
  data: {
    meme: null,
    tagLikedMap: {},
    imageUrl: '',
    loadFailed: false
  },

  onLoad(options) {
    if (options.id) this.loadMeme(options.id)
  },

  onShow() {
    this.setData({ tagLikedMap: api.getTagLikedMap() })
  },

  async loadMeme(id) {
    wx.showLoading({ title: '加载中...' })
    try {
      const meme = await api.getMemeById(id)
      if (!meme) {
        wx.showToast({ title: '表情不存在', icon: 'none' })
        this.setData({ loadFailed: true })
        return
      }
      this.setData({ meme, loadFailed: false })

      if (meme.displayUrl) {
        this.setData({ imageUrl: meme.displayUrl })
      } else if (meme.url && meme.url.startsWith('cloud://')) {
        const res = await wx.cloud.getTempFileURL({ fileList: [meme.url] })
        if (res.fileList && res.fileList[0] && res.fileList[0].tempFileURL) {
          this.setData({ imageUrl: res.fileList[0].tempFileURL })
        }
      } else {
        this.setData({ imageUrl: meme.url })
      }
    } catch (e) {
      console.error('加载详情失败:', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  onPreviewImage() {
    const url = this.data.imageUrl
    if (url) wx.previewImage({ urls: [url], current: url })
  },

  async onTagLike(e) {
    const tag = e.currentTarget.dataset.tag
    const meme = this.data.meme
    if (!tag || !meme || !meme._id) return

    try {
      const res = await api.likeMemeTag(meme._id, tag)

      const tagLikes = { ...(meme.tagLikes || {}) }
      tagLikes[tag] = res.count
      meme.tagLikes = tagLikes

      const tagLikedMap = { ...this.data.tagLikedMap }
      const key = `${meme._id}_${tag}`
      if (res.isLiked) {
        tagLikedMap[key] = true
      } else {
        delete tagLikedMap[key]
      }

      this.setData({ meme, tagLikedMap })
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  }
})
