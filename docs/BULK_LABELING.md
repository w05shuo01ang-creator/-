# 批量图片智能标注

`tools/bulk-label-images.js` 用于整理首批表情素材。它会递归读取目录中的 JPG/PNG，在内存中移除 JPEG 的 EXIF/XMP/IPTC/注释和 PNG 的文本、EXIF、时间块，再将净化后的图片交给支持图片理解的模型，生成一条描述和 2～5 个中文标签。

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

## 风险边界

- 只处理自己创作、已获授权或明确允许再分发的图片。模型打标签不会解决版权和肖像权问题。
- 图片分析会把净化后的图像内容发送给你配置的模型服务。使用前应核对该服务的数据保留和训练政策。
- AI 标签可能误判，尤其是人物、讽刺、谐音和敏感语境。公开前必须人工抽查描述与标签。
- 不建议高并发。默认并发为 2，最大限制为 4，以减少费用失控和模型服务限流。
- `error` 项不会被当作成功结果；修正图片或配置后直接重跑即可。
