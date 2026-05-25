const api = require('../../utils/api')

function buildLikedMap(ids) {
  const map = {}
  ;(ids || []).forEach(id => { map[id] = true })
  return map
}

Page({
  data: {
    keyword: '',
    rankings: [],
    recommends: [],
    likedMap: {},
    searchResults: [],    // 存放搜索结果
    isSearching: false    // 是否处于搜索模式
  },

  onShow() {
    this.setData({ likedMap: buildLikedMap(api.getLikedIds()) })
    this.loadData()
  },

  async loadData() {
    this.setData({ loading: true })
    try {
      const [rankings, recommends] = await Promise.all([
        api.getRanking(),
        api.getRecommendedMemes()
      ])
      this.setData({ rankings, recommends: recommends.slice(0, 6) })
    } catch (e) {
      console.error(e)
    } finally {
      this.setData({ loading: false })
    }
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  onSearch() {
    const kw = this.data.keyword.trim()
    if (!kw) {
      wx.showToast({ title: '请输入关键词', icon: 'none' })
      return
    }
  
    this.setData({ isSearching: true, searchResults: [], loading: true })
    
    // 调用标签查询接口（与分类页请求同一接口）
    api.getMemesByTag(kw)     
      .then(res => {
        this.setData({ searchResults: res || [] })
      })
      .catch(() => {
        wx.showToast({ title: '搜索失败', icon: 'none' })
      })
      .finally(() => {
        this.setData({ loading: false })
      })
    },
    cancelSearch() {
      this.setData({ 
        keyword: '', 
        searchResults: [], 
        isSearching: false 
      })
      // 重新加载首页原有内容
      this.loadData()
    },
    onInput(e) {
      const value = e.detail.value
      this.setData({ keyword: value })
      if (value.trim() === '' && this.data.isSearching) {
        this.cancelSearch()
      }
    },
  onGoDetail(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },

  onRankTagTap(e) {
    const tag = e.currentTarget.dataset.tag
    wx.navigateTo({ url: `/pages/category/category?tag=${encodeURIComponent(tag)}` })
  },

  onRecHeaderTap() {
    wx.navigateTo({ url: '/pages/category/category?hot=1' })
  },

  async onLike(e) {
    const item = e.currentTarget.dataset.item
    if (!item || !item._id) return

    try {
      const res = await api.likeMeme(item._id)

      let { likedMap, rankings, recommends } = this.data
      likedMap = { ...likedMap }
      if (res.isLiked) {
        likedMap[item._id] = true
      } else {
        delete likedMap[item._id]
      }

      rankings = rankings.map(r => ({
        ...r,
        topMemes: r.topMemes.map(m => m._id === item._id ? { ...m, totalLikes: res.totalLikes } : m)
      }))

      recommends = recommends.map(r => r._id === item._id ? { ...r, totalLikes: res.totalLikes } : r)

      this.setData({ likedMap, rankings, recommends })
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  }
})
