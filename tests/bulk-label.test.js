const assert = require('assert')
const {
  normalizeLabels,
  parseArgs,
  parseModelJson,
  promptFromFilename,
  selectBalanced,
  stripJpegMetadata,
  stripPngMetadata,
  uploadFilename,
  validateDimensions
} = require('../tools/bulk-label-images')

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  return Buffer.concat([length, typeBuffer, data, Buffer.alloc(4)])
}

function pngWithMetadata() {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const header = Buffer.alloc(13)
  header.writeUInt32BE(640, 0)
  header.writeUInt32BE(480, 4)
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('eXIf', Buffer.from('private-location')),
    pngChunk('IDAT', Buffer.from([0])),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function jpegWithMetadata() {
  const metadata = Buffer.from('Exif\0\0private-location', 'binary')
  const metadataLength = Buffer.alloc(2)
  metadataLength.writeUInt16BE(metadata.length + 2)
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    metadataLength,
    metadata,
    Buffer.from([0xff, 0xda, 0x00, 0x02, 0xff, 0xd9])
  ])
}

const png = stripPngMetadata(pngWithMetadata())
assert.strictEqual(png.metadataRemoved, true)
assert.strictEqual(png.buffer.includes(Buffer.from('private-location')), false)
assert.deepStrictEqual(validateDimensions(png), { width: 640, height: 480 })

const jpeg = stripJpegMetadata(jpegWithMetadata())
assert.strictEqual(jpeg.metadataRemoved, true)
assert.strictEqual(jpeg.buffer.includes(Buffer.from('private-location')), false)

assert.deepStrictEqual(
  normalizeLabels({ prompt: '  开心下班  ', tags: ['#开心', '开心', '下班', '冲刺', '办公室', '自由', '多余'] }),
  { prompt: '开心下班', tags: ['开心', '下班', '冲刺', '办公室', '自由'] }
)
assert.deepStrictEqual(
  parseModelJson('```json\n{"prompt":"无语地看着对方","tags":["无语","凝视"]}\n```'),
  { prompt: '无语地看着对方', tags: ['无语', '凝视'] }
)

assert.throws(() => parseArgs(['images', '--concurrency', '5']), /1 到 4/)
assert.strictEqual(parseArgs(['images', '--dry-run']).dryRun, true)
assert.strictEqual(parseArgs(['images', '--prompt-from-filename']).promptFromFilename, true)
assert.ok(parseArgs(['images', '--export-dir', '../upload']).exportDir.endsWith('upload'))
assert.strictEqual(promptFromFilename('回答/我真的会谢.jpg'), '我真的会谢')
assert.match(uploadFilename('回答/开心.jpg', 0, 'image/jpeg'), /^0001_开心_[a-f0-9]{8}\.jpg$/)
assert.notStrictEqual(
  uploadFilename('回答/开心.jpg', 0, 'image/jpeg'),
  uploadFilename('夸奖/开心.jpg', 0, 'image/jpeg')
)

const balanced = selectBalanced([
  'root/开心/1.jpg',
  'root/开心/2.jpg',
  'root/生气/1.jpg',
  'root/生气/2.jpg'
].map(value => require('path').resolve(value)), require('path').resolve('root'), 2)
assert.strictEqual(new Set(balanced.map(value => require('path').relative(require('path').resolve('root'), value).split(require('path').sep)[0])).size, 2)

console.log('bulk label tests passed')
