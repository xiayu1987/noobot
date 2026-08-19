# 全仓代码质量整改计划

本文档记录 2026-08-19 全仓坏味道审计中确认的问题、处理顺序和验收标准。它只记录可由代码和静态检查证明的事实，不以文件名、缺失字段或运行结果推导业务事实。

## 状态定义

- `待处理`：问题和验收标准已经确认，尚未开始修改。
- `处理中`：已经开始修改，但尚未通过全部验收项。
- `待全仓验证`：实现和定向测试已经通过，尚未完成全仓测试、质量检查和构建。
- `已完成`：实现、定向测试和全仓质量门禁均已通过。
- `受上游限制`：仓内可控整改已完成，但验收条件受上游公开模块边界限制；必须保留可复现证据，不得用阈值、私有入口或功能降级虚假结项。

## 整改清单

| 编号   | 状态       | 优先级 | 问题                                                                         | 唯一收敛方向                                      | 验收标准                                                                                                 |
| ------ | ---------- | ------ | ---------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| CQ-001 | 已完成     | P0     | 持久化读取将不存在、权限失败和内容损坏统一返回默认值                         | 建立唯一的持久化读取结果/错误协议                 | 只有明确的 `ENOENT`、`ENOTDIR` 可以表示缺失；权限、解析和 I/O 错误保留类型并向上传播；覆盖损坏和权限测试 |
| CQ-002 | 已完成     | P0     | 长期记忆运行时同时读取 Markdown 和旧 JSON                                    | 旧格式只通过一次性显式迁移进入当前格式            | 正常运行链路只读取当前格式；迁移幂等；迁移失败不写入新状态；删除运行时旧格式分支                         |
| CQ-003 | 已完成     | P0     | `turn_committed` 校验存在两份实现                                            | Session Protocol 只保留一个公开实现               | 删除重复模块；所有生产代码和测试引用同一导出；增加边界守卫防止协议复制                                   |
| CQ-004 | 已完成     | P1     | Capability Model 同时读取 runtime config 和闭包 fallback config              | 调用方传入一个版本化 effective config snapshot    | Runner 只接受单一配置快照；缺失或版本不匹配时失败关闭；删除两个 fallback 配置入口                        |
| CQ-005 | 已完成     | P1     | Agent Events 和 Harness Planning 各存在一个循环依赖                          | 叶子模块只依赖最小能力模块，不反向依赖聚合出口    | 依赖图守卫对 Agent、Harness 和 Workflow 源码均为零循环                                                   |
| CQ-006 | 已完成     | P1     | 核心执行、状态归约和预览模块存在高复杂度长函数                               | 按纯决策、协议投影、持久化、副作用执行分层        | 首批热点函数复杂度不高于约定阈值；单函数职责可独立测试；质量门禁只阻止新增或恶化，不用提高阈值隐藏存量   |
| CQ-007 | 已完成     | P1     | 空异常处理和失效参数降低可诊断性                                             | 明确区分 best-effort cleanup 与业务失败           | 业务失败不得空捕获；清理失败进入诊断通道；删除或实现 `includeUserMeta`、`fallbackAttachments` 等失效参数 |
| CQ-008 | 受上游限制 | P2     | 生产构建存在超过 500 kB 的前端 chunk                                         | 按功能边界建立明确的异步加载入口                  | 不放宽构建阈值；主入口和重型功能依赖分离；构建不再报告超限 chunk；首屏和功能加载回归测试通过             |
| CQ-009 | 已完成     | P0     | 复杂度、重复度和依赖图门禁各自维护生产源码范围，新增工作区可能不进入全部检查 | 从根工作区清单生成唯一的一方生产源码清单          | 所有质量门禁消费同一源码清单；新增工作区自动受检；测试、生成物、vendor 和运行数据使用显式分类排除        |
| CQ-010 | 已完成     | P0     | 权威状态归约和前端运行时归约仍包含极高复杂度函数                             | 将事件校验、迁移、决策和状态投影拆成纯函数/决策表 | 权威状态转换和前端归约各自只有一个入口；事件分支可独立测试；纳入复杂度门禁并降至约定阈值                 |
| CQ-011 | 已完成     | P0     | Turn Scope Identity 协议存在两份字节级相同实现                               | 保留一个协议实现，其他公开入口只做静态重导出      | `session-protocol` 中只有一个实现文件；内部和包导出引用同一符号；边界守卫禁止协议复制                    |
| CQ-012 | 已完成     | P0     | 正常运行链路仍读取或转换旧 JSON、旧状态字段和缺失身份消息                    | 旧数据只在显式版本迁移边界转换                    | Experience、Harness 和前端 Turn 选择只消费当前协议；迁移幂等并与正常运行代码分离；删除运行时旧字段分支   |
| CQ-013 | 已完成     | P1     | 配置文件损坏时 Agent Proxy 和 Model Proxy 静默使用默认配置                   | 共享配置读取协议区分缺失、损坏和 I/O 失败         | 仅文件缺失允许默认值；损坏和 I/O 错误阻止启动并返回稳定错误；两个 Proxy 使用同一配置读取语义             |
| CQ-014 | 已完成     | P1     | Context、Connector、调试事件等跨边界逻辑存在重复实现                         | 将共享事实归属到对应协议或共享叶子模块            | 扩大后的重复度门禁覆盖全部一方源码；协议、消息规范化和连接器状态不得跨包复制；克隆基线只减不增           |
| CQ-015 | 已完成     | P2     | Agent 保留无任何生产引用的 JSON 读取模块                                     | 删除死代码或由唯一持久化读取协议接管              | `agent/src/shared/utils/json.js` 不再存在无引用实现；生产模块引用检查进入质量门禁                        |
| CQ-016 | 受上游限制 | P0     | 生产依赖审计报告 5 个高危告警                                                | 在不降级直接依赖的前提下升级或替换问题依赖链      | `npm audit --omit=dev` 无高危告警；Mail Parser 和 PM2 能力回归通过；不得用忽略规则或降级隐藏告警         |

