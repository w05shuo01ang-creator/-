const api = require('../../utils/api')
const { toMap, patchLike, messageOf } = require('../../utils/view')

Page({
  data: {
    keyword: '',
    loading: true,
    searching: false,
    featured: [],
    rankings: [],
    results: [],
    likedMap: {}
  },

  onLoad() {
    this.loadHome()
  },

  async onPullDownRefresh() {
    await this.loadHome()
    wx.stopPullDownRefresh()
  },

  async loadHome() {
    this.setData({ loading: true })
    try {
      const data = await api.getHome()
      this.setData({
        featured: data.featured || [],
        rankings: data.rankings || [],
        likedMap: toMap(data.likedIds),
        searching: false,
        results: []
      })
    } catch (error) {
      wx.showToast({ title: messageOf(error, '加载失败'), icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onInput(event) {
    const keyword = event.detail.value
    this.setData({ keyword })
    if (!keyword.trim() && this.data.searching) this.loadHome()
  },

  async onSearch() {
    const query = this.data.keyword.trim()
    if (!query) return

    this.setData({ loading: true, searching: true, results: [] })
    try {
      const data = await api.listMemes({ query, limit: 30, offset: 0 })
      this.setData({ results: data.items || [], likedMap: toMap(data.likedIds) })
    } catch (error) {
      wx.showToast({ title: messageOf(error, '搜索失败'), icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  clearSearch() {
    this.setData({ keyword: '' })
    this.loadHome()
  },

  openCategory(event) {
    const tag = event.currentTarget.dataset.tag
    wx.switchTab({
      url: '/pages/category/category',
      success: () => {
        const page = getCurrentPages().slice(-1)[0]
        if (page && page.selectTag) page.selectTag(tag)
      }
    })
  },

  openDetail(event) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.detail.id}` })
  },

  async toggleLike(event) {
    const id = event.detail.id
    try {
      const result = await api.toggleLike(id)
      const likedMap = { ...this.data.likedMap }
      result.liked ? likedMap[id] = true : delete likedMap[id]
      this.setData({
        likedMap,
        featured: patchLike(this.data.featured, id, result.totalLikes),
        results: patchLike(this.data.results, id, result.totalLikes)
      })
    } catch (error) {
      wx.showToast({ title: messageOf(error, '操作失败'), icon: 'none' })
    }
  }
})

