const api = require('../../utils/api')

Page({
  data: {
    allMemes: [],
    filteredMemes: [],
    currentTab: 'private',
    loading: false,
    showUploadModal: false,
    tempFilePath: '',
    uploadTags: [],
    uploadTagInput: ''
  },

  onShow() {
    this.loadData()
  },

  async loadData() {
    this.setData({ loading: true })
    try {
      const memes = await api.getMyMemes()
      this.setData({ allMemes: memes })
      this.applyFilter()
    } catch (e) {
      console.error('加载失败', e)
    } finally {
      this.setData({ loading: false })
    }
  },

  onTabChange(e) {
    this.setData({ currentTab: e.currentTarget.dataset.tab })
    this.applyFilter()
  },

  applyFilter() {
    const showPublic = this.data.currentTab === 'public'
    const filtered = this.data.allMemes.filter(m => showPublic ? m.isPublic === true : !m.isPublic)
    this.setData({ filteredMemes: filtered })
  },

  onPreview(e) {
    const url = e.currentTarget.dataset.url
    if (url) wx.previewImage({ urls: [url], current: url })
  },

  async onSaveMeme(e) {
    const item = e.currentTarget.dataset.item
    wx.showLoading({ title: '保存中...' })
    try {
      await api.saveToAlbum(item.url)
      wx.showToast({ title: '保存成功', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  onDeleteMeme(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认删除',
      content: '确定删除？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.deleteMeme(id)
            wx.showToast({ title: '已删除', icon: 'success' })
            this.loadData()
          } catch (e) {
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        }
      }
    })
  },

  onPublishMeme(e) {
    const item = e.currentTarget.dataset.item
    const tags = item.tags || []
    wx.showModal({
      title: '发布到公开区',
      content: '公开后将自动进行内容安全审核，通过后即可被所有人看到。确定发布？',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '发布中...' })
          try {
            await api.publishMeme(item._id, tags)
            wx.showToast({ title: '发布成功', icon: 'success' })
            this.loadData()
          } catch (e) {
            wx.showToast({ title: e.message || '发布失败', icon: 'none' })
          } finally {
            wx.hideLoading()
          }
        }
      }
    })
  },

  onShowUploadModal() {
    this.setData({ showUploadModal: true, uploadTags: [], uploadTagInput: '', tempFilePath: '' })
  },


  onHideUploadModal() {
    this.setData({ showUploadModal: false })
  },

  preventBubble() {},

  onChooseImage() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album'],
      success: (res) => {
        const file = res.tempFiles[0]
        if (file.size > 5 * 1024 * 1024) {
          wx.showToast({ title: '图片不能超过5MB', icon: 'none' })
          return
        }
        this.setData({ tempFilePath: file.path })
      },
      fail: (err) => {
        console.error('选择图片失败:', err)
        if (err.errMsg && err.errMsg.includes('cancel')) return
        wx.showToast({ title: err.errMsg || '选择失败', icon: 'none' })
      }
    })
  },

  onUploadTagInput(e) {
    this.setData({ uploadTagInput: e.detail.value })
  },

  onAddUploadTag() {
    const tag = this.data.uploadTagInput.trim()
    if (!tag) return
    if (tag.length > 10) { wx.showToast({ title: '标签最多10字', icon: 'none' }); return }
    if (this.data.uploadTags.includes(tag)) { wx.showToast({ title: '已存在', icon: 'none' }); return }
    if (this.data.uploadTags.length >= 5) { wx.showToast({ title: '最多5个', icon: 'none' }); return }
    this.setData({ uploadTags: [...this.data.uploadTags, tag], uploadTagInput: '' })
  },

  onRemoveUploadTag(e) {
    const idx = e.currentTarget.dataset.index
    this.setData({ uploadTags: this.data.uploadTags.filter((_, i) => i !== idx) })
  },

  async onUploadImage() {
    if (!this.data.tempFilePath) { wx.showToast({ title: '请选择图片', icon: 'none' }); return }
    wx.showLoading({ title: '上传中...' })
    try {
      await api.uploadLocalImage(this.data.tempFilePath, this.data.uploadTags)
      wx.showToast({ title: '上传成功', icon: 'success' })
      this.onHideUploadModal()
      this.loadData()
    } catch (e) {
      wx.showToast({ title: '上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  }
})
