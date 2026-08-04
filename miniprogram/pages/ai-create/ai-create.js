const api = require('../../utils/api')
const { messageOf } = require('../../utils/view')

Page({
  data: {
    loading: true,
    available: false,
    models: [],
    modelNames: [],
    selectedModelIndex: 0,
    selectedModel: null,
    aspectRatios: ['1:1'],
    selectedRatio: '1:1',
    prompt: '',
    generating: false,
    quota: { dailyLimit: 3, bonus: 0, used: 0, remaining: 3, topUpEnabled: false }
  },

  onLoad() {
    this.loadConfig()
  },

  async loadConfig() {
    try {
      const config = await api.getAiConfig()
      const models = config.models || []
      const selectedModel = models[0] || null
      this.setData({
        available: config.available === true,
        models,
        modelNames: models.map(model => model.name),
        selectedModel,
        aspectRatios: selectedModel ? selectedModel.aspectRatios : ['1:1'],
        selectedRatio: selectedModel ? selectedModel.aspectRatios[0] : '1:1',
        quota: config.quota || this.data.quota
      })
      if (!models.length) {
        await wx.showModal({
          title: 'AI制作',
          content: '该功能暂未上线，请期待',
          showCancel: false
        })
      }
    } catch (error) {
      wx.showToast({ title: messageOf(error, 'AI配置加载失败'), icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  selectModel(event) {
    const selectedModelIndex = Number(event.detail.value) || 0
    const selectedModel = this.data.models[selectedModelIndex]
    if (!selectedModel) return
    this.setData({
      selectedModelIndex,
      selectedModel,
      aspectRatios: selectedModel.aspectRatios,
      selectedRatio: selectedModel.aspectRatios[0]
    })
  },

  selectRatio(event) {
    this.setData({ selectedRatio: event.currentTarget.dataset.ratio })
  },

  onPrompt(event) {
    this.setData({ prompt: event.detail.value })
  },

  async addCredits() {
    if (!this.data.quota.topUpEnabled) {
      return wx.showModal({ title: '增加次数', content: '增加次数功能暂未上线', showCancel: false })
    }
    try {
      await api.requestAiCredits()
      await this.loadConfig()
    } catch (error) {
      wx.showToast({ title: messageOf(error, '暂时无法增加次数'), icon: 'none' })
    }
  },

  async generate() {
    const prompt = this.data.prompt.trim()
    if (!this.data.available || !this.data.selectedModel) {
      return wx.showModal({ title: 'AI制作', content: '该功能暂未上线，请期待', showCancel: false })
    }
    if (!prompt) return wx.showToast({ title: '请输入画面描述', icon: 'none' })
    if (this.data.quota.remaining < 1) return wx.showToast({ title: '今日次数已用完', icon: 'none' })

    this.setData({ generating: true })
    try {
      await api.generateAiMeme({
        modelId: this.data.selectedModel.id,
        prompt,
        aspectRatio: this.data.selectedRatio
      })
    } catch (error) {
      wx.showToast({ title: messageOf(error, '生成失败'), icon: 'none' })
    } finally {
      this.setData({ generating: false })
    }
  }
})
