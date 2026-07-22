#!/usr/bin/env node

const crypto = require('crypto')
const fs = require('fs')
const https = require('https')
const path = require('path')

const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_IMAGE_EDGE = 4096
const MAX_IMAGE_PIXELS = 16 * 1024 * 1024
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png'])

function usage() {
  return `
用法：
  node tools/bulk-label-images.js <图片目录> [选项]

选项：
  --output <文件>       JSON 输出路径（默认：<图片目录>/memecraft-labels.json）
  --csv <文件>          同时输出便于人工检查的 CSV
  --concurrency <数量>  并发请求数，1-4（默认：2）
  --limit <数量>        本次最多处理多少张图片
  --force               忽略已有成功结果并重新分析
  --dry-run             只检查图片，不调用视觉模型
  --help                显示帮助

环境变量：
  VISION_API_URL        兼容 Chat Completions 的 HTTPS 地址
  VISION_API_KEY        API 密钥
  VISION_MODEL          支持图片理解的模型名称
`.trim()
}

function parseArgs(argv) {
  const options = { concurrency: 2, force: false, dryRun: false }
  const positional = []
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === '--help') options.help = true
    else if (argument === '--force') options.force = true
    else if (argument === '--dry-run') options.dryRun = true
    else if (['--output', '--csv', '--concurrency', '--limit'].includes(argument)) {
      if (!argv[index + 1]) throw new Error(`${argument} 缺少参数`)
      options[argument.slice(2)] = argv[++index]
    } else if (argument.startsWith('--')) {
      throw new Error(`未知选项：${argument}`)
    } else {
      positional.push(argument)
    }
  }

  if (options.help) return options
  if (positional.length !== 1) throw new Error('请提供一个图片目录')
  options.input = path.resolve(positional[0])
  options.output = path.resolve(options.output || path.join(options.input, 'memecraft-labels.json'))
  if (options.csv) options.csv = path.resolve(options.csv)
  options.concurrency = Number(options.concurrency)
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 4) {
    throw new Error('--concurrency 必须是 1 到 4 的整数')
  }
  if (options.limit !== undefined) {
    options.limit = Number(options.limit)
    if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error('--limit 必须是正整数')
  }
  return options
}

function listImages(root) {
  const files = []
  function walk(directory) {
    fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
      .forEach(entry => {
        const fullPath = path.join(directory, entry.name)
        if (entry.isDirectory()) walk(fullPath)
        else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath)
      })
  }
  walk(root)
  return files
}

function stripJpegMetadata(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  const output = [buffer.subarray(0, 2)]
  let offset = 2
  let removed = false

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return null
    const markerStart = offset
    while (offset < buffer.length && buffer[offset] === 0xff) offset++
    if (offset >= buffer.length) return null
    const marker = buffer[offset++]
    if (marker === 0xda) {
      output.push(buffer.subarray(markerStart))
      return { buffer: Buffer.concat(output), metadataRemoved: removed, mimeType: 'image/jpeg' }
    }
    if (marker === 0xd9) {
      output.push(buffer.subarray(markerStart, offset))
      return { buffer: Buffer.concat(output), metadataRemoved: removed, mimeType: 'image/jpeg' }
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      output.push(buffer.subarray(markerStart, offset))
      continue
    }
    if (offset + 2 > buffer.length) return null
    const length = buffer.readUInt16BE(offset)
    const end = offset + length
    if (length < 2 || end > buffer.length) return null

    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe
    if (isMetadata) removed = true
    else output.push(buffer.subarray(markerStart, end))
    offset = end
  }
  return null
}

function stripPngMetadata(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buffer.length < 20 || !buffer.subarray(0, 8).equals(signature)) return null
  const output = [signature]
  const metadataChunks = new Set(['eXIf', 'iTXt', 'tEXt', 'zTXt', 'tIME'])
  let offset = 8
  let removed = false
  let ended = false

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > buffer.length) return null
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    if (metadataChunks.has(type)) removed = true
    else output.push(buffer.subarray(offset, end))
    offset = end
    if (type === 'IEND') {
      ended = true
      break
    }
  }
  if (!ended) return null
  return { buffer: Buffer.concat(output), metadataRemoved: removed, mimeType: 'image/png' }
}

