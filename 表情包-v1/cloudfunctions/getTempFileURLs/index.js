const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const fileIDs = Array.isArray(event && event.fileIDs) ? event.fileIDs : []
  const validFileIDs = [...new Set(fileIDs.filter(fileID => typeof fileID === 'string' && fileID.startsWith('cloud://')))]

  if (!validFileIDs.length) {
    return { fileList: [] }
  }

  try {
    const res = await cloud.getTempFileURL({
      fileList: validFileIDs
    })
    return {
      fileList: Array.isArray(res.fileList) ? res.fileList : []
    }
  } catch (error) {
    console.error('getTempFileURLs failed:', error)
    return {
      fileList: validFileIDs.map(fileID => ({
        fileID,
        tempFileURL: '',
        status: -1,
        errMsg: error && error.message ? error.message : 'getTempFileURL failed'
      }))
    }
  }
}
