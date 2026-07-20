const api = require('../../utils/api')
const { messageOf } = require('../../utils/view')

Page({
  data: {
    id: '',
    loading: true,
    item: null,
    liked: false,
    tagItems: []
  },

  onLoad(options) {
    if (!options.id) {
      wx.showToast({ title: '缺少表情编号', icon: 'none' })
      return
    }
    this.setData({ id: options.id })
    this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const data = await api.getDetail(this.data.id)
      const likedTags = new Set(data.likedTags || [])
      this.setData({
        item: data.item,
        liked: data.liked,
        tagItems: (data.item.tags || []).map(name => ({
          name,
          count: Number(data.item.tagLikes && data.item.tagLikes[name]) || 0,
          liked: likedTags.has(name)
        }))
      })
    } catch (error) {
      wx.showToast({ title: messageOf(error, '加载失败'), icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  preview() {
    const url = this.data.item && this.data.item.displayUrl
    if (url) wx.previewImage({ current: url, urls: [url] })
  },

  async toggleLike() {
    try {
      const result = await api.toggleLike(this.data.id)
      this.setData({
        liked: result.liked,
        'item.totalLikes': result.totalLikes
      })
    } catch (error) {
      wx.showToast({ title: messageOf(error, '操作失败'), icon: 'none' })
    }
  },

  async toggleTag(event) {
    const tag = event.currentTarget.dataset.tag
    try {
      const result = await api.toggleTagLike(this.data.id, tag)
      this.setData({
        tagItems: this.data.tagItems.map(item => item.name === tag
          ? { ...item, liked: result.liked, count: result.count }
          : item)
      })
    } catch (error) {
      wx.showToast({ title: messageOf(error, '操作失败'), icon: 'none' })
    }
  },

  save() {
    const item = this.data.item
    if (!item) return
    wx.showLoading({ title: '保存中' })
    api.saveToAlbum(item.fileID, item.displayUrl)
      .then(() => wx.showToast({ title: '已保存', icon: 'success' }))
      .catch(() => wx.showToast({ title: '保存失败', icon: 'none' }))
      .finally(wx.hideLoading)
  },

  onShareAppMessage() {
    const item = this.data.item
    return {
      title: item ? item.prompt : '分享一张表情',
      path: `/pages/detail/detail?id=${this.data.id}`,
      imageUrl: item && item.displayUrl
    }
  }
})