## 首批复杂度热点

以下数据来自 ESLint `complexity=20`、`max-lines-per-function=150` 的只读诊断，不表示所有超限函数都应机械拆分：

- `agent/src/bot/session/detached-subsession-runner.js`：最高复杂度 172。
- `agent/src/session/entities/session-entity.js`：`normalizeMessageEntity` 复杂度 146。
- `plugin/noobot-plugin-workflow/src/core/hooks/node-agent.js`：`runNodeAgent` 复杂度 122。
- `plugin/noobot-plugin-workflow/frontend/composables/useWorkflowNodeSessionViewer.js`：主 composable 约 779 行，`openNodeSession` 复杂度 113。
- `client/noobot-chat/src/modules/chat/composables/message/useMessagePreview.js`：主 composable 约 745 行，`openFilePreview` 复杂度 98。
- `service/ws/chat-websocket/message-run-handler.js`：主工厂约 588 行，核心运行分支复杂度 98。

## 处理规则

1. 每次只改变一个权威协议或一个职责边界，先补失败测试，再修改实现。
2. 不增加旧字段回退、名称猜测、内容推断或双写分支。
3. 迁移逻辑与正常运行逻辑分离，迁移完成后运行时只认当前协议。
4. 每项完成时更新本表状态，并记录对应测试和边界守卫。
5. 每批修改必须通过定向测试、`npm run check:quality`、`npm test` 和生产构建。

## 处理记录

### 2026-08-19 第一批

- CQ-001：新增共享持久化 JSON 读取协议。Memory、Session Storage 和 Session Artifact 使用同一读取入口；仅路径缺失返回 fallback，损坏、权限和其他 I/O 失败分别使用稳定错误码。
- CQ-002：新增工作区生命周期长期记忆迁移。旧 `long-memory.json`、`metadata.json` 和 `long-memory-model.json` 只在工作区初始化/同步边界转换；正常读取和更新只认 Markdown。
- CQ-003：删除未公开且无生产引用的第二份 `turn_committed` 校验器；Session Protocol 边界检查禁止重复定义。
- CQ-004：插件准备阶段创建 `noobot.agent-config` 版本化 effective config snapshot；Capability Runner 强制校验且只消费该快照，删除 runtime/fallback 双选择。
- CQ-005：Agent Event Stream 直接依赖 emitter，Harness Planning 直接依赖叶子能力模块；新增 `check:source-cycles` 覆盖 631 个生产模块。
- CQ-006：新增 `check:complexity-baseline` 并接入 `check:quality`。基线已从复杂度超限 536、长函数超限 127、最大复杂度 172 收紧为 524、123、113。Session Entity、Detached Sub-session Runner、Workflow Node Agent 和 Message Preview 四个首批热点已清零；Workflow Node Session Viewer 与 WebSocket Message Run Handler 仍在处理中。
- CQ-007：删除失效参数；持久化、配置、附件、模型切换等业务失败不再空捕获。全仓 `no-empty` 错误级门禁覆盖 Agent、Agent Proxy、Model Proxy、客户端共享 Electron、插件、协议和用户模板；关闭、清理、日志和服务降级统一产生可观察诊断。
- CQ-008：主入口从 652 kB 降至 289 kB，Vue、Element Plus、Markdown 与 Diagram Parser 已按功能边界拆包。Mermaid 11.16.1 的公开入口仍包含单个 662.09 kB 的 `@mermaid-js/parser` chunk，未调高阈值、未使用包私有路径且未屏蔽警告，因此本项保持处理中。
- 前端文件预览：附件预览与生成文件预览使用共享视口级 Dialog 契约；`append-to-body` 将遮罩移出消息滚动容器，显式 `modal-class` 固定应用级遮罩，预览类以更高 CSS 优先级固定 `100vw × 100dvh`，避免移动端通用 Dialog 规则覆盖全屏尺寸。

