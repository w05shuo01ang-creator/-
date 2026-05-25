const app = getApp()

function db() {
  if (!wx.cloud) throw new Error('基础库版本过低，不支持云开发')
  return wx.cloud.database()
}

function uid() {
  return app.getUid ? app.getUid() : ''
}

function fuzzyScore(text, query) {
  if (!text || !query) return 0
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  if (t === q) return 100
  if (t.includes(q)) return 80 + (q.length / Math.max(t.length, 1)) * 20
  let matches = 0
  let consecutive = 0
  let maxConsecutive = 0
  let lastIdx = -2
  for (let i = 0; i < q.length; i++) {
    const idx = t.indexOf(q[i])
    if (idx >= 0) {
      matches++
      if (idx === lastIdx + 1) {
        consecutive++
        maxConsecutive = Math.max(maxConsecutive, consecutive)
      } else {
        consecutive = 1
        maxConsecutive = Math.max(maxConsecutive, 1)
      }
      lastIdx = idx
    }
  }
  if (matches === 0) return 0
  const matchRatio = matches / q.length
  const consecutiveBonus = maxConsecutive > 1 ? (maxConsecutive / q.length) * 20 : 0
  return matchRatio * 60 + consecutiveBonus
}
// 按标签获取表情包
function getMemesByTag(tag) {
  return wx.cloud.callFunction({ name: 'getMemesByTag', data: { tag } }).then(res => res.result)
}

async function resolveFileIDs(fileIDs) {
  const uniqueFileIDs = [...new Set((fileIDs || []).filter(fileID => typeof fileID === 'string' && fileID.startsWith('cloud://')))]
  if (!uniqueFileIDs.length) return {}

  const urlMap = {}
  const batchSize = 50

  for (let i = 0; i < uniqueFileIDs.length; i += batchSize) {
    const currentBatch = uniqueFileIDs.slice(i, i + batchSize)
    try {
      const functionRes = await wx.cloud.callFunction({
        name: 'getTempFileURLs',
        data: { fileIDs: currentBatch }
      })
      const res = functionRes && functionRes.result ? functionRes.result : null
      const fileList = res && res.fileList ? res.fileList : []
      fileList.forEach(item => {
        if (item && item.fileID) {
          urlMap[item.fileID] = item.tempFileURL || item.fileID
        }
      })
    } catch (e) {
      console.warn('云函数获取图片临时链接失败，尝试客户端直连:', e)
      try {
        const res = await wx.cloud.getTempFileURL({ fileList: currentBatch })
        const fileList = res && res.fileList ? res.fileList : []
        fileList.forEach(item => {
          if (item && item.fileID) {
            urlMap[item.fileID] = item.tempFileURL || item.fileID
          }
        })
      } catch (innerError) {
        console.warn('批量获取图片临时链接失败:', innerError)
        currentBatch.forEach(fileID => {
          urlMap[fileID] = fileID
        })
      }
    }
  }

  return urlMap
}

async function attachDisplayUrl(memes) {
  const list = Array.isArray(memes) ? memes : []
  if (!list.length) return []

  const urlMap = await resolveFileIDs(list.map(item => item && item.url))
  return list.map(item => {
    if (!item) return item
    return {
      ...item,
      displayUrl: urlMap[item.url] || item.url || ''
    }
  })
}

