# 批量图片智能标注

`tools/bulk-label-images.js` 用于整理首批表情素材。它会递归读取目录中的 JPG/PNG，在内存中移除 JPEG 的 EXIF/XMP/IPTC/注释和 PNG 的文本、EXIF、时间块，再将净化后的图片交给支持图片理解的模型，生成描述和 2～5 个中文标签。对于 EmojiPackage，可以保留原文件名作为描述，让模型只生成标签。

工具只生成清单，不会直接连接微信生产数据库，也不会自动公开内容。最终上传仍须经过 MemeCraft 原有的格式校验、配额、去重和微信内容安全审核。

## 准备

需要 Node.js 18 或更高版本，以及一个兼容 Chat Completions 图片消息格式的视觉模型服务。不要把密钥写进代码、配置文件或 Git。

PowerShell 当前窗口中设置环境变量：

```powershell
$env:VISION_API_URL="https://你的模型服务地址/v1/chat/completions"
$env:VISION_API_KEY="你的临时密钥"
$env:VISION_MODEL="支持图片理解的模型名"
```

这些变量只对当前 PowerShell 窗口有效。使用完可执行：

```powershell
Remove-Item Env:VISION_API_KEY
```

## 先检查图片

不调用模型，只检查目录内图片是否为有效 JPG/PNG，并应用与线上一致的 5 MB、32～4096 像素边长和 1600 万总像素限制：

```powershell
node tools/bulk-label-images.js "D:\待整理表情" --dry-run
```

## 生成标签

```powershell
node tools/bulk-label-images.js "D:\待整理表情" `
  --output "D:\待整理表情\memecraft-labels.json" `
  --csv "D:\待整理表情\memecraft-labels.csv" `
  --concurrency 2
```

JSON 适合后续程序读取，CSV 适合用 Excel 人工检查和修改。输出项包含：

```json
{
  "file": "开心/下班.jpg",
  "uploadFile": "0001_下班_a1b2c3d4.jpg",
  "sha256": "...",
  "mimeType": "image/jpeg",
  "byteSize": 123456,
  "width": 640,
  "height": 640,
  "metadataRemovedBeforeAnalysis": true,
  "prompt": "听到下班后立刻开心冲出去",
  "tags": ["开心", "下班", "冲刺"],
  "status": "ready"
}
```

再次运行会按净化后图片的 SHA-256 跳过已有成功结果，因此中断后可直接续跑。图片发生变化时会自动重新分析。使用 `--force` 可强制全部重跑，`--limit 20` 可先抽取前 20 张试用。

## EmojiPackage 批量导入

仓库根目录的 `EmojiPackage/` 只作为本地素材源，不会提交到 MemeCraft 的 Git 仓库。当前可处理其中 1775 张 JPG/PNG；GIF 和 WebP 会自动跳过。

### 不使用 AI，统一打一个标签

下面的命令保留原图片文件名作为描述，给本批图片统一设置“基础表情”标签，不需要配置任何视觉模型密钥：

```powershell
node tools/bulk-label-images.js ".\EmojiPackage" `
  --prompt-from-filename `
  --default-tag "基础表情" `
  --export-dir ".\memecraft-upload" `
  --output ".\memecraft-upload\memecraft-labels.json" `
  --limit 100 `
  --balanced
```

标签必须为 1 到 10 个字符。每次最多准备 100 张，导入完成后可删除 `memecraft-upload`，再调整素材或输出目录制作下一批。

制作第二批时增加 `--offset 100`，第三批使用 `--offset 200`，依次递增。建议每批放进独立子目录，例如 `--export-dir ".\memecraft-upload\batch-002"`，并让 `--output` 指向同一子目录中的 JSON，避免和上一批混在一起。

### 不打标签

如需无标签发布，将 `--default-tag "基础表情"` 换成 `--no-tags`：

```powershell
node tools/bulk-label-images.js ".\EmojiPackage" `
  --prompt-from-filename `
  --no-tags `
  --export-dir ".\memecraft-upload" `
  --output ".\memecraft-upload\memecraft-labels.json" `
  --limit 100 `
  --balanced
```

无标签能力只对云函数 `ADMIN_OPENIDS` 中配置的管理员生效；普通用户即使伪造参数，云端仍会补上默认“表情包”标签。

建议先制作 100 张基础内容。导出目录必须位于 `EmojiPackage/` 外部：

```powershell
$env:VISION_API_URL="https://你的模型服务地址/v1/chat/completions"
$env:VISION_API_KEY="你的临时密钥"
$env:VISION_MODEL="支持图片理解的模型名"

node tools/bulk-label-images.js ".\EmojiPackage" `
  --prompt-from-filename `
  --export-dir ".\memecraft-upload" `
  --output ".\memecraft-upload\memecraft-labels.json" `
  --csv ".\memecraft-upload\memecraft-labels.csv" `
  --limit 100 `
  --balanced `
  --concurrency 2
```

`--balanced` 会按一级分类轮流选图，避免前 100 张集中在少数几个文件夹。输出的图片已移除元数据，并使用“序号 + 原名 + 路径摘要”组成唯一文件名，解决 EmojiPackage 不同目录中存在重名图片的问题。清单中的 `prompt` 保留原文件名（超过 60 字时按系统上限截断），`tags` 来自视觉模型。

将 `memecraft-labels.json` 和需要上传的图片发送到微信文件传输助手，然后在小程序“我的表情”页点击管理员专用的“批量”按钮：

1. 选择 `memecraft-labels.json`。
2. 选择同一导出目录中的 JPG/PNG，单批最多 100 张。
3. 确认后保持页面打开；小程序会逐张上传并自动提交微信内容审核。

批量按钮只对云函数环境变量 `ADMIN_OPENIDS` 中配置的账号显示。普通账号最多保留 100 张；管理员最多保留 2000 张，每天可上传和提交审核 100 张，普通用户仍为每天 10 张。这个限制允许管理员分批建立基础图库，同时避免单日突发上传和审核成本失控。

## 风险边界

- 只处理自己创作、已获授权或明确允许再分发的图片。模型打标签不会解决版权和肖像权问题。
- 图片分析会把净化后的图像内容发送给你配置的模型服务。使用前应核对该服务的数据保留和训练政策。
- AI 标签可能误判，尤其是人物、讽刺、谐音和敏感语境。公开前必须人工抽查描述与标签。
- 不建议高并发。默认并发为 2，最大限制为 4，以减少费用失控和模型服务限流。
- `error` 项不会被当作成功结果；修正图片或配置后直接重跑即可。
