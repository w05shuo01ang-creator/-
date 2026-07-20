const crypto = require('crypto')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const command = db.command
const MEMES = 'memes'
const LIKES = 'likes'
const TAG_LIKES = 'tag_likes'
const MAX_PAGE_SIZE = 30

class ApiError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function context() {
  const wxContext = cloud.getWXContext()
  if (!wxContext.OPENID) throw new ApiError('UNAUTHENTICATED', '无法确认微信身份')
  return { openid: wxContext.OPENID }
}

function digest(value, length = 40) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, length)
}

function ownerKey(openid) {
  return digest(`owner:${openid}`, 24)
}

function cleanId(value) {
  const id = String(value || '').trim()
  if (!id || id.length > 64 || !/^[\w-]+$/.test(id)) {
    throw new ApiError('INVALID_ARGUMENT', '无效的表情编号')
  }
  return id
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength)
}

function cleanTags(value) {
  const input = Array.isArray(value) ? value : []
  const tags = []
  input.forEach(item => {
    const tag = cleanText(item, 10).replace(/^#+/, '')
    if (tag && !tags.includes(tag) && tags.length < 5) tags.push(tag)
  })
  return tags.length ? tags : ['表情包']
}

function pageParams(payload) {
  const offset = Math.max(0, Math.min(1000, Number(payload.offset) || 0))
  const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Number(payload.limit) || 20))
  return { offset, limit }
}

function statusText(status) {
  return {
    private: '仅自己可见',
    pending: '等待审核',
    approved: '已公开',
    rejected: '审核未通过'
  }[status] || '状态未知'
}

