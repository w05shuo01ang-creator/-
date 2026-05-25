const api = require('../../utils/api')

Page({
  data: {
    prompt: '',
    tags: [],
    tagInput: '',
    generating: false,
    publishing: false,
    result: null,
    quota: { total: 10, used: 0, remaining: 10 },
    showRechargeModal: false,
    selectedPackage: '50',
    quickPrompts: [
      '开心的小狗', '可爱的猫咪', '加油表情', '无语表情',
      '开心到飞起', '委屈巴巴', '搞怪表情', '萌萌哒'
    ]
  },

  onShow() {
    this.loadQuota()
  },

  async loadQuota() {
    try {
      const quota = await api.getMemeQuota()
      this.setData({ quota })
    } catch (e) {
      console.error('获取配额失败', e)
    }
  },

  onInput(e) {
    this.setData({ prompt: e.detail.value })
  },

  onQuickTap(e) {
    this.setData({ prompt: e.currentTarget.dataset.prompt })
  },

  async onGenerate() {
    if (!this.data.prompt.trim()) {
      wx.showToast({ title: '请输入描述', icon: 'none' })
      return
    }

    this.setData({ generating: true, result: null })

    try {
      await api.login()
      const meme = await api.generateMeme(this.data.prompt)
      this.setData({ result: meme })
      this.loadQuota()
    } catch (e) {
      console.error('生成失败', e)
      wx.showToast({ title: e.message || '生成失败', icon: 'none' })
    } finally {
      this.setData({ generating: false })
    }
  },

  onTagInput(e) {
    this.setData({ tagInput: e.detail.value })
  },

  onAddTag() {
    const tag = this.data.tagInput.trim()
    if (!tag) return
    if (tag.length > 10) {
      wx.showToast({ title: '标签最多10字', icon: 'none' })
      return
    }
    if (this.data.tags.includes(tag)) {
      wx.showToast({ title: '标签已存在', icon: 'none' })
      return
    }
    if (this.data.tags.length >= 5) {
      wx.showToast({ title: '最多5个标签', icon: 'none' })
      return
    }
    this.setData({ tags: [...this.data.tags, tag], tagInput: '' })
  },

  onRemoveTag(e) {
    const index = e.currentTarget.dataset.index
    const tags = this.data.tags.filter((_, i) => i !== index)
    this.setData({ tags })
  },

  async onSave() {
    if (!this.data.result) return
    
    wx.showLoading({ title: '保存中...' })
    try {
      await api.saveMemeToAlbum(this.data.result.url)
      wx.showToast({ title: '保存成功', icon: 'success' })
    } catch (e) {
      console.error('保存失败', e)
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async onPublish() {
    if (!this.data.result) return
    
    const tags = this.data.tags.length > 0 ? this.data.tags : ['表情包']
    this.setData({ publishing: true })
    
    try {
      await api.makeMemePublic(this.data.result._id, tags)
      wx.showToast({ title: '发布成功', icon: 'success' })
      this.setData({ result: null, tags: [], prompt: '' })
    } catch (e) {
      console.error('发布失败', e)
      wx.showToast({ title: '发布失败', icon: 'none' })
    } finally {
      this.setData({ publishing: false })
    }
  },

  showRecharge() {
    this.setData({ showRechargeModal: true })
  },

  hideRecharge() {
    this.setData({ showRechargeModal: false })
  },

  preventBubble() {},

  onSelectPackage(e) {
    this.setData({ selectedPackage: e.currentTarget.dataset.package })
  },

  async onRecharge() {
    try {
      await api.rechargeQuota(this.data.selectedPackage)
      wx.showToast({ title: '充值成功', icon: 'success' })
      this.loadQuota()
    } catch (e) {
      wx.showToast({ title: '充值失败', icon: 'none' })
    }
    this.hideRecharge()
  }
})