### 2026-08-19 全仓验收

- CQ-001 至 CQ-005 已通过定向测试、全仓质量门禁、全仓测试和生产构建，状态更新为已完成。
- CQ-006 仍有两个首批热点，继续保持处理中；CQ-007 已完成并由全仓 `no-empty` 门禁阻止回归。
- CQ-008 来自生产构建的可复现警告：最大前端 chunk 为 662.09 kB。该项单独治理，不通过提高 `chunkSizeWarningLimit` 隐藏问题。
- 附件预览和生成文件预览的应用视口级组件契约已通过前端测试与生产构建。

### 2026-08-19 第二批

- CQ-006：`session-entity.js` 按消息身份、Turn Commit、附件、注入、展示和工具字段拆分；`detached-subsession-runner.js` 按身份、配置、附件、持久化、生命周期和结果投影拆分；`node-agent.js` 按上游证据、语义转移、子会话执行和动作归约拆分；`useMessagePreview.js` 按状态、文件访问上下文、下载、工作区/宿主预览、附件预览和复制拆分。
- CQ-007：Harness JSON 缺失与损坏语义分离；模型切换改为持久化成功后发布运行时模型；客户端 Debug Sink 和 WebSocket Close 建立唯一 best-effort 边界；全仓剩余空异常处理全部进入诊断或保留业务错误传播。
- CQ-008：完成主入口和主要供应商依赖拆包；上游 Mermaid parser 单模块问题保留为明确待办，不以构建配置掩盖。
- 文件预览：修复 Dialog 尺寸配置正确但被消息滚动容器和移动端通用样式覆盖的根因，普通消息与 Workflow Drawer 使用同一应用视口协议。
- 附件重发测试夹具改为显式提供 `WorkspaceService`，并新增缺失该权威依赖时失败关闭的契约测试。

### 2026-08-19 第三批

- CQ-006：Workflow Node Session Viewer 按运行节点回绑、会话快照归约、会话打开和实时投影拆分；WebSocket Message Run Handler 按命令映射与接纳、活动运行注册、事件监听适配和终态归类拆分。公开 API、权威生命周期事件和执行顺序保持不变。
- CQ-006：复杂度基线进一步收紧为复杂度超限 515、长函数超限 119、最大复杂度 106。六个原始热点及本批所有拆分模块均锁定为零违规，状态更新为已完成。
- 文件预览：不再把 DOM 投影责任交给 Element Plus 的内部 `append-to-body`。消息组件通过唯一的 Vue `Teleport to="body"` 将预览挂载到应用根视口，Dialog 关闭二次 teleport；全屏遮罩负责应用级交互边界，预览面板独立限制为最大 `1280 × 900` 并保留桌面 24 px、移动端 8 px 的视口留白。测试直接验证最终预览节点位于 `document.body`、不属于消息 DOM 且没有全屏面板属性。
- CQ-008：应用主入口和 Mermaid 已经是异步边界；生产构建剩余的 662.09 kB 文件来自 Mermaid 11.16.1 公共入口引入的 `@mermaid-js/parser@1.2.0`。删除仓内无效的 parser `manualChunks` 聚合规则后，产物大小和哈希均未变化；上游发布物中的 `chunk-KEIR6QF5.mjs` 本身为 1.32 MB 单模块，生产压缩后仍为 662.09 kB，且当前最新版本仍是 1.2.0。更换为仅支持部分语法的渲染器会降低现有完整 Mermaid 能力，使用包私有路径或把依赖复制成静态资产只会绕过构建审计。因此状态保持受上游限制，等待上游提供可拆分公共入口或等价的完整语法实现。

### 2026-08-19 第四批全仓复审

