const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const sourcePath = path.join(__dirname, '..', 'cloudfunctions', 'memeApi', 'index.js')
const source = fs.readFileSync(sourcePath, 'utf8')
const sandbox = {
  Buffer,
  console,
  exports: {},
  module: { exports: {} },
  require(name) {
    if (name === 'crypto') return crypto
    if (name === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() { return { command: {} } },
        getWXContext() { return { OPENID: 'test-openid' } }
      }
    }
    return require(name)
  }
}

vm.runInNewContext(`${source}\nexports.__test = { inspectImage, moderationResult }`, sandbox)
const { inspectImage, moderationResult } = sandbox.exports.__test

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  return Buffer.concat([length, typeBuffer, data, Buffer.alloc(4)])
}

function png(width, height, metadata = false) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const chunks = [pngChunk('IHDR', ihdr)]
  if (metadata) chunks.push(pngChunk('eXIf', Buffer.from('private')))
  chunks.push(pngChunk('IDAT', Buffer.from([0])), pngChunk('IEND', Buffer.alloc(0)))
  return Buffer.concat([signature, ...chunks])
}

function jpeg(width, height, metadata = false) {
  const parts = [Buffer.from([0xff, 0xd8])]
  if (metadata) {
    const exif = Buffer.from('Exif\0\0private', 'binary')
    const length = Buffer.alloc(2)
    length.writeUInt16BE(exif.length + 2)
    parts.push(Buffer.from([0xff, 0xe1]), length, exif)
  }
  const frame = Buffer.alloc(15)
  frame[0] = 8
  frame.writeUInt16BE(height, 1)
  frame.writeUInt16BE(width, 3)
  frame[5] = 3
  const frameLength = Buffer.alloc(2)
  frameLength.writeUInt16BE(frame.length + 2)
  parts.push(Buffer.from([0xff, 0xc0]), frameLength, frame, Buffer.from([0xff, 0xd9]))
  return Buffer.concat(parts)
}

const validPng = inspectImage(png(640, 480))
assert.strictEqual(validPng.mimeType, 'image/png')
assert.strictEqual(validPng.width, 640)
assert.strictEqual(validPng.height, 480)

const validJpeg = inspectImage(jpeg(800, 600))
assert.strictEqual(validJpeg.mimeType, 'image/jpeg')
assert.strictEqual(validJpeg.width, 800)
assert.strictEqual(validJpeg.height, 600)

assert.throws(() => inspectImage(png(640, 480, true)), /元数据/)
assert.throws(() => inspectImage(jpeg(800, 600, true)), /元数据/)
assert.throws(() => inspectImage(png(5000, 100)), /边长/)
assert.throws(() => inspectImage(Buffer.from('not an image')), /JPG 或 PNG/)

assert.strictEqual(moderationResult({ errCode: 0, result: { suggest: 'pass' } }).decision, 'pass')
assert.strictEqual(moderationResult({ errCode: 0, result: { suggest: 'risky' } }).decision, 'reject')
assert.strictEqual(moderationResult({ errCode: 0, result: { suggest: 'review' } }).decision, 'manual')
assert.strictEqual(moderationResult({ errCode: 0 }, true).decision, 'pass')

console.log('security tests passed')
