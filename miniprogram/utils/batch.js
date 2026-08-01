const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_BATCH_FILES = 100

function cleanText(value, maximum) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum)
}

function cleanTags(value) {
  const tags = []
  ;(Array.isArray(value) ? value : []).forEach(item => {
    const tag = cleanText(item, 10).replace(/^#+/, '')
    if (tag && !tags.includes(tag) && tags.length < 5) tags.push(tag)
  })
  return tags
}

function parseBatchManifest(text) {
  let manifest
  try {
    manifest = JSON.parse(String(text || ''))
  } catch (error) {
    throw new Error('批量清单不是有效的 JSON 文件')
  }
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.items)) {
    throw new Error('批量清单格式或版本不正确')
  }

  const names = new Set()
  const items = []
  manifest.items.forEach(item => {
    if (!item || item.status !== 'ready') return
    const uploadFile = cleanText(item.uploadFile, 160)
    if (!uploadFile || /[\\/]/.test(uploadFile) || !/\.(jpe?g|png)$/i.test(uploadFile)) {
      throw new Error('清单中存在无效的上传文件名')
    }
    const key = uploadFile.toLowerCase()
    if (names.has(key)) throw new Error(`清单中存在重复文件名：${uploadFile}`)
    const prompt = cleanText(item.prompt, 60)
    const tags = cleanTags(item.tags)
    if (!prompt) throw new Error(`图片 ${uploadFile} 缺少描述`)
    if (!tags.length) throw new Error(`图片 ${uploadFile} 缺少标签`)
    names.add(key)
    items.push({ uploadFile, prompt, tags })
  })
  if (!items.length) throw new Error('清单中没有可上传的 ready 图片')
  return items
}

function matchBatchFiles(files, manifestItems) {
  const selected = Array.isArray(files) ? files : []
  if (!selected.length) throw new Error('没有选择图片')
  if (selected.length > MAX_BATCH_FILES) throw new Error(`每批最多选择 ${MAX_BATCH_FILES} 张图片`)
  const manifestMap = new Map(manifestItems.map(item => [item.uploadFile.toLowerCase(), item]))
  const selectedNames = new Set()
  const missing = []
  const matched = []

  selected.forEach(file => {
    const name = cleanText(file && file.name, 160)
    const key = name.toLowerCase()
    if (!name || !/\.(jpe?g|png)$/i.test(name)) throw new Error('选择内容中包含非 JPG/PNG 文件')
    if (selectedNames.has(key)) throw new Error(`选择了重名文件：${name}`)
    selectedNames.add(key)
    const item = manifestMap.get(key)
    if (!item) {
      missing.push(name)
      return
    }
    const filePath = file.path || file.tempFilePath
    if (!filePath) throw new Error(`无法读取图片：${name}`)
    if (Number(file.size) > MAX_FILE_SIZE) throw new Error(`图片超过 5 MB：${name}`)
    matched.push({ ...item, filePath, size: Number(file.size) || 0 })
  })

  if (missing.length) throw new Error(`以下图片不在清单中：${missing.slice(0, 3).join('、')}`)
  return matched
}

module.exports = { cleanTags, matchBatchFiles, parseBatchManifest }