- 审计边界：以根工作区为入口，排除测试、生成物、第三方 `vendor`、依赖目录、构建产物、运行时工作区和报告目录后，共复核 1640 个一方源码文件。`TODO`、`FIXME`、`HACK` 和 `XXX` 扫描没有生产源码命中；该结果只表示没有这些标记，不表示没有问题。
- CQ-007：普通 `catch {}` 已受 ESLint `no-empty` 约束，但 `.catch(() => {})` 不在现有规则覆盖范围。生产源码确认存在 48 处空 Promise 拒绝处理，分布于 24 个文件，包括服务日志清理、OpenVSCode 实例持久化、Session Artifact、MCP/Connector、Electron 启动和依赖安装等链路。部分属于 best-effort cleanup，但仍未进入诊断通道，因此本项从“已完成”恢复为“处理中”。
- CQ-009：现有复杂度脚本只列出 8 组生产根，重复度脚本只扫描 `service/src`、`client`、`agent-proxy` 和 `model-proxy`，各门禁没有共享源码清单。现有门禁报告 515 个复杂度超限、119 个长函数、最高复杂度 106；扩大到全部一方源码后为 624、132、144，证明门禁会遗漏工作区和协议包。
- CQ-010：`authoritative-state/src/domain/turn-lifecycle-entity.js:170` 的 `transitionTurnLifecycle` 复杂度为 144；前端 `reduceTurnRuntimeEvent`、`applyTurnRuntimeEvent` 和 `applyTurnLifecycleSnapshot` 分别为 99、99、97。最长函数包括 `createChatWebSocketClient` 697 行、`createFileTool` 603 行和 `useThinkingTimeline` 594 行。这里记录的是结构复杂度，不据此推导业务行为错误。
- CQ-011：`session-protocol/src/turn-scope-identity.js` 与 `session-protocol/src/identity/turn-scope-identity.js` 的 SHA-256 均为 `f9b1d211e018a82c713c8e9b909fda9a1d3ef6fa9118e03a1cf668cff7ef6f18`，且 `cmp` 确认为字节级相同；包子路径和内部模块分别引用两份文件，违反协议唯一实现原则。
- CQ-012：正常运行代码仍存在三类兼容转换：Experience 读取 `metadata.md`/`experience-model.md` 为空时继续读取同名 JSON；`ensureHarnessBucket` 每次初始化都执行旧 `planUpdate*` 字段迁移；前端当前 Turn 消息选择在缺少 `turnScopeId` 时回退到 `dialogProcessId`。这些分支不位于独立迁移命令或工作区生命周期迁移边界。
- CQ-013：`agent-proxy/src/shared/config.js` 捕获配置读取/解析的所有错误并返回空配置；`model-proxy/src/config.js` 捕获后记录日志并继续使用默认配置。两处都无法区分文件不存在、JSON 损坏和 I/O 失败。
- CQ-014：使用相同阈值扩大重复度扫描到 1458 个一方文件后，确认 90 个克隆、1223 行重复代码（0.57%）；现有门禁只报告 573 个文件、7 个克隆。明确的跨边界命中包括 Agent/Service/Frontend 三份调试事件归一化、Agent Context Provider 与 Service Connector Route 的状态投影，以及 Context Protocol 与 Harness/Workflow 的消息规范化片段。克隆报告只证明代码重复，具体归属需在整改时通过调用链确定。
- CQ-015：`agent/src/shared/utils/json.js` 定义 `readJsonFile`，全仓生产源码没有导入或调用该模块；同时 Agent 已有 `shared/storage/json-file-reader.js` 作为持久化读取协议。
- CQ-016：`npm audit --omit=dev` 报告 5 个高危生产依赖告警。`mailparser@3.9.15` 是当前最新版本，但固定依赖 `html-to-text@10.0.0`，后者使用存在递归对象栈耗尽公告的 `deepmerge-ts@7.1.5`；`pm2@7.0.3` 是当前最新版本，但固定依赖存在 CPU 消耗公告的 `js-yaml@4.3.0`。审计器建议降级直接依赖，未采用该建议；是否可使用 override 或需要替换依赖必须通过能力回归验证。
- CQ-008：生产构建再次确认唯一超限产物仍是 662.09 kB 的 Mermaid parser chunk，状态保持“受上游限制”。

### 2026-08-19 第五批整改与验收

