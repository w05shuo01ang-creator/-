const assert = require('assert')
const { matchBatchFiles, parseBatchManifest } = require('../miniprogram/utils/batch')

const manifest = JSON.stringify({
  version: 1,
  items: [
    { uploadFile: '0001_开心_a1b2c3d4.jpg', prompt: '开心', tags: ['开心', '#庆祝'], status: 'ready' },
    { uploadFile: 'ignored.png', prompt: '未完成', tags: [], status: 'checked' }
  ]
})

const parsed = parseBatchManifest(manifest)
assert.strictEqual(parsed.length, 1)
assert.deepStrictEqual(parsed[0].tags, ['开心', '庆祝'])

const matched = matchBatchFiles([
  { name: '0001_开心_a1b2c3d4.jpg', path: 'wxfile://tmp/image.jpg', size: 1024 }
], parsed)
assert.strictEqual(matched[0].prompt, '开心')
assert.strictEqual(matched[0].filePath, 'wxfile://tmp/image.jpg')

const tagless = parseBatchManifest(JSON.stringify({
  version: 1,
  items: [{ uploadFile: '0002_tagless.png', prompt: '无标签表情', tags: [], allowEmptyTags: true, status: 'ready' }]
}))
assert.deepStrictEqual(tagless[0].tags, [])
assert.strictEqual(tagless[0].allowEmptyTags, true)
assert.throws(() => parseBatchManifest(JSON.stringify({
  version: 1,
  items: [{ uploadFile: '0003_invalid.png', prompt: '无标签表情', tags: [], status: 'ready' }]
})), /缺少标签/)

assert.throws(() => parseBatchManifest('{bad json'), /JSON/)
assert.throws(() => parseBatchManifest(JSON.stringify({
  version: 1,
  items: [{ uploadFile: '../bad.jpg', prompt: 'bad', tags: ['bad'], status: 'ready' }]
})), /文件名/)
assert.throws(() => matchBatchFiles([
  { name: 'unknown.jpg', path: 'wxfile://tmp/unknown.jpg', size: 100 }
], parsed), /不在清单/)

console.log('batch import tests passed')
