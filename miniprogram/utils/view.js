function toMap(ids) {
  return (ids || []).reduce((map, id) => {
    map[id] = true
    return map
  }, {})
}

function patchLike(items, id, totalLikes) {
  return (items || []).map(item => item._id === id ? { ...item, totalLikes } : item)
}

function messageOf(error, fallback) {
  if (error && error.message && error.message !== '服务暂时不可用') return error.message
  return fallback
}

module.exports = { toMap, patchLike, messageOf }

