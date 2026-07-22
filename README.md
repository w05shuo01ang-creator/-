# MemeCraft 表情工坊

一个可以直接部署到微信云开发的表情包收藏与分享小程序 MVP。

## 已完成

- 发现页：推荐、热门标签、搜索
- 分类页：固定分类、关键词筛选、分页加载
- 我的页面：上传、私密管理、申请公开、保存、删除
- 详情页：大图预览、整图点赞、标签点赞
- 服务端身份：所有权以微信 `OPENID` 为准
- 服务端写操作：客户端不能直接修改数据库
- 上传防护：服务端校验格式、大小、像素、元数据、配额和重复内容
- 审核闭环：文本和图片均明确安全才自动公开，异常转人工复核
- 社区治理：举报、自动下架、封禁查询和审核审计日志
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
5. 按 [部署文档](docs/DEPLOYMENT.md) 创建 7 个数据库集合并关闭客户端直接读写。
6. 按 [部署文档](docs/DEPLOYMENT.md) 配置索引和数据库权限。

小程序调用 `wx.cloud.init()` 时不写死环境 ID，默认使用开发者工具当前绑定的云环境。若需要固定环境，可在 [app.js](miniprogram/app.js) 中设置 `env`。

安全校验测试：

```bash
node tests/security.test.js
```

## 审核方式

用户申请公开后，云函数调用微信文本和图片内容安全接口。两项均明确通过才自动公开；违规内容被拒绝；接口超时、权限未开通或结果不明确时进入 `manual_review`，继续保持非公开。管理员可在云开发控制台人工复核。

## 开源前检查

- 不要提交真实的 `project.private.config.json`
- 不要提交云环境密钥、OpenID 列表或生产数据
- 将 `project.config.json` 中的 `appid` 替换为自己的 AppID，或继续保留测试号配置
- 上线前完成隐私保护指引、用户内容协议与投诉入口

安全边界见 [SECURITY.md](SECURITY.md)，内容审核方案见 [docs/CONTENT_MODERATION.md](docs/CONTENT_MODERATION.md)，规模化演进建议见 [docs/ROADMAP.md](docs/ROADMAP.md)。

首批素材可使用 [批量图片智能标注工具](docs/BULK_LABELING.md) 生成描述与标签清单。工具不会绕过生产环境的上传校验和内容审核。

## License

[MIT](LICENSE)
