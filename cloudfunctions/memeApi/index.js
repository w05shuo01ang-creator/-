const crypto = require('crypto')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const command = db.command
const MEMES = 'memes'
const LIKES = 'likes'
const TAG_LIKES = 'tag_likes'
const RATE_LIMITS = 'rate_limits'
const MODERATION_AUDITS = 'moderation_audits'
const REPORTS = 'reports'
const BLOCKED_USERS = 'blocked_users'
const MAX_PAGE_SIZE = 30
const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_IMAGE_EDGE = 4096
const MAX_IMAGE_PIXELS = 16 * 1024 * 1024
const MAX_USER_MEMES = 100
const DAILY_UPLOAD_COUNT = 10
const DAILY_UPLOAD_BYTES = 25 * 1024 * 1024

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

function readJpegInfo(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  let width = 0
  let height = 0

  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++
      continue
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset++
    const marker = buffer[offset++]
    if (marker === 0xd9 || marker === 0xda) break
    if (marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 2 > buffer.length) break

    const segmentLength = buffer.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break
    if (marker === 0xe1) {
      throw new ApiError('IMAGE_METADATA', '图片包含位置或设备元数据，请截图后重新上传')
    }

    const isStartOfFrame = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)
    if (isStartOfFrame && segmentLength >= 7) {
      height = buffer.readUInt16BE(offset + 3)
      width = buffer.readUInt16BE(offset + 5)
      break
    }
    offset += segmentLength
  }

  return width && height ? { mimeType: 'image/jpeg', width, height } : null
}

function readPngInfo(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new ApiError('INVALID_FILE', 'PNG 文件缺少有效的图片头')
  }

  const metadataChunks = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt'])
  let offset = 8
  let hasImageData = false
  let hasEnd = false
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    if (metadataChunks.has(type)) {
      throw new ApiError('IMAGE_METADATA', '图片包含附加元数据，请截图后重新上传')
    }
    if (type === 'IDAT') hasImageData = true
    offset += 12 + length
    if (type === 'IEND') {
      hasEnd = true
      break
    }
    if (offset > buffer.length) throw new ApiError('INVALID_FILE', 'PNG 文件结构无效')
  }
  if (!hasImageData || !hasEnd) throw new ApiError('INVALID_FILE', 'PNG 文件内容不完整')

  return {
    mimeType: 'image/png',
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  }
}

function inspectImage(fileContent) {
  const buffer = Buffer.isBuffer(fileContent) ? fileContent : Buffer.from(fileContent || [])
  if (!buffer.length || buffer.length > MAX_FILE_SIZE) {
    throw new ApiError('FILE_TOO_LARGE', '图片必须小于 5 MB')
  }

  const image = readPngInfo(buffer) || readJpegInfo(buffer)
  if (!image) throw new ApiError('INVALID_FILE_TYPE', '仅支持真实的 JPG 或 PNG 图片')
  if (image.width < 32 || image.height < 32 || image.width > MAX_IMAGE_EDGE || image.height > MAX_IMAGE_EDGE) {
    throw new ApiError('INVALID_DIMENSIONS', '图片边长必须在 32 到 4096 像素之间')
  }
  if (image.width * image.height > MAX_IMAGE_PIXELS) {
    throw new ApiError('TOO_MANY_PIXELS', '图片总像素不能超过 1600 万')
  }

  return {
    ...image,
    fileSize: buffer.length,
    contentHash: crypto.createHash('sha256').update(buffer).digest('hex'),
    buffer
  }
}

function limitBucket(windowMs) {
  return Math.floor(Date.now() / windowMs)
}

async function assertNotBlocked(openid) {
  const result = await db.collection(BLOCKED_USERS).where({ openid, active: true }).limit(1).get()
  if (result.data && result.data.length) throw new ApiError('ACCOUNT_BLOCKED', '该账号已被限制操作')
}

async function consumeRateLimit(openid, action, maximum, windowMs) {
  const bucket = limitBucket(windowMs)
  const id = digest(`rate:${openid}:${action}:${bucket}`)
  return db.runTransaction(async transaction => {
    let current = 0
    try {
      const result = await transaction.collection(RATE_LIMITS).doc(id).get()
      current = Number(result.data.count) || 0
    } catch (error) {
      current = 0
    }
    if (current >= maximum) throw new ApiError('RATE_LIMITED', '操作过于频繁，请稍后再试')
    await transaction.collection(RATE_LIMITS).doc(id).set({
      data: {
        _openid: openid,
        action,
        bucket,
        count: current + 1,
        expiresAt: new Date(Date.now() + windowMs * 2),
        updatedAt: db.serverDate()
      }
    })
  })
}

