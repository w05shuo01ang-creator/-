const api = require('../../utils/api')
const { matchBatchFiles, parseBatchManifest } = require('../../utils/batch')
const { buildMineView } = require('../../utils/mine')
const { messageOf } = require('../../utils/view')

function readTextFile(filePath) {
  if (!filePath) return Promise.reject(new Error('微信没有返回批量清单的临时路径'))
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'utf8',
      success: result => resolve(result.data),
      fail: reject
    })
  })
}

function batchErrorMessage(error) {
  if (error && error.message) return error.message
  const wxMessage = String(error && error.errMsg || '').replace(/^[^:]+:fail\s*/i, '').trim()
  return wxMessage || '读取批量文件失败'
}

function fsCall(method, options) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager()[method]({ ...options, success: resolve, fail: reject })
  })
}

function listFiles(rootPath) {
  const manager = wx.getFileSystemManager()
  const files = []
  function walk(directory) {
    manager.readdirSync(directory).forEach(name => {
      const filePath = `${directory}/${name}`
      const stats = manager.statSync(filePath)
      if (stats.isDirectory()) walk(filePath)
      else files.push({ name, path: filePath, size: Number(stats.size) || 0 })
    })
  }
  walk(rootPath)
  return files
}

async function readBatchArchive(archiveFile) {
  if (Number(archiveFile.size) > 100 * 1024 * 1024) throw new Error('批量压缩包不能超过 100 MB')
  const zipFilePath = archiveFile.path || archiveFile.tempFilePath
  if (!zipFilePath) throw new Error('微信没有返回压缩包的临时路径')
  const targetPath = `${wx.env.USER_DATA_PATH}/batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  await fsCall('mkdir', { dirPath: targetPath, recursive: true })
  try {
    await fsCall('unzip', { zipFilePath, targetPath })
    const files = listFiles(targetPath)
    const manifests = files.filter(file => file.name.toLowerCase() === 'memecraft-labels.json')
    if (manifests.length !== 1) throw new Error('ZIP 中必须包含一个 memecraft-labels.json')
    const manifestItems = parseBatchManifest(await readTextFile(manifests[0].path))
    const expectedNames = new Set(manifestItems.map(item => item.uploadFile.toLowerCase()))
    const images = files.filter(file => expectedNames.has(file.name.toLowerCase()))
    const matched = matchBatchFiles(images, manifestItems)
    if (matched.length !== manifestItems.length) {
      throw new Error(`ZIP 图片不完整：需要 ${manifestItems.length} 张，实际找到 ${matched.length} 张`)
    }
    return { matched, targetPath }
  } catch (error) {
    fsCall('rmdir', { dirPath: targetPath, recursive: true }).catch(() => {})
    throw error
  }
}

Page({
  data: {
    loading: true,
    items: [],
    totalItems: 0,
    hasMore: false,
    loadingMore: false,
    currentTab: 'private',
    filtered: [],
    tabCounts: { private: 0, review: 0, public: 0 },
    searchQuery: '',
    activeTag: '',
    tagFilters: [],
    showUpload: false,
    uploading: false,
    batchUploadEnabled: false,
    batchUploading: false,
    batchProgress: '',
    filePath: '',
    prompt: '',
    tagInput: '',
    tags: []
  },

  onShow() {
    if (!this.data.items.length || Date.now() - Number(this.lastLoadedAt || 0) > 15 * 1000) this.load()
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const data = await api.getMine({ offset: 0, limit: 30 })
      this.setData({
        items: data.items || [],
        totalItems: Number(data.total) || 0,
        hasMore: data.hasMore === true,
        batchUploadEnabled: data.batchUploadEnabled === true
      })
      this.lastLoadedAt = Date.now()
      this.filterItems()
    } catch (error) {
      wx.showToast({ title: messageOf(error, '加载失败'), icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  changeTab(event) {
    this.setData({ currentTab: event.currentTarget.dataset.tab, activeTag: '' })
    this.filterItems()
  },

  filterItems() {
    const view = buildMineView(this.data.items, this.data.currentTab, this.data.searchQuery, this.data.activeTag)
    this.setData({
      filtered: view.filtered,
      tabCounts: view.counts,
      tagFilters: view.tagFilters,
      activeTag: view.activeTag
    })
  },

  async loadMore() {
    if (!this.data.hasMore || this.data.loadingMore) return
    this.setData({ loadingMore: true })
    try {
      const data = await api.getMine({ offset: this.data.items.length, limit: 30 })
      const existingIds = new Set(this.data.items.map(item => item._id))
      const additions = (data.items || []).filter(item => !existingIds.has(item._id))
      this.setData({
        items: this.data.items.concat(additions),
        totalItems: Number(data.total) || this.data.totalItems,
        hasMore: data.hasMore === true
      })
      this.filterItems()
    } catch (error) {
      wx.showToast({ title: messageOf(error, '加载更多失败'), icon: 'none' })
    } finally {
      this.setData({ loadingMore: false })
    }
  },

  onSearchInput(event) {
    this.setData({ searchQuery: event.detail.value })
    this.filterItems()
  },

  clearSearch() {
    this.setData({ searchQuery: '' })
    this.filterItems()
  },

  selectFilterTag(event) {
    this.setData({ activeTag: event.currentTarget.dataset.key || '' })
    this.filterItems()
  },

  openAiCreate() {
    wx.navigateTo({ url: '/pages/ai-create/ai-create' })
  },

  showUpload() {
    this.setData({
      showUpload: true,
      filePath: '',
      prompt: '',
      tagInput: '',
      tags: []
    })
  },

  hideUpload() {
    if (!this.data.uploading) this.setData({ showUpload: false })
  },

  stopBubble() {},

  async chooseImage() {
    try {
      const result = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera']
      })
      const file = result.tempFiles[0]
      if (file.size > 5 * 1024 * 1024) {
        wx.showToast({ title: '图片不能超过 5 MB', icon: 'none' })
        return
      }
      this.setData({ filePath: file.tempFilePath })
    } catch (error) {
      if (!String(error.errMsg || '').includes('cancel')) {
        wx.showToast({ title: '选择图片失败', icon: 'none' })
      }
    }
  },

  onPrompt(event) {
    this.setData({ prompt: event.detail.value })
  },

  onTagInput(event) {
    this.setData({ tagInput: event.detail.value })
  },

  addTag() {
    const tag = this.data.tagInput.trim()
    if (!tag) return
    if (tag.length > 10) return wx.showToast({ title: '标签最多 10 个字', icon: 'none' })
    if (this.data.tags.includes(tag)) return wx.showToast({ title: '标签已经存在', icon: 'none' })
    if (this.data.tags.length >= 5) return wx.showToast({ title: '最多添加 5 个标签', icon: 'none' })
    this.setData({ tags: this.data.tags.concat(tag), tagInput: '' })
  },

  removeTag(event) {
    const index = Number(event.currentTarget.dataset.index)
    this.setData({ tags: this.data.tags.filter((_, itemIndex) => itemIndex !== index) })
  },

  async upload() {
    if (!this.data.filePath) return wx.showToast({ title: '请先选择图片', icon: 'none' })
    this.setData({ uploading: true })
    try {
      await api.uploadMeme({
        filePath: this.data.filePath,
        prompt: this.data.prompt.trim(),
        tags: this.data.tags
      })
      wx.showToast({ title: '已保存到私密区', icon: 'success' })
      this.setData({ showUpload: false, currentTab: 'private' })
      await this.load()
    } catch (error) {
      wx.showToast({ title: messageOf(error, '上传失败'), icon: 'none' })
    } finally {
      this.setData({ uploading: false })
    }
  },

  async startBatchUpload() {
    if (this.data.batchUploading || this.data.uploading) return
    let unpackedDirectory = ''
    try {
      const manifestResult = await wx.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: ['json', 'zip']
      })
      const manifestFile = manifestResult.tempFiles && manifestResult.tempFiles[0]
      if (!manifestFile) return
      const selectedName = String(manifestFile.name || manifestFile.path || manifestFile.tempFilePath || '')
      let matched
      if (/\.zip$/i.test(selectedName)) {
        const archive = await readBatchArchive(manifestFile)
        matched = archive.matched
        unpackedDirectory = archive.targetPath
      } else {
        if (Number(manifestFile.size) > 2 * 1024 * 1024) throw new Error('批量清单不能超过 2 MB')
        const manifestPath = manifestFile.path || manifestFile.tempFilePath
        const manifestItems = parseBatchManifest(await readTextFile(manifestPath))
        const fileResult = await wx.chooseMessageFile({
          count: Math.min(100, manifestItems.length),
          type: 'file',
          extension: ['jpg', 'jpeg', 'png']
        })
        matched = matchBatchFiles(fileResult.tempFiles, manifestItems)
      }
      const confirmation = await wx.showModal({
        title: `导入 ${matched.length} 张表情`,
        content: '将逐张上传并自动提交内容审核。处理期间请保持本页和网络连接。',
        confirmText: '开始导入'
      })
      if (!confirmation.confirm) return
      await this.runBatchUpload(matched)
    } catch (error) {
      if (!String(error.errMsg || '').includes('cancel')) {
        wx.showModal({ title: '无法批量导入', content: batchErrorMessage(error), showCancel: false })
      }
    } finally {
      if (unpackedDirectory) {
        fsCall('rmdir', { dirPath: unpackedDirectory, recursive: true }).catch(() => {})
      }
    }
  },

  async runBatchUpload(items) {
    this.batchStopRequested = false
    this.setData({ batchUploading: true, batchProgress: `准备上传 0/${items.length}` })
    wx.setKeepScreenOn({ keepScreenOn: true })
    let uploaded = 0
    let approved = 0
    let notApproved = 0
    let privateOnly = 0
    const uploadFailures = []

    try {
      for (let index = 0; index < items.length; index++) {
        if (this.batchStopRequested) break
        const item = items[index]
        this.setData({ batchProgress: `正在上传 ${index + 1}/${items.length}` })
        try {
          const created = await api.uploadMeme({
            filePath: item.filePath,
            prompt: item.prompt,
            tags: item.tags,
            allowEmptyTags: item.allowEmptyTags
          })
          uploaded++
          this.setData({ batchProgress: `正在审核 ${index + 1}/${items.length}` })
          try {
            const review = await api.requestPublish(created.id)
            if (review.status === 'approved') approved++
            else notApproved++
          } catch (error) {
            privateOnly++
          }
        } catch (error) {
          uploadFailures.push(`${item.uploadFile}：${messageOf(error, '上传失败')}`)
          if (['STORAGE_LIMITED', 'UPLOAD_LIMITED'].includes(error.code)) {
            this.batchStopRequested = true
          }
        }
      }
    } finally {
      wx.setKeepScreenOn({ keepScreenOn: false })
      const stopped = this.batchStopRequested
      this.setData({ batchUploading: false, batchProgress: '' })
      this.batchStopRequested = false
      const summary = [
        `已上传 ${uploaded} 张`,
        `自动公开 ${approved} 张`,
        `未自动公开 ${notApproved} 张`,
        `仅保存私密 ${privateOnly} 张`,
        `上传失败 ${uploadFailures.length} 张`
      ]
      if (stopped) summary.push('任务已停止')
      if (uploadFailures.length) summary.push(`首个问题：${uploadFailures[0]}`)
      await wx.showModal({ title: '批量导入结束', content: summary.join('\n'), showCancel: false })
      this.setData({ currentTab: approved ? 'public' : notApproved ? 'review' : 'private' })
      await this.load()
    }
  },

  stopBatchUpload() {
    this.batchStopRequested = true
    this.setData({ batchProgress: '将在当前图片处理完成后停止' })
  },

  openDetail(event) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` })
  },

  preview(event) {
    const url = event.currentTarget.dataset.url
    wx.previewImage({ current: url, urls: [url] })
  },

  publish(event) {
    const id = event.currentTarget.dataset.id
    wx.showModal({
      title: '申请公开',
      content: '提交后将进入内容审核，通过后才会出现在发现页。',
      confirmText: '提交审核',
      success: async result => {
        if (!result.confirm) return
        try {
          const review = await api.requestPublish(id)
          const approved = review.status === 'approved'
          const title = approved ? '审核通过并公开' : review.status === 'rejected' ? '审核未通过' : '已转人工审核'
          wx.showToast({ title, icon: approved ? 'success' : 'none' })
          this.setData({ currentTab: approved ? 'public' : 'review' })
          await this.load()
        } catch (error) {
          wx.showToast({ title: messageOf(error, '提交失败'), icon: 'none' })
        }
      }
    })
  },

  save(event) {
    const item = event.currentTarget.dataset.item
    wx.showLoading({ title: '保存中' })
    api.saveToAlbum(item.fileID, item.displayUrl)
      .then(() => wx.showToast({ title: '已保存', icon: 'success' }))
      .catch(error => {
        if (String(error.errMsg || '').includes('auth')) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许保存图片到相册。',
            success: result => result.confirm && wx.openSetting()
          })
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      })
      .finally(wx.hideLoading)
  },

  remove(event) {
    const id = event.currentTarget.dataset.id
    wx.showModal({
      title: '删除表情',
      content: '数据库记录和云存储文件都会被删除，且无法恢复。',
      confirmColor: '#f04458',
      success: async result => {
        if (!result.confirm) return
        try {
          await api.deleteMeme(id)
          wx.showToast({ title: '已删除', icon: 'success' })
          await this.load()
        } catch (error) {
          wx.showToast({ title: messageOf(error, '删除失败'), icon: 'none' })
        }
      }
    })
  },

  onUnload() {
    this.batchStopRequested = true
  }
})
