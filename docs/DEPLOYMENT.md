# 部署与安全配置

## 1. 数据库集合

创建以下集合：

- `memes`：表情主体数据
- `likes`：用户对整张表情的点赞记录
- `tag_likes`：用户对标签的点赞记录
- `rate_limits`：上传配额与高频操作计数
- `moderation_audits`：自动审核和社区下架日志
- `reports`：用户举报记录
- `blocked_users`：被限制操作的 OpenID

建议索引：

| 集合 | 字段 | 方向 |
| --- | --- | --- |
| memes | `isPublic`, `reviewStatus`, `createdAt` | 前两项升序，时间降序 |
| memes | `_openid`, `createdAt` | OpenID 升序，时间降序 |
| memes | `_openid`, `contentHash` | 均升序 |
| likes | `memeId`, `_openid` | 均升序 |
| tag_likes | `memeId`, `_openid` | 均升序 |
| reports | `memeId`, `status` | 均升序 |
| blocked_users | `openid`, `active` | 均升序 |

## 2. 数据库权限

小程序的所有数据访问都通过 `memeApi` 云函数完成。以上 7 个集合应全部设置为“所有用户不可读写”，不要开放客户端直读或直写。

云函数使用服务端身份访问数据库，不受客户端权限规则限制。

## 3. 云存储

上传路径格式为：

```text
uploads/{当前用户身份摘要}/{时间戳}_{随机串}.{扩展名}
```

云函数只接受 JPG/PNG，限制为 5 MB、最长边 4096 像素、总像素 1600 万，并拒绝 EXIF/XMP 等元数据。每个 OpenID 每天最多上传 10 张/25 MB，最多保留 100 张，相同文件内容不能重复上传。

仍需在云存储权限中只允许已登录用户上传，并配置资源费用上限。直接上传但未成功创建数据库记录的异常文件，应通过定时任务清理。

## 4. 内容审核

当前版本采用自动审核加人工兜底：

1. 用户上传后：`isPublic=false`，`reviewStatus=private`
2. 用户申请公开：`isPublic=false`，`reviewStatus=auto_reviewing`
3. 文本和图片均明确通过：`isPublic=true`，`reviewStatus=approved`
4. 明确违规：`isPublic=false`，`reviewStatus=rejected`
5. 接口异常或结果不明确：`isPublic=false`，`reviewStatus=manual_review`

云函数需要开通 `security.msgSecCheck` 和 `security.imgSecCheck` 云调用权限。未开通时不会自动放行，而是转入人工复核。

`blocked_users` 中的封禁记录格式：

```js
{ openid: "用户 OpenID", active: true, reason: "封禁原因" }
```

三名不同用户举报同一公开内容后，内容会自动下架并进入 `manual_review`。运营人员处理后还应更新对应 `reports.status`，保留处置记录。

正式运营时建议接入微信内容安全能力，并保留人工复核与投诉流程。自动审核异常时必须保持不公开。

## 5. 发布检查

- 配置合法 AppID 和生产云环境
- 部署云函数并安装云端依赖
- 验证 7 个集合对客户端完全关闭
- 验证上传、删除、申请公开、点赞、取消点赞
- 验证超限、重复图片、伪造格式和带元数据图片被拒绝
- 验证审核接口异常时内容保持非公开
- 验证举报、三人举报下架和账号封禁
- 验证其他用户无法读取私密内容
- 配置云资源告警和每日费用上限
- 补充隐私保护指引、用户协议、内容规范和投诉入口
- 准备至少一组审核通过的初始化内容，避免首页首次进入为空
