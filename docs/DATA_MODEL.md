# 数据模型

## memes

```js
{
  _id: String,
  _openid: String,
  fileID: String,
  contentHash: String,
  fileSize: Number,
  mimeType: "image/jpeg" | "image/png",
  width: Number,
  height: Number,
  prompt: String,
  tags: String[],
  tagLikes: Object,
  totalLikes: Number,
  isPublic: Boolean,
  reviewStatus: "private" | "auto_reviewing" | "manual_review" | "approved" | "rejected",
  moderation: Object,
  createdAt: Date,
  updatedAt: Date
}
```

## rate_limits

存储每日上传次数/字节数及点赞、举报、发布等窗口计数。`expiresAt` 可用于定期清理过期记录。

## moderation_audits

保存审核来源、决策、原因、接口返回码、匿名化所有者标识和时间。不要保存原始 OpenID 或图片内容。

## reports

每个用户对每张表情最多一条，文档 ID 由 OpenID 与表情 ID 的摘要生成。

## blocked_users

```js
{
  openid: String,
  active: Boolean,
  reason: String,
  createdAt: Date
}
```

## likes

```js
{
  _id: String,       // OPENID + memeId 的 SHA-256 摘要
  _openid: String,
  memeId: String,
  createdAt: Date
}
```

## tag_likes

```js
{
  _id: String,       // OPENID + memeId + tag 的 SHA-256 摘要
  _openid: String,
  memeId: String,
  tag: String,
  createdAt: Date
}
```