- CQ-007：新增共享 `runBestEffort` 协议，要求稳定操作名、结构化上下文、原始错误和诊断输出；队列恢复改为显式成功/失败续接，不再把业务失败当作清理。静态门禁扫描统一生产源码清单，确认 1647 个生产源码中不存在空 Promise 拒绝处理。Harness 锁清理只把 `ENOENT`、`ENOTDIR` 定义为幂等成功，其他删除失败仍进入诊断通道。
- CQ-009：根工作区、`scripts` 与 `user-template` 共同生成唯一生产源码清单；复杂度、重复度、依赖循环和空 Promise 拒绝门禁复用该清单，测试、构建、生成物、第三方与运行数据由清单协议显式排除。当前重复度门禁覆盖 1658 个源码，依赖图覆盖 1563 个模块。
- CQ-010：权威 Turn 生命周期按事件校验、转换决策和状态投影拆分；前端 Turn Reducer、Runtime Event Reducer、权威运行时与生命周期快照投影使用各自单一入口。相关生命周期测试 168 项通过，新增模块均锁定零复杂度违规；全仓复杂度基线收紧为 611 个复杂度超限、131 个长函数、最高复杂度 106，只允许减少。
- CQ-011：Turn Scope Identity 的唯一实现保留在 `session-protocol/src/identity/turn-scope-identity.js`，原公开路径只做静态重导出；引用相等测试和协议边界守卫防止再次复制实现。
- CQ-012：Experience 运行时只读取当前 Markdown 协议，旧 JSON 只由 Workspace Lifecycle 显式迁移；Harness 旧 bucket 只在 Hook 边界迁移，正常 bucket 读取拒绝旧版本；前端删除缺少 `turnScopeId` 时按 `dialogProcessId` 选择当前 Turn 的回退。迁移与普通读取职责已分离。
- CQ-013：Agent Proxy 与 Model Proxy 统一使用共享配置文件协议；只有 `ENOENT` 使用默认值，损坏和非对象配置返回 `CONFIG_FILE_CORRUPTED`，其他读取失败返回 `CONFIG_FILE_READ_FAILED` 并阻止启动。
- CQ-014：调试投影归属共享叶子模块，连接器状态投影归属 Agent Config Protocol，Context 文本、角色与字段读取归属 Context Protocol；Agent、Service、Frontend、Harness 与 Workflow 删除对应重复实现。重复度基线为 168 个克隆、4425 行、1.8317%，只允许下降。
- CQ-015：删除无生产引用的 `agent/src/shared/utils/json.js`，持久化 JSON 读取继续由唯一存储协议负责。
- CQ-016：`npm audit --omit=dev` 仍报告 5 个高危项。当前链路为 `mailparser@3.9.15 -> html-to-text@10.0.0 -> deepmerge-ts@7.1.6` 和 `pm2@7.0.3 -> js-yaml@4.3.0`；上游直接依赖精确锁定了存在公告的版本，而已修复版本分别为 `deepmerge-ts@8.0.1`、`js-yaml@5.3.0`。审计器仅建议强制降级直接依赖，仓内 override 不能形成受上游支持的解析图，因此未采用降级、忽略或虚假 override。
- 全仓验收：`npm run check:quality`、`npm test`、`npm run build` 和 `git diff --check` 通过。Harness 354 项、Workflow 98 项、前端 170 个测试文件 / 1161 项测试全部通过。生产构建唯一警告仍是 CQ-008 已记录的 Mermaid parser 662.09 kB 上游单模块。

## 定向验证记录

- Session Protocol：35 项通过。
- Harness：353 项通过；依赖图守卫通过，零循环。
- 上下文消息构建：13 项通过。
- Memory 与 Workspace Lifecycle：20 项通过。
- Session Storage、Artifact 与维护：33 项通过。
- Capability Runner 与插件准备：16 项通过。
- Execution Listener、Bot 清理、Turn Persister、Attachment 与 Session 维护：41 项通过。
- 前端共享消息预览与基础预览：19 项通过。
- 第二批定向验证：Detached Sub-session、模型切换和 Harness Store 29 项通过；Workflow Node Agent 16 项通过；Message Preview、共享消息预览、基础预览和 Workflow Viewer 44 项通过。
- 全仓质量门禁：`npm run check:quality` 通过。
- 全仓测试：`npm test` 通过；前端部分为 170 个测试文件、1161 项测试全部通过。
- 生产构建：`npm run build` 通过。
- 第三批定向验证：Workflow Node Session Viewer 16 项、文件预览和消息组件 17 项、WebSocket 运行/停止/继续/重连/生命周期 63 项全部通过；调整预览尺寸契约后，文件预览与预览内容 19 项再次通过。
- 第三批全仓质量门禁：`npm run check:quality` 通过；复杂度基线为 515 / 119 / 106，源码依赖图为 631 个模块零循环。
- 第三批全仓测试：`npm test` 通过；Agent 947 项、Workflow 98 项、Harness 354 项、前端 170 个测试文件 1161 项全部通过。
- 第三批生产构建：`npm run build` 通过；唯一警告仍为 CQ-008 记录的 Mermaid 上游单模块 chunk。
