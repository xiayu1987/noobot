# `@noobot/attachment-protocol`

附件协议的唯一规范入口，负责定义跨 Agent、Service、传输和 Client 的附件事实契约。

## 设计边界

- 业务身份唯一由 `attachmentId + sessionId + attachmentSource` 构成，三者缺一不可。
- `path`、`relativePath`、沙箱路径、名称、MIME 和大小不是身份字段，也不能在新链路中推测身份。
- 持久化记录、Agent 运行态引用、访问引用和 UI 视图是不同对象，不能通过对象展开互相覆盖。
- `attachments === undefined` 表示 unchanged；`attachments = []` 表示显式 replace/delete-all。
- 生命周期事件必须携带版本、稳定 `messageId` 和完整附件身份；传输层只能校验和无损透传。

## 历史数据迁移

运行时只接受 canonical identity、descriptor 和 persisted record，不从 snake_case 字段、路径或文件特征推断身份。历史 `attachments.json` 必须在启动当前版本前离线转换：

```bash
node scripts/migrate-attachment-record-v1.mjs --workspace=/path/to/workspace
node scripts/migrate-attachment-record-v1.mjs \
  --workspace=/path/to/workspace \
  --write \
  --backup=/path/to/attachment-backup
```

第一条命令只扫描并报告；写入模式必须指定独立备份目录。迁移脚本是历史记录转换的唯一入口，运行时协议不会降级解析旧结构。

运行测试：`npm run -w @noobot/attachment-protocol test`

## 文件预览契约

`preview` 导出权威 descriptor（name、type、mimeType、language、maxBytes、overLimit）。声明 MIME 优先识别 Office、媒体及 PDF；其余格式优先采用明确文件扩展名，再采用声明 MIME；已读出的非文本结果禁止文本预览。消费者不得重新推导类型或语言。

资源只允许文档内 data URI、片段引用及来源适配器授权的本地路径。外部 URL、协议相对地址和反斜杠路径拒绝读取。资源失败返回可见的 `rejected` 状态（原位置提示引用与错误）；正文继续展示，取消整个文档仍终止渲染。CSS 按语法解析规则和 URL，不匹配字符串或注释中的相似文本；@import 不支持，仅删除该规则并明确报告。非法样式仅移除对应样式内容，保留正文节点及子内容；不支持的 link 明确提示后移除。HTML 在空 sandbox 内仅使用 data URI，禁止联网、脚本、导航和父文档访问。

样式表转换保留 `media` 适用条件与 `title` 样式集合名称；`rel` 按 ASCII 空白分隔、大小写不敏感的 token 识别。备用样式表不支持选择，明确提示后移除，不得无条件应用；显式 disabled 的样式表保持停用且不读取。CSS 解析恢复只删除失败声明或规则，条件或选择器解析失败时删除所属规则，禁止清空条件后应用。自定义属性按 CSS token 序列保留合法值，其中的 URL（含转义形式）与普通声明共用资源授权、预算和错误提示；字符串与注释中的相似文本不视为 URL。

HTML 与 Markdown 共享 clientPreview 的 resourceMaxBytes、resourceTotalBytes、maxResourceFiles 和 resourceConcurrency。缓存有效期为当前文档版本，页签往返复用渲染结果；编辑、切换文件或关闭取消旧任务并释放引用。写入快照及差异请求均须将 AbortSignal 从视图贯通至服务和 HTTP；切换页签、选择、关闭或卸载时中止旧请求，旧结果不得更新当前视图。

预览来源提供 descriptor，以及与其类型对应的读取能力：文本类型使用 `readText(signal)`；URL 类型使用本地快照 `readBlob(signal)` 或远程 `authorizeResource(signal)`，两种资源能力互斥。本地 Blob 的对象 URL 由共享加载器创建，切换文件、关闭或销毁时撤销；远程授权地址按凭证期限续期。写入快照沿用 file-mutation-protocol 的 content、size、isText，不读取实时文件补足快照；isText 为 true 的内容统一受文本字节预算约束，包括 SVG 等文本表示的媒体，显示类型仍由 descriptor 决定。

文档资源适配器契约为 `resolveResource(reference, signal, stylesheet, { maxBytes, onBytes })`：maxBytes 是预算分配的本次读取上限，适配器必须在流读取过程中执行限额，并通过 onBytes 报告累计已读取字节（失败读取也计费）。底层单个流块可能超过分配额度，必须先报告该块的完整消耗再终止读取，不能截断计费。调度器在读取前预留额度，完成或失败后按实际读取量结算，等待中的任务在预算耗尽后禁止再发起读取；预算不代表底层已返回的超限块或已经启动的并发读取能被追溯撤销。data URI 同样计入去重后的资源数量、解码字节和总预算；片段引用不产生读取。拒绝、畸形编码和限额错误均保留原位置提示，不静默丢弃。

工作区 `/preview` 只提供文件的 inline 读取；与附件内容共用响应实现，普通 GET、HEAD、Range 和无效 Range 响应统一使用 `Cache-Control: private, no-store`、sandbox CSP 和 nosniff，禁止缓存受保护内容。`/download` 保留文件及目录归档的 attachment 下载语义。资源凭证绑定目标、GET/HEAD、父会话和 expiresAt；客户端在有效期中点续期，失败明确终止预览。续期不得重置媒体播放位置与暂停状态。