function readJpegDimensions(buffer) {
  let offset = 2
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
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) break
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) }
    }
    offset += length
  }
  return null
}

function readPngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function validateDimensions(image) {
  const dimensions = image.mimeType === 'image/png'
    ? readPngDimensions(image.buffer)
    : readJpegDimensions(image.buffer)
  if (!dimensions || !dimensions.width || !dimensions.height) throw new Error('图片缺少有效的尺寸信息')
  if (dimensions.width < 32 || dimensions.height < 32 || dimensions.width > MAX_IMAGE_EDGE || dimensions.height > MAX_IMAGE_EDGE) {
    throw new Error('图片边长必须在 32 到 4096 像素之间')
  }
  if (dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) throw new Error('图片总像素不能超过 1600 万')
  return dimensions
}

function prepareImage(filePath) {
  const original = fs.readFileSync(filePath)
  if (!original.length || original.length > MAX_FILE_SIZE) throw new Error('图片必须小于 5 MB')
  const sanitized = stripPngMetadata(original) || stripJpegMetadata(original)
  if (!sanitized) throw new Error('文件内容不是有效的 JPG 或 PNG')
  const dimensions = validateDimensions(sanitized)
  return {
    ...sanitized,
    ...dimensions,
    byteSize: original.length,
    sha256: crypto.createHash('sha256').update(sanitized.buffer).digest('hex')
  }
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength)
}

function normalizeLabels(value) {
  if (!value || typeof value !== 'object') throw new Error('模型没有返回 JSON 对象')
  const tags = []
  const input = Array.isArray(value.tags) ? value.tags : []
  input.forEach(item => {
    const tag = cleanText(item, 10).replace(/^#+/, '')
    if (tag && !tags.includes(tag) && tags.length < 5) tags.push(tag)
  })
  if (!tags.length) tags.push('表情包')
  return {
    prompt: cleanText(value.prompt, 60) || tags.join(' '),
    tags
  }
}

function parseModelJson(text) {
  const source = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return normalizeLabels(JSON.parse(source))
  } catch (firstError) {
    const start = source.indexOf('{')
    const end = source.lastIndexOf('}')
    if (start < 0 || end <= start) throw firstError
    return normalizeLabels(JSON.parse(source.slice(start, end + 1)))
  }
}

function requestLabels(image, config) {
  const endpoint = new URL(config.apiUrl)
  if (endpoint.protocol !== 'https:') throw new Error('VISION_API_URL 必须使用 HTTPS')
  if (endpoint.username || endpoint.password) throw new Error('VISION_API_URL 不能包含账号或密码')

  const body = JSON.stringify({
    model: config.model,
    temperature: 0.2,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: '分析这张表情包。只返回 JSON：{"prompt":"一句自然的中文场景描述，不超过60字","tags":["标签1","标签2"]}。标签必须是2到5个简短中文词，每个不超过10字，优先表达情绪、动作、使用场景和画面主体，不要猜测真实人物身份。'
        },
        {
          type: 'image_url',
          image_url: { url: `data:${image.mimeType};base64,${image.buffer.toString('base64')}`, detail: 'low' }
        }
      ]
    }]
  })

  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || 443,
      path: `${endpoint.pathname}${endpoint.search}`,
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      },
      timeout: 60000
    }, response => {
      const chunks = []
      let received = 0
      response.on('data', chunk => {
        received += chunk.length
        if (received > 2 * 1024 * 1024) request.destroy(new Error('模型响应过大'))
        else chunks.push(chunk)
      })
      response.on('end', () => {
        const responseText = Buffer.concat(chunks).toString('utf8')
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`模型请求失败（HTTP ${response.statusCode}）：${responseText.slice(0, 300)}`))
          return
        }
        try {
          const data = JSON.parse(responseText)
          const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
          resolve(parseModelJson(content))
        } catch (error) {
          reject(new Error(`无法解析模型响应：${error.message}`))
        }
      })
    })
    request.on('timeout', () => request.destroy(new Error('模型请求超时')))
    request.on('error', reject)
    request.end(body)
  })
}