async function attachRankingDisplayUrl(rankings) {
  const list = Array.isArray(rankings) ? rankings : []
  if (!list.length) return []

  const allMemes = []
  list.forEach(rank => {
    ;(rank.topMemes || []).forEach(meme => allMemes.push(meme))
  })

  const urlMap = await resolveFileIDs(allMemes.map(item => item && item.url))
  return list.map(rank => ({
    ...rank,
    topMemes: (rank.topMemes || []).map(meme => ({
      ...meme,
      displayUrl: urlMap[meme.url] || meme.url || ''
    }))
  }))
}
const api = {
  async getRecommendedMemes() {
    try {
      const res = await db().collection('memes')
        .where({ isPublic: true, reviewStatus: 'approved' })
        .orderBy('totalLikes', 'desc')
        .limit(20)
        .get()
      return await attachDisplayUrl(res && res.data ? res.data : [])
    } catch (e) {
      console.error('获取推荐失败:', e)
      return []
    }
  },


  async getMemesByTag(tag) {
    try {
      const res = await db().collection('memes')
        .where({ isPublic: true, reviewStatus: 'approved' })
        .orderBy('totalLikes', 'desc')
        .limit(100)
        .get()
      const data = res && res.data ? res.data : []
      if (!tag) return await attachDisplayUrl(data)

      const query = tag.toLowerCase()
      const scored = []
      data.forEach(m => {
        let best = 0
        if (m.tags) {
          m.tags.forEach(t => {
            if (typeof t !== 'string') return
            best = Math.max(best, fuzzyScore(t, query))
          })
        }
        if (m.prompt && typeof m.prompt === 'string') {
          best = Math.max(best, fuzzyScore(m.prompt, query) * 0.5)
        }
        if (best > 0) scored.push({ ...m, _score: best })
      })

      scored.sort((a, b) => b._score - a._score)
      return await attachDisplayUrl(scored)
    } catch (e) {
      console.error('按标签获取失败:', e)
      return []
    }
  },

  async getMyMemes() {
    try {
      const res = await db().collection('memes')
        .where({ uid: uid() })
        .orderBy('createTime', 'desc')
        .get()
      return await attachDisplayUrl(res && res.data ? res.data : [])
    } catch (e) {
      console.error('获取我的表情失败:', e)
      return []
    }
  },

  async uploadLocalImage(filePath, tags) {
    const cloudPath = `memes/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${filePath.split('.').pop()}`
    const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath })
    const url = uploadRes.fileID

    await db().collection('memes').add({
      data: {
        url,
        prompt: tags.length ? tags.join(' ') : '上传表情',
        tags: tags.length ? tags : ['表情包'],
        isPublic: false,
        reviewStatus: 'approved',
        totalLikes: 0,
        uid: uid(),
        createTime: new Date()
      }
    })
    return { success: true }
  },

  async saveToAlbum(url) {
    return new Promise((resolve, reject) => {
      if (!url) return reject(new Error('无效URL'))
      wx.cloud.downloadFile({
        fileID: url,
        success: res => {
          wx.saveImageToPhotosAlbum({
            filePath: res.tempFilePath,
            success: () => resolve(),
            fail: err => {
              if (err.errMsg && err.errMsg.includes('auth')) {
                wx.showModal({
                  title: '提示',
                  content: '需要授权保存到相册',
                  success: r => { if (r.confirm) wx.openSetting() }
                })
              }
              reject(err)
            }
          })
        },
        fail: reject
      })
    })
  },

  async getRanking() {
    try {
      const res = await db().collection('memes')
        .where({ isPublic: true, reviewStatus: 'approved' })
        .orderBy('totalLikes', 'desc')
        .limit(200)
        .get()

      const memes = res && res.data ? res.data : []
      const tagMap = {}

      memes.forEach(m => {
        if (!m.tags) return
        m.tags.forEach(t => {
          if (typeof t !== 'string') return
          if (!tagMap[t]) tagMap[t] = { tag: t, totalLikes: 0, memes: [] }
          tagMap[t].totalLikes += (m.totalLikes || 0)
          tagMap[t].memes.push(m)
        })
      })

      const rankings = Object.values(tagMap)
        .sort((a, b) => b.totalLikes - a.totalLikes)
        .slice(0, 5)
        .map(item => ({
          tag: item.tag,
          totalLikes: item.totalLikes,
          topMemes: item.memes
            .sort((a, b) => (b.totalLikes || 0) - (a.totalLikes || 0))
            .slice(0, 3)
        }))

      return await attachRankingDisplayUrl(rankings)
    } catch (e) {
      console.error('获取排行失败:', e)
      return []
    }
  },

  async getHotRanking() {
    try {
      const res = await db().collection('memes')
        .where({ isPublic: true, reviewStatus: 'approved' })
        .orderBy('totalLikes', 'desc')
        .limit(20)
        .get()
      return await attachDisplayUrl(res && res.data ? res.data : [])
    } catch (e) {
      console.error('获取最热排行失败:', e)
      return []
    }
  },

  async deleteMeme(id) {
    await db().collection('memes').doc(id).remove()
    return { success: true }
  },

  async publishMeme(id, tags) {
    const doc = await db().collection('memes').doc(id).get()
    if (!doc || !doc.data) throw new Error('表情不存在')

    let reviewStatus = 'approved'
    try {
      const checkRes = await wx.cloud.callFunction({
        name: 'contentCheck',
        data: { fileID: doc.data.url }
      })
      if (checkRes.result && !checkRes.result.pass) {
        reviewStatus = 'rejected'
      }
    } catch (e) {
      console.warn('云函数 contentCheck 不可用，跳过内容审核:', e.message)
    }

    await db().collection('memes').doc(id).update({
      data: { isPublic: true, tags, reviewStatus }
    })

    if (reviewStatus === 'rejected') {
      throw new Error('图片内容违规，已被自动拒绝')
    }

    return { success: true }
  },

  async getPendingReviews() {
    try {
      const res = await db().collection('memes')
        .where({ isPublic: true, reviewStatus: 'pending' })
        .orderBy('createTime', 'desc')
        .limit(50)
        .get()
      return res && res.data ? res.data : []
    } catch (e) {
      console.error('获取待审核列表失败:', e)
      return []
    }
  },

  async approveMeme(id) {
    await db().collection('memes').doc(id).update({
      data: { reviewStatus: 'approved' }
    })
    return { success: true }
  },

  async rejectMeme(id) {
    await db().collection('memes').doc(id).update({
      data: { reviewStatus: 'rejected' }
    })
    return { success: true }
  },

  getLikedIds() {
    try {
      return wx.getStorageSync('_liked_ids') || []
    } catch (e) {
      return []
    }
  },

  async likeMeme(id) {
    const likedIds = this.getLikedIds()
    const isLiked = likedIds.includes(id)

    const doc = await db().collection('memes').doc(id).get()
    if (!doc || !doc.data) throw new Error('表情不存在')

    const currentLikes = doc.data.totalLikes || 0
    const newLikes = isLiked ? Math.max(0, currentLikes - 1) : currentLikes + 1

    await db().collection('memes').doc(id).update({
      data: { totalLikes: newLikes }
    })

    if (isLiked) {
      wx.setStorageSync('_liked_ids', likedIds.filter(i => i !== id))
    } else {
      likedIds.push(id)
      wx.setStorageSync('_liked_ids', likedIds)
    }

    return { isLiked: !isLiked, totalLikes: newLikes }
  },

  async getMemeById(id) {
    if (!id) return null

    try {
      const doc = await db().collection('memes').doc(id).get()
      if (doc && doc.data) {
        const list = await attachDisplayUrl([doc.data])
        return list[0] || null
      }
    } catch (e) {
      console.warn('按文档 ID 获取表情失败，尝试回退查询:', e)
    }

    try {
      const _ = db().command
      const res = await db().collection('memes')
        .where(_.or([
          { _id: id, isPublic: true, reviewStatus: 'approved' },
          { _id: id, uid: uid() }
        ]))
        .limit(1)
        .get()

      const list = await attachDisplayUrl(res && res.data ? res.data : [])
      return list[0] || null
    } catch (e) {
      console.error('回退查询表情详情失败:', e)
      return null
    }
  },

  getTagLikedMap() {
    try {
      return wx.getStorageSync('_tag_likes') || {}
    } catch (e) {
      return {}
    }
  },

  async likeMemeTag(memeId, tagName) {
    const key = `${memeId}_${tagName}`
    const tagLikedMap = this.getTagLikedMap()
    const isLiked = !!tagLikedMap[key]

    const doc = await db().collection('memes').doc(memeId).get()
    if (!doc || !doc.data) throw new Error('表情不存在')

    const tagLikes = { ...(doc.data.tagLikes || {}) }
    const current = tagLikes[tagName] || 0
    tagLikes[tagName] = isLiked ? Math.max(0, current - 1) : current + 1

    await db().collection('memes').doc(memeId).update({
      data: { tagLikes }
    })

    if (isLiked) {
      delete tagLikedMap[key]
    } else {
      tagLikedMap[key] = true
    }
    wx.setStorageSync('_tag_likes', tagLikedMap)

    return { isLiked: !isLiked, count: tagLikes[tagName] }
  },

  async isAdmin() {
    try {
      const res = await db().collection('admins')
        .where({ uid: uid() })
        .get()
      return res && res.data && res.data.length > 0
    } catch (e) {
      return false
    }
  },

  getCategories() {
    return [
      { name: '可爱', icon: '🐱' },
      { name: '搞笑', icon: '😂' },
      { name: '励志', icon: '💪' },
      { name: '情感', icon: '❤️' },
      { name: '影视', icon: '🎬' },
      { name: '游戏', icon: '🎮' },
      { name: '动漫', icon: '🌟' },
      { name: '明星', icon: '⭐' }
    ]
  },

  getHotTags() {
    return ['可爱', '搞笑', '无语', '加油', '开心', '委屈', '搞怪', '懵逼']
  }
}

module.exports = api
