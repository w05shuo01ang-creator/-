const api = require('../../utils/api')

function buildLikedMap(ids) {
  const map = {}
  ;(ids || []).forEach(id => { map[id] = true })
  return map
}

Page({
  data: {
    categories: [],
    memes: [],
    currentCategory: '',
    keyword: '',
    loading: false,
    hotRanking: [],
    showHotRanking: false,
    likedMap: {}
  },

  onLoad(options) {
    if (options.tag) this.setData({ currentCategory: decodeURIComponent(options.tag) })
    else if (options.keyword) {
      const kw = decodeURIComponent(options.keyword)
      this.setData({ keyword: kw, currentCategory: kw })
    } else if (options.hot) this.setData({ showHotRanking: true })
    this.loadData()
  },

  onShow() {
    this.setData({ likedMap: buildLikedMap(api.getLikedIds()) })
  },

  async loadData() {
    this.setData({ loading: true })
    try {
      const categories = api.getCategories()
      const [memes, hotRanking] = await Promise.all([
        this.data.currentCategory
          ? api.getMemesByTag(this.data.currentCategory)
          : api.getRecommendedMemes(),
        api.getHotRanking()
      ])

      this.setData({ categories, memes, hotRanking })
    } catch (e) {
      console.error('加载失败', e)
    } finally {
      this.setData({ loading: false })
    }
  },

  onCategoryTap(e) {
    const cat = e.currentTarget.dataset.cat
    this.setData({ currentCategory: cat, showHotRanking: false })
    this.loadMemes(cat)
  },

  onHotCardTap() {
    this.setData({ showHotRanking: true, currentCategory: '' })
  },

  async loadMemes(tag) {
    this.setData({ loading: true })
    try {
      this.setData({ memes: await api.getMemesByTag(tag) })
    } catch (e) {
      console.error('加载失败', e)
    } finally {
      this.setData({ loading: false })
    }
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  onSearch() {
    const kw = this.data.keyword.trim()
    if (kw) {
      this.setData({ currentCategory: kw, showHotRanking: false })
      this.loadMemes(kw)
    }
  },

  onGoDetail(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },

  async onLike(e) {
    const item = e.currentTarget.dataset.item
    if (!item || !item._id) return

    try {
      const res = await api.likeMeme(item._id)

      let { likedMap, memes, hotRanking } = this.data
      likedMap = { ...likedMap }
      if (res.isLiked) {
        likedMap[item._id] = true
      } else {
        delete likedMap[item._id]
      }

      memes = memes.map(m => m._id === item._id ? { ...m, totalLikes: res.totalLikes } : m)
      hotRanking = hotRanking.map(m => m._id === item._id ? { ...m, totalLikes: res.totalLikes } : m)

      this.setData({ likedMap, memes, hotRanking })
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  }
})