async function consumeUploadQuota(openid, fileSize) {
  const day = new Date().toISOString().slice(0, 10)
  const id = digest(`upload:${openid}:${day}`)
  return db.runTransaction(async transaction => {
    let usage = { count: 0, bytes: 0 }
    try {
      const result = await transaction.collection(RATE_LIMITS).doc(id).get()
      usage = result.data || usage
    } catch (error) {
      usage = { count: 0, bytes: 0 }
    }

    if ((Number(usage.count) || 0) + 1 > DAILY_UPLOAD_COUNT) {
      throw new ApiError('UPLOAD_LIMITED', '今日上传次数已用完')
    }
    if ((Number(usage.bytes) || 0) + fileSize > DAILY_UPLOAD_BYTES) {
      throw new ApiError('UPLOAD_LIMITED', '今日上传容量已用完')
    }

    await transaction.collection(RATE_LIMITS).doc(id).set({
      data: {
        _openid: openid,
        action: 'upload',
        day,
        count: (Number(usage.count) || 0) + 1,
        bytes: (Number(usage.bytes) || 0) + fileSize,
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        updatedAt: db.serverDate()
      }
    })
  })
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
    auto_reviewing: '自动审核中',
    manual_review: '等待人工复核',
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

  const ownedCount = await db.collection(MEMES).where({ _openid: openid }).count()
  if (ownedCount.total >= MAX_USER_MEMES) {
    throw new ApiError('STORAGE_LIMITED', `每个账号最多保留 ${MAX_USER_MEMES} 张表情`)
  }

  const downloaded = await cloud.downloadFile({ fileID })
  const inspected = inspectImage(downloaded.fileContent)
  const duplicate = await db.collection(MEMES)
    .where({ _openid: openid, contentHash: inspected.contentHash })
    .limit(1)
    .get()
  if (duplicate.data && duplicate.data.length) {
    throw new ApiError('DUPLICATE_IMAGE', '这张图片已经上传过了')
  }
  await consumeUploadQuota(openid, inspected.fileSize)

  const tags = cleanTags(payload.tags)
  const prompt = cleanText(payload.prompt, 60) || tags.join(' ')
  const now = db.serverDate()
  const result = await db.collection(MEMES).add({
    data: {
      _openid: openid,
      fileID,
      contentHash: inspected.contentHash,
      fileSize: inspected.fileSize,
      mimeType: inspected.mimeType,
      width: inspected.width,
      height: inspected.height,
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

function moderationResult(result, legacyPassOnZero = false) {
  const code = Number(result && (result.errCode ?? result.errcode ?? result.err_code))
  const suggest = result && result.result && result.result.suggest
  if (suggest === 'pass') return { decision: 'pass', code, suggest }
  if (suggest === 'risky' || code === 87014) return { decision: 'reject', code, suggest }
  if (suggest === 'review') return { decision: 'manual', code, suggest }
  if (legacyPassOnZero && code === 0) return { decision: 'pass', code, suggest: suggest || '' }
  return { decision: 'manual', code: Number.isFinite(code) ? code : null, suggest: suggest || '' }
}

async function writeAudit(data) {
  try {
    await db.collection(MODERATION_AUDITS).add({
      data: { ...data, createdAt: db.serverDate() }
    })
  } catch (error) {
    console.error('failed to write moderation audit', { data, error })
  }
}

async function updateReview(id, status, details) {
  await db.collection(MEMES).doc(id).update({
    data: {
      isPublic: status === 'approved',
      reviewStatus: status,
      moderation: details,
      updatedAt: db.serverDate()
    }
  })
}

async function autoModerate(item, openid) {
  const auditBase = { memeId: item._id, ownerOpenidHash: digest(openid, 16), source: 'wechat-security' }
  let stage = 'download'
  try {
    const downloaded = await cloud.downloadFile({ fileID: item.fileID })
    const image = inspectImage(downloaded.fileContent)
    const text = cleanText(`${item.prompt || ''} ${(item.tags || []).join(' ')}`, 120)

    stage = 'text-check'
    const textResponse = await cloud.openapi.security.msgSecCheck({
      content: text,
      version: 2,
      scene: 2,
      openid
    })
    const textCheck = moderationResult(textResponse)
    if (textCheck.decision === 'reject') {
      const details = { decision: 'reject', reason: 'text', textCheck, reviewedAt: new Date() }
      await updateReview(item._id, 'rejected', details)
      await writeAudit({ ...auditBase, ...details })
      return { status: 'rejected' }
    }

    stage = 'image-check'
    const imageResponse = await cloud.openapi.security.imgSecCheck({
      media: {
        contentType: image.mimeType,
        value: image.buffer
      }
    })
    const imageCheck = moderationResult(imageResponse, true)
    const decision = textCheck.decision === 'pass' && imageCheck.decision === 'pass'
      ? 'approved'
      : imageCheck.decision === 'reject'
        ? 'rejected'
        : 'manual_review'
    const details = {
      decision,
      reason: decision === 'approved' ? 'automatic-pass' : decision === 'rejected' ? 'image' : 'uncertain',
      textCheck,
      imageCheck,
      reviewedAt: new Date()
    }
    await updateReview(item._id, decision, details)
    await writeAudit({ ...auditBase, ...details })
    return { status: decision }
  } catch (error) {
    const moderationCode = Number(error && (error.errCode || error.errcode || error.err_code || error.code))
    if (moderationCode === 87014) {
      const details = {
        decision: 'reject',
        reason: 'security-api-rejected',
        stage,
        errorCode: moderationCode,
        reviewedAt: new Date()
      }
      await updateReview(item._id, 'rejected', details)
      await writeAudit({ ...auditBase, ...details })
      return { status: 'rejected' }
    }
    const details = {
      decision: 'manual_review',
      reason: 'moderation-unavailable',
      stage,
      errorCode: cleanText(error && (error.errCode || error.code || error.message), 80),
      reviewedAt: new Date()
    }
    await updateReview(item._id, 'manual_review', details)
    await writeAudit({ ...auditBase, ...details })
    console.error('automatic moderation unavailable', { memeId: item._id, error })
    return { status: 'manual_review' }
  }
}

async function requestPublish(id, openid) {
  const item = await getOwnedOrPublic(id, openid)
  if (item._openid !== openid) throw new ApiError('FORBIDDEN', '只能发布自己的表情')
  if (!['private', 'rejected'].includes(item.reviewStatus)) {
    throw new ApiError('INVALID_STATE', '当前状态不能重复提交')
  }

  await consumeRateLimit(openid, 'publish', 10, 24 * 60 * 60 * 1000)

  await db.collection(MEMES).doc(id).update({
    data: {
      isPublic: false,
      reviewStatus: 'auto_reviewing',
      updatedAt: db.serverDate()
    }
  })
  return autoModerate({ ...item, _id: id }, openid)
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
  await consumeRateLimit(openid, 'like', 60, 60 * 1000)
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
  await consumeRateLimit(openid, 'tag-like', 60, 60 * 1000)

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

async function reportMeme(id, reasonValue, openid) {
  const reasons = ['违法或不良内容', '侵犯版权或肖像权', '泄露个人隐私', '垃圾广告', '其他问题']
  const reason = cleanText(reasonValue, 20)
  if (!reasons.includes(reason)) throw new ApiError('INVALID_ARGUMENT', '无效的举报原因')
  await consumeRateLimit(openid, 'report', 5, 24 * 60 * 60 * 1000)

  const item = await getOwnedOrPublic(id, openid)
  if (item._openid === openid) throw new ApiError('INVALID_ARGUMENT', '不能举报自己的内容')
  if (item.isPublic !== true || item.reviewStatus !== 'approved') {
    throw new ApiError('INVALID_STATE', '该内容当前不可举报')
  }

  const reportId = digest(`report:${openid}:${id}`)
  try {
    await db.collection(REPORTS).doc(reportId).get()
    throw new ApiError('ALREADY_REPORTED', '你已经举报过这条内容')
  } catch (error) {
    if (error instanceof ApiError) throw error
  }

  await db.collection(REPORTS).doc(reportId).set({
    data: {
      _openid: openid,
      memeId: id,
      ownerOpenidHash: digest(item._openid, 16),
      reason,
      status: 'open',
      createdAt: db.serverDate()
    }
  })
  const countResult = await db.collection(REPORTS).where({ memeId: id, status: 'open' }).count()
  const reportCount = countResult.total || 0

  if (reportCount >= 3) {
    const moderation = {
      decision: 'manual_review',
      reason: 'community-reports',
      reportCount,
      reviewedAt: new Date()
    }
    await updateReview(id, 'manual_review', moderation)
    await writeAudit({
      memeId: id,
      ownerOpenidHash: digest(item._openid, 16),
      source: 'community-reports',
      ...moderation
    })
  }

  return { submitted: true, hidden: reportCount >= 3 }
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
  toggleTagLike: ({ openid, payload }) => toggleTagLike(cleanId(payload.id), payload.tag, openid),
  report: ({ openid, payload }) => reportMeme(cleanId(payload.id), payload.reason, openid)
}

exports.main = async event => {
  try {
    const action = String(event && event.action || '')
    if (!Object.prototype.hasOwnProperty.call(actions, action)) {
      throw new ApiError('UNKNOWN_ACTION', '不支持的操作')
    }
    const { openid } = context()
    const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {}
    if (['create', 'requestPublish', 'toggleLike', 'toggleTagLike', 'report'].includes(action)) {
      await assertNotBlocked(openid)
    }
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
