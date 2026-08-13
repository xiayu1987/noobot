# Noobot 浏览器协议 E2E

本目录是 Noobot 浏览器协议闭环测试的唯一实现入口。完整验收定义见
[`../../../../../docs/browser-protocol-e2e-test-plan.zh-CN.md`](../../../../../docs/browser-protocol-e2e-test-plan.zh-CN.md)。

目录职责：

- `fixtures/`：浏览器、认证、Session、协议捕获及证据输出生命周期。
- `helpers/`：浏览器操作和各协议域断言，不产生业务状态。
- `specs/`：去重后的 PBE 浏览器业务场景，包括 Manifest V2 插件激活、runtime-events 身份闭环、Workflow 停止继续、停止后同页编辑重发、Harness 低轮次工作流、主流程小结 checkpoint，以及工具/实时思考/交互闭环。
- `playwright.protocol.config.js`：协议测试唯一 Playwright 配置。

运行前必须提供：

```bash
export NOOBOT_E2E_USER_ID='...'
export NOOBOT_E2E_CONNECT_CODE='...'
export NOOBOT_E2E_BASE_URL='http://127.0.0.1:10060'
export NOOBOT_WORKSPACE_ROOT='/absolute/path/to/noobot/workspace'
export NOOBOT_E2E_WORKSPACE_ROOT="$NOOBOT_WORKSPACE_ROOT"
export NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT="$NOOBOT_WORKSPACE_ROOT"
export NOOBOT_PLUGIN_DEBUG='1'
```

`NOOBOT_E2E_WORKSPACE_ROOT` 是审计进程读取 Session、快照和 runtime-events 的根目录。
所有被测服务和 E2E 审计必须使用同一个 `NOOBOT_WORKSPACE_ROOT`。两个专用变量只声明各进程的
读取职责，其值必须派生自该唯一根目录。禁止让代理和 E2E 审计使用不同的 workspace 根目录，
否则 runtime-events 数据链不闭合，测试配置应视为无效。三个变量只要显式设置就必须使用绝对路径。

服务应由测试外部启动。测试不使用模拟后端，也不通过文件系统或内部接口创建业务事实。
协议场景固定使用单 worker 串行执行；PBE-014、PBE-015、PBE-023 和 PBE-024 在场景内部
构造协议要求的并发。禁止用场景间并行给共享用户连接和真实模型调用引入非业务资源竞争。

```bash
npx playwright install chromium
npm run test:e2e:protocol:smoke
npm run test:e2e:protocol:core
npm run test:e2e:protocol:full
```

证据默认写入仓库根目录的 `test-results/protocol/`。凭证禁止进入日志、trace、截图或报告。

## 模型调用观测协议

所有生产模型实例必须由 `agent/src/models/factory/chat-model.js` 创建，并在 provider
`ModelPort` 的真实 Provider Attempt 边界由 `model-runtime/src/executor/model-request-executor.js` 统一观测。唯一权威事件为：

```text
event = model_context_trace
data.stage = llm_invoke_messages
data.authority = model_invoke_port
data.protocolVersion = 1
```

主 Agent、瞬态重试、最终 streaming、tool binding、capability、memory、MCP、协作和数据处理
不得在各自业务分支重复发出该事件。每次实际 provider 调用生成唯一 `invocationId`；同一模型
实例及其 `bindTools()` 派生实例共享 `modelInstanceId`，并按 `invocationSequence` 单调递增。
E2E 只读取 `authority=model_invoke_port` 的记录，并校验消息数量、角色、dialog 分组、
messageId 缺失数、hash、preview 与 truncated 闭合。源码边界由
`agent/__tests__/architecture/model-invocation-observation-boundary.test.js` 强制守卫。

模型观测不是某几条业务用例的局部断言。所有 PBE 用例的调用期望由
`helpers/model-observation-policy.js` 唯一定义为 `required` 或 `forbidden`；
Playwright 配置加载时校验策略表与全部 spec 的 PBE 编号一一闭合。统一 `noobot` fixture 在每条
用例结束后读取根 Session 的完整 execution-event tree，审计所有权威模型调用，并输出：

- `protocol-evidence/model-invocations.jsonl`：本用例全部权威 provider 调用记录。
- `protocol-evidence/model-observation-audit.json`：调用期望、计数、模型实例、Session、purpose 与 domain 汇总。
- `protocol-evidence/session-summary-artifact-audit.json`：根及子 Session 的轻量 summary、详情引用、哈希、计数和孤儿文件审计。

统一 fixture 在每条用例结束时还会审计 Session summary 持久化协议：`session-summary.json`
不得内嵌 `toolTimeline` 或 `activityTimeline`；每个 `thinkingDetailRef` 必须唯一、限制在
`session-summary-details/` 内，并与详情文件的展示消息身份、SHA-256 和 timeline 计数一致；目录中
不得存在未被主 summary 引用的详情 JSON。该审计与模型调用审计独立收尾，任一失败都会使场景失败，
同时保留各自的证据文件。
同一审计还验证 `sessions.json` 的唯一列表协议：正常 Session 必须为 `availability: available`；
不可用 Session 必须为零消息投影并包含结构化失败原因；未 provision 的 Session 不得留下列表索引。
对 PBE-026、PBE-030 这类明确禁止模型调用且不 provision 的场景，收尾审计反向要求不能产生
任何 Session summary artifact，确保非法协议或纯本地 Session 不污染持久化事实。

业务 spec 只保留主 Agent、Workflow 子 Session 或专用模型的领域身份断言，不得重复实现通用
消息闭合规则。`required` 无调用、`forbidden` 有调用、未登记 PBE、重复 PBE 或废弃策略项均直接失败。
统一观测只约束最终 provider `invoke(messages)` 的消息协议。主 Agent 仍由 system、历史窗口、
小结与增量 Context 生产消息；capability、工具、MCP、memory 等专用模型仍由各自领域生产者组装
消息，E2E 不把这些专用调用错误套用成主 Agent 的 Context 策略。

## 实现状态

基础配置、证据捕获、认证和 Session fixture、协议断言入口已经建立。新增用例必须从
`fixtures/noobot.fixture.js` 导入 `test` 和 `expect`，从而保证所有用例使用同一套捕获和审计链。
PBE-002～003、PBE-006～017、PBE-021～032、PBE-034～036 已全部落地；PBE-001、PBE-004 和 PBE-018
分别按严格包含关系合并到 PBE-002、PBE-006 和 PBE-016/017。所有场景从统一 fixture 运行，
禁止用 `test.skip` 或无业务断言的占位测试伪装覆盖率。