function readManifest(filePath) {
  if (!fs.existsSync(filePath)) return { version: 1, items: [] }
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!value || value.version !== 1 || !Array.isArray(value.items)) throw new Error('已有输出文件格式不正确')
  return value
}

function writeManifest(filePath, inputDirectory, items) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.tmp`
  const value = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceDirectory: inputDirectory,
    items: items.slice().sort((left, right) => left.file.localeCompare(right.file, 'zh-CN'))
  }
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, filePath)
}

function csvCell(value) {
  const text = String(value === undefined ? '' : value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function writeCsv(filePath, items) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const rows = [['file', 'prompt', 'tags', 'status', 'error']]
  items.forEach(item => rows.push([item.file, item.prompt, (item.tags || []).join('|'), item.status, item.error || '']))
  fs.writeFileSync(filePath, `\ufeff${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`, 'utf8')
}

async function runPool(tasks, concurrency, worker) {
  let next = 0
  async function consume() {
    while (next < tasks.length) {
      const index = next++
      await worker(tasks[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, consume))
}

async function main(argv = process.argv.slice(2), environment = process.env) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(usage())
    return
  }
  if (!fs.existsSync(options.input) || !fs.statSync(options.input).isDirectory()) {
    throw new Error(`图片目录不存在：${options.input}`)
  }
  if (!options.dryRun && (!environment.VISION_API_URL || !environment.VISION_API_KEY || !environment.VISION_MODEL)) {
    throw new Error('请先设置 VISION_API_URL、VISION_API_KEY 和 VISION_MODEL；只检查图片可使用 --dry-run')
  }

  const manifest = readManifest(options.output)
  const resultByFile = new Map(manifest.items.map(item => [item.file, item]))
  let files = listImages(options.input)
  if (options.limit) files = files.slice(0, options.limit)
  console.log(`找到 ${files.length} 张 JPG/PNG 图片`)

  await runPool(files, options.concurrency, async (filePath, index) => {
    const relativePath = path.relative(options.input, filePath).split(path.sep).join('/')
    try {
      const image = prepareImage(filePath)
      const previous = resultByFile.get(relativePath)
      if (!options.force && previous && previous.status === 'ready' && previous.sha256 === image.sha256) {
        console.log(`[${index + 1}/${files.length}] 跳过 ${relativePath}`)
        return
      }
      const labels = options.dryRun ? { prompt: '', tags: [] } : await requestLabels(image, {
        apiUrl: environment.VISION_API_URL,
        apiKey: environment.VISION_API_KEY,
        model: environment.VISION_MODEL
      })
      resultByFile.set(relativePath, {
        file: relativePath,
        sha256: image.sha256,
        mimeType: image.mimeType,
        byteSize: image.byteSize,
        width: image.width,
        height: image.height,
        metadataRemovedBeforeAnalysis: image.metadataRemoved,
        prompt: labels.prompt,
        tags: labels.tags,
        status: options.dryRun ? 'checked' : 'ready'
      })
      console.log(`[${index + 1}/${files.length}] 完成 ${relativePath}`)
    } catch (error) {
      resultByFile.set(relativePath, {
        file: relativePath,
        status: 'error',
        error: cleanText(error.message, 500)
      })
      console.error(`[${index + 1}/${files.length}] 失败 ${relativePath}：${error.message}`)
    } finally {
      writeManifest(options.output, options.input, Array.from(resultByFile.values()))
    }
  })

  const items = Array.from(resultByFile.values())
  if (options.csv) writeCsv(options.csv, items)
  const ready = items.filter(item => item.status === (options.dryRun ? 'checked' : 'ready')).length
  const failed = items.filter(item => item.status === 'error').length
  console.log(`处理结束：成功 ${ready}，失败 ${failed}`)
  console.log(`JSON 清单：${options.output}`)
  if (options.csv) console.log(`CSV 清单：${options.csv}`)
  if (failed) process.exitCode = 2
}

if (require.main === module) {
  main().catch(error => {
    console.error(`错误：${error.message}`)
    process.exitCode = 1
  })
}

module.exports = {
  cleanText,
  normalizeLabels,
  parseArgs,
  parseModelJson,
  prepareImage,
  stripJpegMetadata,
  stripPngMetadata,
  validateDimensions
}
