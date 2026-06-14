# Refactor Regression Checklist

> 目的：在重构后快速验证关键链路没有回归。  
> 建议每次重构合并前至少跑一遍。

## 1) 基础会话
- [ ] 发送纯文本消息，正常返回 assistant 回复。
- [ ] 服务端无 `run_session_failed` 新错误。

## 2) 用户附件入库
- [ ] 上传图片后，`session.json` 的用户消息有 `attachmentMetas`。
- [ ] 每个附件包含：`attachmentId / sessionId / relativePath`（至少这三项）。

## 3) doc_to_data
- [ ] `doc_to_data` 返回 `ok: true`。
- [ ] 提取结果合理，不是“未收到图片”这类异常兜底文案。

## 4) media_to_data
- [ ] 图片与音频各跑一例，均成功。
- [ ] `tool_result` 有有效 `text` 内容。

## 5) multimodal_generate（模型生成附件）
- [ ] 工具返回 `saved_attachment_count > 0`。
- [ ] `tool_result.attachmentMetas` 包含 `relativePath`。
- [ ] 同轮 assistant 消息可见附件。
- [ ] 前端可预览、可下载。

## 6) 异步委派（delegate_task_async）
- [ ] 并发创建多个子任务成功。
- [ ] 不出现 `runAsyncSession is not a function`。
- [ ] 子任务状态可从 `running` 变为 `completed/failed/stopped`。

## 7) 异步汇总（wait_async_task_result）
- [ ] `container_statuses`、`task_stats` 合理。
- [ ] `invalid_request` 不会误判为 `running`。
- [ ] 完成态能正确输出汇总结果。

## 8) Help 提示触发
- [ ] 制造连续工具失败后出现 `help_tool_failure_prompted` 事件。

## 9) 阶段小结触发
- [ ] 降低阈值后能出现 `phase_summary_required` 事件。

## 10) Memory summary
- [ ] 常规场景出现 `memory_summary_checked`。
- [ ] 超时场景出现 `memory_summary_timeout`，且主流程不中断。

## 11) 前端消息折叠与附件合并
- [ ] 同一 `dialogProcessId` 多段 assistant 合并后附件不丢。
- [ ] tool 消息上的附件能在对话中展示（经聚合后）。

## 12) 兼容性
- [ ] 旧会话可打开，不崩溃。
- [ ] 新会话链路全部正常（明确：旧数据不自动补字段）。

## 13) Agent 插件解耦守卫
- [ ] `npm run check:agent-plugin-decoupling` 通过。
- [ ] 新增 agent core 代码不直接写死具体插件名（如 `harness` / `workflow`）；不要新增具体插件兼容别名或守卫例外。
