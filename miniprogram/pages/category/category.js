const api = require('../../utils/api')
const { toMap, patchLike, messageOf } = require('../../utils/view')

const CATEGORIES = ['全部', '可爱', '搞笑', '无语', '开心', '委屈', '加油', '影视', '游戏', '动漫']

Page({
  data: {
    categories: CATEGORIES,
    selected: '全部',
    keyword: '',
    items: [],
    likedMap: {},
    offset: 0,
    hasMore: true,
    loading: false
  },

  onLoad() {
    this.load(true)
  },

  async onPullDownRefresh() {
    await this.load(true)
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.load(false)
  },

  selectTag(tag) {
    this.setData({ selected: tag || '全部', keyword: '' })
    this.load(true)
  },

  onCategory(event) {
    this.selectTag(event.currentTarget.dataset.tag)
  },

  onInput(event) {
    this.setData({ keyword: event.detail.value })
  },

  onSearch() {
    this.setData({ selected: '全部' })
    this.load(true)
  },

  async load(reset) {
    if (this.data.loading) return
    const offset = reset ? 0 : this.data.offset
    this.setData({ loading: true })
    try {
      const data = await api.listMemes({
        tag: this.data.selected === '全部' ? '' : this.data.selected,
        query: this.data.keyword.trim(),
        offset,
        limit: 20
      })
      this.setData({
        items: reset ? data.items : this.data.items.concat(data.items || []),
        likedMap: { ...this.data.likedMap, ...toMap(data.likedIds) },
        offset: offset + (data.items || []).length,
        hasMore: !!data.hasMore
      })
    } catch (error) {
      wx.showToast({ title: messageOf(error, '加载失败'), icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
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
      this.setData({ likedMap, items: patchLike(this.data.items, id, result.totalLikes) })
    } catch (error) {
      wx.showToast({ title: messageOf(error, '操作失败'), icon: 'none' })
    }
  }
})

