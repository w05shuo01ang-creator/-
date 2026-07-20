let sessionPromise = null

function call(action, payload = {}) {
  return wx.cloud.callFunction({
    name: 'memeApi',
    data: { action, payload }
  }).then(response => {
    const result = response && response.result
    if (!result || result.ok !== true) {
      const error = new Error((result && result.message) || '服务暂时不可用')
      error.code = result && result.code
      throw error
    }
    return result.data
  })
}

function bootstrap() {
  if (!sessionPromise) {
    sessionPromise = call('bootstrap').catch(error => {
      sessionPromise = null
      throw error
    })
  }
  return sessionPromise
}

function extensionOf(filePath) {
  const match = String(filePath || '').match(/\.([a-zA-Z0-9]+)$/)
  const extension = match ? match[1].toLowerCase() : 'jpg'
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension) ? extension : 'jpg'
}

async function uploadMeme({ filePath, prompt, tags }) {
  const session = await bootstrap()
  const cloudPath = [
    'uploads',
    session.ownerKey,
    `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${extensionOf(filePath)}`
  ].join('/')

  const uploaded = await wx.cloud.uploadFile({ cloudPath, filePath })
  try {
    return await call('create', { fileID: uploaded.fileID, prompt, tags })
  } catch (error) {
    wx.cloud.deleteFile({ fileList: [uploaded.fileID] }).catch(() => {})
    throw error
  }
}

function saveToAlbum(fileID, displayUrl) {
  const download = fileID && fileID.startsWith('cloud://')
    ? wx.cloud.downloadFile({ fileID }).then(result => result.tempFilePath)
    : new Promise((resolve, reject) => {
        wx.downloadFile({
          url: displayUrl,
          success: result => result.statusCode === 200 ? resolve(result.tempFilePath) : reject(new Error('下载失败')),
          fail: reject
        })
      })

  return download.then(filePath => new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject })
  }))
}

module.exports = {
  bootstrap,
  getHome: () => call('home'),
  listMemes: params => call('list', params),
  getMine: () => call('mine'),
  getDetail: id => call('detail', { id }),
  uploadMeme,
  requestPublish: id => call('requestPublish', { id }),
  deleteMeme: id => call('delete', { id }),
  toggleLike: id => call('toggleLike', { id }),
  toggleTagLike: (id, tag) => call('toggleTagLike', { id, tag }),
  saveToAlbum
}

