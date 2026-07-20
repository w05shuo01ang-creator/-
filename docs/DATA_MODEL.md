# 数据模型

## memes

```js
{
  _id: String,
  _openid: String,
  fileID: String,
  prompt: String,
  tags: String[],
  tagLikes: Object,
  totalLikes: Number,
  isPublic: Boolean,
  reviewStatus: "private" | "pending" | "approved" | "rejected",
  createdAt: Date,
  updatedAt: Date
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