function dateText(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

async function present(memes) {
  const items = Array.isArray(memes) ? memes : []
  const fileIDs = [...new Set(items.map(item => item.fileID).filter(fileID => typeof fileID === 'string' && fileID.startsWith('cloud://')))]
  const urlMap = {}

  for (let index = 0; index < fileIDs.length; index += 50) {
    const batch = fileIDs.slice(index, index + 50)
    const result = await cloud.getTempFileURL({ fileList: batch })
    ;(result.fileList || []).forEach(file => {
      urlMap[file.fileID] = file.tempFileURL || ''
    })
  }

  return items.map(item => ({
    _id: item._id,
    fileID: item.fileID,
    displayUrl: urlMap[item.fileID] || '',
    prompt: item.prompt || '',
    tags: Array.isArray(item.tags) ? item.tags : [],
    tagsText: (Array.isArray(item.tags) ? item.tags : []).map(tag => `#${tag}`).join('  '),
    tagLikes: item.tagLikes || {},
    totalLikes: Number(item.totalLikes) || 0,
    isPublic: item.isPublic === true,
    reviewStatus: item.reviewStatus || 'private',
    reviewStatusText: statusText(item.reviewStatus),
    createdAtText: dateText(item.createdAt)
  }))
}

async function likedMemeIds(openid, memeIds) {
  if (!memeIds.length) return []
  const result = await db.collection(LIKES)
    .where({ _openid: openid, memeId: command.in(memeIds.slice(0, 100)) })
    .limit(100)
    .get()
  return (result.data || []).map(item => item.memeId)
}

async function publicPool() {
  const result = await db.collection(MEMES)
    .where({ isPublic: true, reviewStatus: 'approved' })
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()
  return result.data || []
}

function matches(item, tag, query) {
  const tags = Array.isArray(item.tags) ? item.tags : []
  if (tag && !tags.includes(tag)) return false
  if (!query) return true
  const haystack = `${item.prompt || ''} ${tags.join(' ')}`.toLowerCase()
  return haystack.includes(query.toLowerCase())
}

async function bootstrap(openid) {
  return { ownerKey: ownerKey(openid) }
}

async function home(openid) {
  const pool = await publicPool()
  const featuredSource = pool
    .slice()
    .sort((left, right) => (right.totalLikes || 0) - (left.totalLikes || 0) || new Date(right.createdAt) - new Date(left.createdAt))
    .slice(0, 12)

  const tagTotals = {}
  pool.forEach(item => {
    ;(item.tags || []).forEach(tag => {
      tagTotals[tag] = (tagTotals[tag] || 0) + (Number(item.totalLikes) || 0)
    })
  })

  const rankings = Object.keys(tagTotals)
    .map(tag => ({ tag, totalLikes: tagTotals[tag] }))
    .sort((left, right) => right.totalLikes - left.totalLikes)
    .slice(0, 6)

  return {
    featured: await present(featuredSource),
    rankings,
    likedIds: await likedMemeIds(openid, featuredSource.map(item => item._id))
  }
}

async function list(openid, payload) {
  const { offset, limit } = pageParams(payload)
  const tag = cleanText(payload.tag, 10)
  const query = cleanText(payload.query, 30)
  const pool = await publicPool()
  const filtered = pool.filter(item => matches(item, tag, query))
  const selected = filtered.slice(offset, offset + limit)

  return {
    items: await present(selected),
    likedIds: await likedMemeIds(openid, selected.map(item => item._id)),
    hasMore: offset + selected.length < filtered.length
  }
}

async function mine(openid) {
  const result = await db.collection(MEMES)
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()
  return { items: await present(result.data || []) }
}

async function getOwnedOrPublic(id, openid) {
  let item
  try {
    const result = await db.collection(MEMES).doc(id).get()
    item = result.data
  } catch (error) {
    throw new ApiError('NOT_FOUND', '表情不存在')
  }

  const isOwner = item._openid === openid
  const isPublic = item.isPublic === true && item.reviewStatus === 'approved'
  if (!isOwner && !isPublic) throw new ApiError('FORBIDDEN', '无权查看这张表情')
  return item
}

async function detail(id, openid) {
  const item = await getOwnedOrPublic(id, openid)
  const likeId = digest(`like:${openid}:${id}`)
  const tagResult = await db.collection(TAG_LIKES)
    .where({ _openid: openid, memeId: id })
    .limit(20)
    .get()

  let liked = false
  try {
    await db.collection(LIKES).doc(likeId).get()
    liked = true
  } catch (error) {
    liked = false
  }

  return {
    item: (await present([item]))[0],
    liked,
    likedTags: (tagResult.data || []).map(record => record.tag)
  }
}

async function create(payload, openid) {
  const fileID = String(payload.fileID || '')
  const expectedPath = `/uploads/${ownerKey(openid)}/`
  if (!fileID.startsWith('cloud://') || !fileID.includes(expectedPath)) {
    throw new ApiError('INVALID_FILE', '上传文件路径无效')
  }

  const fileResult = await cloud.getTempFileURL({ fileList: [fileID] })
  const uploadedFile = fileResult.fileList && fileResult.fileList[0]
  if (!uploadedFile || uploadedFile.status !== 0 || !uploadedFile.tempFileURL) {
    throw new ApiError('INVALID_FILE', '上传文件不存在或不可访问')
  }

  const tags = cleanTags(payload.tags)
  const prompt = cleanText(payload.prompt, 60) || tags.join(' ')
  const now = db.serverDate()
  const result = await db.collection(MEMES).add({
    data: {
      _openid: openid,
      fileID,
      prompt,
      tags,
      tagLikes: {},
      totalLikes: 0,
      isPublic: false,
      reviewStatus: 'private',
      createdAt: now,
      updatedAt: now
    }
  })
  return { id: result._id }
}

async function requestPublish(id, openid) {
  const item = await getOwnedOrPublic(id, openid)
  if (item._openid !== openid) throw new ApiError('FORBIDDEN', '只能发布自己的表情')
  if (!['private', 'rejected'].includes(item.reviewStatus)) {
    throw new ApiError('INVALID_STATE', '当前状态不能重复提交')
  }

  await db.collection(MEMES).doc(id).update({
    data: {
      isPublic: false,
      reviewStatus: 'pending',
      updatedAt: db.serverDate()
    }
  })
  return { status: 'pending' }
}

async function remove(id, openid) {
  const item = await getOwnedOrPublic(id, openid)
  if (item._openid !== openid) throw new ApiError('FORBIDDEN', '只能删除自己的表情')

  await db.collection(MEMES).doc(id).remove()
  await Promise.all([
    db.collection(LIKES).where({ memeId: id }).remove(),
    db.collection(TAG_LIKES).where({ memeId: id }).remove()
  ])

  if (item.fileID && item.fileID.startsWith('cloud://')) {
    try {
      await cloud.deleteFile({ fileList: [item.fileID] })
    } catch (error) {
      console.error('orphaned cloud file', { id, fileID: item.fileID, error })
    }
  }
  return { deleted: true }
}

async function toggleLike(id, openid) {
  return db.runTransaction(async transaction => {
    const memeResult = await transaction.collection(MEMES).doc(id).get()
    const item = memeResult.data
    if (!item || item.isPublic !== true || item.reviewStatus !== 'approved') {
      throw new ApiError('FORBIDDEN', '只能点赞已公开的表情')
    }

    const likeId = digest(`like:${openid}:${id}`)
    let exists = false
    try {
      await transaction.collection(LIKES).doc(likeId).get()
      exists = true
    } catch (error) {
      exists = false
    }

    const current = Math.max(0, Number(item.totalLikes) || 0)
    const totalLikes = exists ? Math.max(0, current - 1) : current + 1
    await transaction.collection(MEMES).doc(id).update({
      data: { totalLikes, updatedAt: db.serverDate() }
    })

    if (exists) {
      await transaction.collection(LIKES).doc(likeId).remove()
    } else {
      await transaction.collection(LIKES).doc(likeId).set({
        data: { _openid: openid, memeId: id, createdAt: db.serverDate() }
      })
    }
    return { liked: !exists, totalLikes }
  })
}

async function toggleTagLike(id, tagValue, openid) {
  const tag = cleanText(tagValue, 10)
  if (!tag) throw new ApiError('INVALID_ARGUMENT', '标签不能为空')

  return db.runTransaction(async transaction => {
    const memeResult = await transaction.collection(MEMES).doc(id).get()
    const item = memeResult.data
    if (!item || item.isPublic !== true || item.reviewStatus !== 'approved') {
      throw new ApiError('FORBIDDEN', '只能点赞已公开内容的标签')
    }
    if (!(item.tags || []).includes(tag)) throw new ApiError('INVALID_ARGUMENT', '标签不存在')

    const recordId = digest(`tag-like:${openid}:${id}:${tag}`)
    let exists = false
    try {
      await transaction.collection(TAG_LIKES).doc(recordId).get()
      exists = true
    } catch (error) {
      exists = false
    }

    const tagLikes = { ...(item.tagLikes || {}) }
    const current = Math.max(0, Number(tagLikes[tag]) || 0)
    tagLikes[tag] = exists ? Math.max(0, current - 1) : current + 1
    await transaction.collection(MEMES).doc(id).update({
      data: { tagLikes, updatedAt: db.serverDate() }
    })

    if (exists) {
      await transaction.collection(TAG_LIKES).doc(recordId).remove()
    } else {
      await transaction.collection(TAG_LIKES).doc(recordId).set({
        data: { _openid: openid, memeId: id, tag, createdAt: db.serverDate() }
      })
    }
    return { liked: !exists, count: tagLikes[tag] }
  })
}

const actions = {
  bootstrap: ({ openid }) => bootstrap(openid),
  home: ({ openid }) => home(openid),
  list: ({ openid, payload }) => list(openid, payload),
  mine: ({ openid }) => mine(openid),
  detail: ({ openid, payload }) => detail(cleanId(payload.id), openid),
  create: ({ openid, payload }) => create(payload, openid),
  requestPublish: ({ openid, payload }) => requestPublish(cleanId(payload.id), openid),
  delete: ({ openid, payload }) => remove(cleanId(payload.id), openid),
  toggleLike: ({ openid, payload }) => toggleLike(cleanId(payload.id), openid),
  toggleTagLike: ({ openid, payload }) => toggleTagLike(cleanId(payload.id), payload.tag, openid)
}

exports.main = async event => {
  try {
    const action = String(event && event.action || '')
    if (!Object.prototype.hasOwnProperty.call(actions, action)) {
      throw new ApiError('UNKNOWN_ACTION', '不支持的操作')
    }
    const { openid } = context()
    const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {}
    const data = await actions[action]({ openid, payload })
    return { ok: true, data }
  } catch (error) {
    console.error('memeApi failed', { code: error.code, message: error.message, stack: error.stack })
    const known = error instanceof ApiError
    return {
      ok: false,
      code: known ? error.code : 'INTERNAL_ERROR',
      message: known ? error.message : '服务暂时不可用，请稍后重试'
    }
  }
}
