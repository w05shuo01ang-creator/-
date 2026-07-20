# MemeDock 表情舱

一个可以直接部署到微信云开发的表情包收藏与分享小程序 MVP。

## 已完成

- 发现页：推荐、热门标签、搜索
- 分类页：固定分类、关键词筛选、分页加载
- 我的页面：上传、私密管理、申请公开、保存、删除
- 详情页：大图预览、整图点赞、标签点赞
- 服务端身份：所有权以微信 `OPENID` 为准
- 服务端写操作：客户端不能直接修改数据库
- 审核闭环：新上传默认私密，申请公开后进入 `pending`
- 并发点赞：使用云数据库事务和独立点赞记录

## 技术结构

```text
miniprogram/             原生微信小程序
cloudfunctions/memeApi/  统一业务云函数
docs/                    数据结构、权限和发布检查清单
```

## 本地启动

1. 在微信开发者工具中导入仓库根目录。
2. 在 `project.config.json` 中填入自己的小程序 AppID，或在开发者工具中选择测试号。
3. 开通云开发环境。
4. 右键 `cloudfunctions/memeApi`，选择“上传并部署：云端安装依赖”。
5. 在云数据库中创建 `memes`、`likes`、`tag_likes` 三个集合。
6. 按 [部署文档](docs/DEPLOYMENT.md) 配置索引和数据库权限。

小程序调用 `wx.cloud.init()` 时不写死环境 ID，默认使用开发者工具当前绑定的云环境。若需要固定环境，可在 [app.js](miniprogram/app.js) 中设置 `env`。

## 审核方式

MVP 采用人工审核：用户申请公开后记录变为 `pending`，管理员在云开发控制台确认图片内容后，将 `reviewStatus` 改为 `approved`。拒绝时改为 `rejected`。

这是一种刻意的失败关闭策略。没有审核服务、审核超时或配置错误时，内容不会自动公开。

## 开源前检查

- 不要提交真实的 `project.private.config.json`
- 不要提交云环境密钥、OpenID 列表或生产数据
- 将 `project.config.json` 中的 `appid` 替换为自己的 AppID，或继续保留测试号配置
- 上线前完成隐私保护指引、用户内容协议与投诉入口

安全边界见 [SECURITY.md](SECURITY.md)，规模化演进建议见 [docs/ROADMAP.md](docs/ROADMAP.md)。

## License

[MIT](LICENSE)
