const UNTAGGED_KEY = '__untagged__'

function belongsToTab(item, tab) {
  if (tab === 'public') return item.reviewStatus === 'approved'
  if (tab === 'review') return ['pending', 'auto_reviewing', 'manual_review', 'rejected'].includes(item.reviewStatus)
  return item.reviewStatus === 'private'
}

function buildMineView(items, tab, query = '', activeTag = '') {
  const source = Array.isArray(items) ? items : []
  const counts = {
    private: source.filter(item => belongsToTab(item, 'private')).length,
    review: source.filter(item => belongsToTab(item, 'review')).length,
    public: source.filter(item => belongsToTab(item, 'public')).length
  }
  const tabItems = source.filter(item => belongsToTab(item, tab))
  const tagCounts = new Map()
  tabItems.forEach(item => {
    const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean) : []
    if (!tags.length) tagCounts.set(UNTAGGED_KEY, (tagCounts.get(UNTAGGED_KEY) || 0) + 1)
    tags.forEach(tag => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1))
  })
  const tagFilters = [{ key: '', label: '全部', count: tabItems.length }]
    .concat(Array.from(tagCounts.entries())
      .map(([key, count]) => ({ key, label: key === UNTAGGED_KEY ? '无标签' : key, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-CN')))
  const validTag = tagFilters.some(item => item.key === activeTag) ? activeTag : ''
  const keyword = String(query || '').trim().toLowerCase()
  const filtered = tabItems.filter(item => {
    const tags = Array.isArray(item.tags) ? item.tags : []
    const matchesTag = !validTag || (validTag === UNTAGGED_KEY ? !tags.length : tags.includes(validTag))
    const searchText = `${item.prompt || ''} ${tags.join(' ')}`.toLowerCase()
    return matchesTag && (!keyword || searchText.includes(keyword))
  })
  return { counts, filtered, tagFilters, activeTag: validTag }
}

module.exports = { UNTAGGED_KEY, belongsToTab, buildMineView }
