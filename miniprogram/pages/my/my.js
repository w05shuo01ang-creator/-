const api = require('../../utils/api')
const { messageOf } = require('../../utils/view')

Page({
  data: {
    loading: true,
    items: [],
    currentTab: 'private',
    filtered: [],
    showUpload: false,
    uploading: false,
    filePath: '',
    prompt: '',
    tagInput: '',
    tags: []
  },

  onShow() {
    this.load()
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const data = await api.getMine()
      this.setData({ items: data.items || [] })
      this.filterItems()
    } catch (error) {
      wx.showToast({ title: messageOf(error, '加载失败'), icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  changeTab(event) {
    this.setData({ currentTab: event.currentTarget.dataset.tab })
    this.filterItems()
  },

  filterItems() {
    const tab = this.data.currentTab
    this.setData({
      filtered: this.data.items.filter(item => {
        if (tab === 'public') return item.reviewStatus === 'approved'
        if (tab === 'review') return ['pending', 'rejected'].includes(item.reviewStatus)
        return item.reviewStatus === 'private'
      })
    })
  },

  showUpload() {
    this.setData({
      showUpload: true,
      filePath: '',
      prompt: '',
      tagInput: '',
      tags: []
    })
  },

  hideUpload() {
    if (!this.data.uploading) this.setData({ showUpload: false })
  },

  stopBubble() {},

  async chooseImage() {
    try {
      const result = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']
      })
      const file = result.tempFiles[0]
      if (file.size > 5 * 1024 * 1024) {
        wx.showToast({ title: '图片不能超过 5 MB', icon: 'none' })
        return
      }
      this.setData({ filePath: file.tempFilePath })
    } catch (error) {
      if (!String(error.errMsg || '').includes('cancel')) {
        wx.showToast({ title: '选择图片失败', icon: 'none' })
      }
    }
  },

  onPrompt(event) {
    this.setData({ prompt: event.detail.value })
  },

  onTagInput(event) {
    this.setData({ tagInput: event.detail.value })
  },

  addTag() {
    const tag = this.data.tagInput.trim()
    if (!tag) return
    if (tag.length > 10) return wx.showToast({ title: '标签最多 10 个字', icon: 'none' })
    if (this.data.tags.includes(tag)) return wx.showToast({ title: '标签已经存在', icon: 'none' })
    if (this.data.tags.length >= 5) return wx.showToast({ title: '最多添加 5 个标签', icon: 'none' })
    this.setData({ tags: this.data.tags.concat(tag), tagInput: '' })
  },

  removeTag(event) {
    const index = Number(event.currentTarget.dataset.index)
    this.setData({ tags: this.data.tags.filter((_, itemIndex) => itemIndex !== index) })
  },

  async upload() {
    if (!this.data.filePath) return wx.showToast({ title: '请先选择图片', icon: 'none' })
    this.setData({ uploading: true })
    try {
      await api.uploadMeme({
        filePath: this.data.filePath,
        prompt: this.data.prompt.trim(),
        tags: this.data.tags
      })
      wx.showToast({ title: '已保存到私密区', icon: 'success' })
      this.setData({ showUpload: false, currentTab: 'private' })
      await this.load()
    } catch (error) {
      wx.showToast({ title: messageOf(error, '上传失败'), icon: 'none' })
    } finally {
      this.setData({ uploading: false })
    }
  },

  openDetail(event) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` })
  },

  preview(event) {
    const url = event.currentTarget.dataset.url
    wx.previewImage({ current: url, urls: [url] })
  },

  publish(event) {
    const id = event.currentTarget.dataset.id
    wx.showModal({
      title: '申请公开',
      content: '提交后将进入内容审核，通过后才会出现在发现页。',
      confirmText: '提交审核',
      success: async result => {
        if (!result.confirm) return
        try {
          await api.requestPublish(id)
          wx.showToast({ title: '已提交审核', icon: 'success' })
          this.setData({ currentTab: 'review' })
          await this.load()
        } catch (error) {
          wx.showToast({ title: messageOf(error, '提交失败'), icon: 'none' })
        }
      }
    })
  },

  save(event) {
    const item = event.currentTarget.dataset.item
    wx.showLoading({ title: '保存中' })
    api.saveToAlbum(item.fileID, item.displayUrl)
      .then(() => wx.showToast({ title: '已保存', icon: 'success' }))
      .catch(error => {
        if (String(error.errMsg || '').includes('auth')) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许保存图片到相册。',
            success: result => result.confirm && wx.openSetting()
          })
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      })
      .finally(wx.hideLoading)
  },

  remove(event) {
    const id = event.currentTarget.dataset.id
    wx.showModal({
      title: '删除表情',
      content: '数据库记录和云存储文件都会被删除，且无法恢复。',
      confirmColor: '#f04458',
      success: async result => {
        if (!result.confirm) return
        try {
          await api.deleteMeme(id)
          wx.showToast({ title: '已删除', icon: 'success' })
          await this.load()
        } catch (error) {
          wx.showToast({ title: messageOf(error, '删除失败'), icon: 'none' })
        }
      }
    })
  }
})

