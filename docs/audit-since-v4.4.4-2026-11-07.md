# v4.4.4 以来改动审核（2026-11-07）

## 独立复核（2026-11-07，第二次）

本次重新检查下表涉及的协议、调用方、启动诊断、生成请求与附件链路、锁登记和失败清理代码，并重跑相关包测试、质量门禁及构建，没有沿用下文旧日志作为复测证据。接手时这些修复已在工作区，本次仅更新本文档，不将已有代码修复归为本次新增。

| 分类                   | 核实结果                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 已完成                 | 2.1–2.4、3.1–3.10、第 4 节全部条目、第 5 节门禁整改，以及补充的 desktop 日志错误传播和锁登记心跳修复；代码与本次复测一致。 |
| 已确认未处理的实现问题 | 无。无需重复修改已通过验证的实现。                                                                                         |
| 待验证                 | 历史单次锁超时与登记心跳缺陷的准确因果关系：旧日志缺少续期与删除时序，现有可控复现不能补出历史事实。                       |
| 验证边界               | 原生生成厂商接口仍使用模拟 HTTP 验证，未调用真实收费接口；agent 有 1 项跳过，不计作通过。                                  |

本次日志均位于用户工作区 `runtime/ops_workdir/`：

| 本次执行                                                  | 结果                               | 日志                         |
| --------------------------------------------------------- | ---------------------------------- | ---------------------------- |
| agent 全包（含锁协调 13 项）                              | 2030 通过、0 失败、1 跳过          | `audit-current-agent.log`    |
| agent-config / model-protocol / model-runtime             | 107 / 84 / 153 通过，均 0 失败     | `audit-current-packages.log` |
| service / client-shared / runtime-events / startup        | 384 / 131 / 66 / 4 通过，均 0 失败 | 同上                         |
| harness / file-mutation / execution-isolation / workspace | 470 / 34 / 24 / 31 通过，均 0 失败 | 同上                         |
| chat（含前置结构、样式及插件边界检查）                    | 241 个文件、1761 项测试全部通过    | `audit-current-chat.log`     |
| 质量门禁                                                  | 49/49；基线实测与下文记录一致      | `audit-current-quality.log`  |
| startup / chat 构建                                       | 均通过                             | `audit-current-build.log`    |
| 工作区差异空白检查                                        | `git diff --check` 通过            | 命令输出，无单独日志         |

复核还确认：startup 的 `translateModelPicker` 仅从入口 `messages` 取值；生成附件协议已保证 MIME 扩展名映射有效，消费端无需重复校验；runtime 的厂商选项检查针对具体 API 支持范围，与协议的 image/video 字段合法性检查职责不同。未据此新增兼容分支或重复校验。

## 整改核实（2026-11-07）

以下为当前代码与复测状态。后文保留初次审核原文用于追溯，其中的失败计数、行号、工作区规模和“需决策”标签不代表当前状态。工作区包含整改开始前已有的未提交改动，不能将完整 diff 归为本轮新增修复。未提交或发布代码。

本轮逐项核对代码并重新运行相关测试：原审计 2–5 节的整改均已存在且验证通过；接手时未闭环的是补充记录中的锁协调偶发超时。本轮另行复现并修复等待者登记期间缺少心跳的缺陷，纠正锁回收选举测试对 20ms 调度时限的依赖。当前没有已确认而未处理的实现项；历史单次超时与上述缺陷的准确因果关系仍待验证，不能从旧日志反推。

### 问题状态

| 原编号          | 状态   | 最终处理与代码证据                                                                                                                                                                                        |
| --------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1             | 已完成 | `model-protocol/src/model/provider-spec.js` 定义对话能力缺省为 false；配置引用、上下文和模型工具统一消费 `resolveModelUsedForConversation`，删除实现层相反推断；测试夹具显式声明能力。                    |
| 2.2             | 已完成 | `generation-options.js` 导出 image/video 字段映射；工具 schema 按 `output_type` 构造严格联合并消费该映射，视频参数在入口拒绝 image 专属字段。协议与工具测试覆盖。                                         |
| 2.3             | 已完成 | 保留损坏原文，按配置协议产出带路径诊断，不备份后自动覆盖；更新 desktop 修复测试，覆盖用户显式纠正后恢复同步及日志不泄露正文。操作说明见下文。                                                             |
| 2.4             | 已完成 | 模型库升级与无需升级分支均诊断模型引用；未来版本显式拒绝。service/desktop 消费最终修复报告，headless 写入协议化启动诊断事件；重复启动诊断一致。悬空引用保留并报错，由用户明确选择有效模型，不推断替代项。 |
| 3.1             | 已完成 | 配置引用契约和模型选择器消费协议支持的生成类型，删除不可达的 `generate:audio`；音频解析能力保留。                                                                                                         |
| 3.2–3.4         | 已完成 | 错误码统一为 `CONFIG_ERROR_CODE`；`configIssueBlocksStartup` 读取 issue 自身 impact；scope 独立到 `contract/scope.js`，消除契约对修复层的依赖。                                                           |
| 3.5             | 已完成 | 模型引用要求显式提供 requirement、非空 path 和字符串 alias；移除 providers 空对象回退与错误路径二选一。缺失 provider 作为待诊断事实传入。                                                                 |
| 3.6             | 已完成 | `model-request-executor.js` 按 operation 分派原生生成，移出会话适配器。新增执行器测试覆盖 OpenAI 与 Anthropic 会话适配器均只发一次原生生成请求，并保留取消信号。                                          |
| 3.7             | 已完成 | `Api-Revision` 收敛到 `model-protocol/src/model/model-capabilities.js` 的生成 API 协议。                                                                                                                  |
| 3.8             | 已完成 | 工具建立单一生成超时信号，执行器、轮询、媒体下载共享该信号，删除 runtime 和下载阶段重复超时。                                                                                                             |
| 3.9–3.10        | 已完成 | startup 组件消费入口 messages/modelOptions，desktop 和 startup 全程保留 alias；删除 bridge 的缺失选项构造及自动选首项。chat 契约测试按显式文案入口验证语言切换。                                          |
| 4：附件分支     | 已完成 | 删除重复 MIME 扩展名检查；MIME 支持范围由 `normalizeGeneratedMediaArtifact` 统一验证，下载仍验证实际响应 MIME、模态和非空字节。fetch 注入依赖校验有明确职责，予以保留。                                   |
| 4：clock/fetch  | 已完成 | 删除原生生成中的 clock/fetch 默认回退；生产宿主显式注入 fetch，执行器提供时钟端口。                                                                                                                       |
| 4：HTTP 错误    | 已完成 | 删除 payload 错误文案回退链；HTTP 状态、错误 payload 显式抛出，并在读取 JSON 前校验响应模式。                                                                                                             |
| 4：工具默认值   | 已完成 | 删除执行函数入参默认值对象；image 缺省由工具 schema 声明。                                                                                                                                                |
| 4：parse 结果   | 已完成 | 非数组 output 显式拒绝，删除静默转空数组；协议与 runtime 测试通过。                                                                                                                                       |
| 4：请求日志审计 | 已完成 | 删除 `contents/input/content` 优先级回退，逐一审计实际存在的消息容器及 prompt，空容器不掩盖后续系统消息顺序错误；新增多容器与嵌套输入测试。                                                               |
| 5：复杂度       | 已完成 | 按职责拆分 repair、模型引用遍历、模型选择、搜索校验、附件重写、百分号解码、desktop 用户同步和 MCP 工具调用；Markdown 外部回调完整转发原参数。按实测收紧基线，未增加豁免。                                 |
| 5：其余门禁     | 已完成 | 清理违规注释、格式化；i18n 入口归位；重复与回退基线按实测收紧，完整质量门禁通过。                                                                                                                         |

补充修复：desktop 日志写入失败不再仅在 debug 下记录或吞掉；立即向 stderr 报告，`flush()` 等待所有在途写入并汇总失败。新增测试覆盖失败先于 flush 完成、错误传播及用户纠正文件路径冲突后恢复写入。

### 本轮补齐的锁协调闭环

- **登记期间的心跳空窗：已修复。** `agent/src/shared/storage/file-mutation-coordinator.js` 原先分别创建 choosing 和 settled 文件，登记完全结束后才启动心跳。settled 写入返回延迟超过租期时，另一等待者会删除它；原等待者随后对已删除文件的句柄续期，最终持续等待直至 `SESSION_MUTATION_BUSY`。新增慢 I/O 用例在修复前复现首个等待者失败，日志为 `audit-lock-registration-before.log`。
- **统一登记生命周期。** 创建 choosing 文件后立即启动心跳，沿用同一打开的文件和心跳，通过原子 rename 发布 ticket；成功、写入失败和 rename 失败都经 `closeWaiter` 停止心跳、关闭句柄并清理登记文件。删除旧的两文件切换流程，未新增重试旁路或改变生产超时配置。
- **选举测试的调度假设：已纠正。** 旧用例设定 staleMs=20，同时持锁等待 30ms，混合了回收选举与极短租期心跳行为；注册缺陷修复后，全包仍在该用例失败（`audit-recheck-agent.log`）。改为读取 `readConfiguredLockTiming()` 的实际租期，将遗留锁的 mtime 设置为两个租期前，保留三方竞争、互斥、全部进入及文件清理断言。短租期心跳和持锁续期仍由独立用例覆盖；未放宽 2000ms 获取超时。
- **资源与错误闭环：已验证。** 新增 write/rename 两种失败用例，验证原始错误传播、不进入临界区、句柄关闭、目录无残留且关闭后不再心跳。最终 agent 全包包含锁协调 13 项全部通过。

### 验证证据

结果日志位于当前任务工作区 `runtime/ops_workdir/`，不提交生成日志。

| 验证                                                                      | 当前结果                        | 日志                                                   |
| ------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------ |
| agent 最终全包复测                                                        | 2030 通过、0 失败、1 跳过       | `audit-recheck-agent-final.log`                        |
| 配置协议                                                                  | 107/107                         | `audit-recheck-protocol.log`                           |
| 模型协议 / 模型运行时                                                     | 84/84、153/153                  | 同上                                                   |
| service / runtime-events                                                  | 384/384、66/66                  | `audit-recheck-service.log`                            |
| client/shared / startup                                                   | 131/131、4/4                    | `audit-recheck-service.log` / `audit-recheck-chat.log` |
| chat                                                                      | 241 个文件、1761 项测试全部通过 | `audit-recheck-chat.log`                               |
| MCP 生命周期及调用契约                                                    | 全部通过，包含在 agent 全包中   | `audit-recheck-agent-final.log`                        |
| 锁协调                                                                    | 13/13，包含在 agent 全包中      | 同上                                                   |
| plugin-harness / file-mutation / execution-isolation / workspace-protocol | 470/470、34/34、24/24、31/31    | `audit-recheck-boundaries.log`                         |
| 质量门禁                                                                  | 49/49                           | `audit-recheck-quality-final.log`                      |
| startup / chat 构建                                                       | 均通过                          | `audit-recheck-build.log`                              |

质量实测与基线一致：complexity `117/56/48/73/242/37`（依次为复杂函数、长函数、最大复杂度、嵌套三元、深嵌套、长参数列表）；duplication `26/313`；fallbackChain `242`、rawTypeof `416`、inlineTrim `48`。这些是当前仓库存量上限，并不表示全仓违规已清零。

验证边界：原生生成使用模拟 HTTP 覆盖各厂商请求与响应契约，未调用收费厂商接口，不代表真实厂商端到端验证。MCP 保持“先报告未知工具、仅对实际执行要求请求绑定”的契约，本轮全包再次通过。锁登记缺陷已有修复前失败、修复后通过的可控证据；旧日志未记录等待者续期与删除时序，因此历史偶发超时的准确归因仍待验证，不宣称所有调度环境下的锁问题均已排除。

### 损坏配置与悬空模型引用的用户处理闭环

1. 在桌面端 userData 目录的 `logs/desktop-main.log` 查找 `[main:config-diagnostic]`，使用其中的 `file=` 路径定位配置；headless 的运行事件使用 `service.startup.config.diagnostic`，包含 filePath 和 issue。按实际诊断定位，不猜测 workspace 用户目录。
2. 对 `INVALID_CONFIG_DOCUMENT`，先保留本地副本，再用编辑器修正原文件的 JSON 语法并校验；保留原有有效字段，不用空配置覆盖。诊断不会输出可能含凭证的配置正文。
3. 对 `MODEL_REFERENCE_NOT_FOUND` 或能力不匹配，按 issue.path 找到字段，用配置界面列出的有效 alias 显式选择具备所需能力的模型。系统不替用户猜测退役模型的替代项。
4. 保存后重启桌面端，或重新启动 headless 服务触发同步与诊断。确认该文件不再报告对应 issue，并验证目标操作可执行。用户 JSON 原文保留、显式纠正、再次同步的完整路径已有自动测试覆盖。

## 初次审核原文（历史记录）

范围：`v4.4.4..HEAD` 5 个提交 + 工作区 159 项未提交改动（427 文件，+15.8k/-5.5k）。
分级：**本次引入** = 与 v4.4.4 对比确认新增；**存量** = v4.4.4 已存在；**待验证** = 证据不足；**需决策** = 实现与契约冲突，需先定方向。

## 1. 测试结果

| 包                                                                                         | 结果                | 结论                       |
| ------------------------------------------------------------------------------------------ | ------------------- | -------------------------- |
| agent                                                                                      | 1943/2028，失败 84  | 本次引入，单一根因，见 2.1 |
| service                                                                                    | 383/384，失败 1     | 存量，见 2.4               |
| client/shared                                                                              | 129/130，失败 1     | 本次引入，需决策，见 2.3   |
| model-protocol / model-runtime / agent-config-protocol                                     | 84 / 152 / 107 全过 | —                          |
| client/noobot-chat                                                                         | 1761/1761 全过      | —                          |
| plugin-harness / file-mutation / execution-isolation / workspace-protocol / client/startup | 全过                | —                          |
| i18n                                                                                       | 无 `test` 脚本      | 不是失败                   |

## 2. 功能缺陷

### 2.1 `used_for_conversation` 语义分裂，agent 84 项连锁失败（本次引入）

- 契约 `agent-config-protocol/src/contract/model-reference.js`：`conversation: provider.used_for_conversation === true`，缺省视为不可对话。
- 运行时 `agent/src/context/providers/model-provider.js:42-58`、`agent/src/tools/ai-models/model-tool.js:30`：`undefined` 推断为 `true`。
- 协议 `model-protocol/src/model/provider-spec.js:400` 只声明为可选布尔，没有定义缺省值。
- 同一事实有两套相反的语义。共享夹具 `agent/__tests__/helpers/test-model-config.js` 的 `test_default` 没有声明该字段，`resolveEffectiveModelSpec` → `requireModelReference` 抛 `MODEL_REFERENCE_CAPABILITY_MISMATCH`。runner、dispatch、tool-binding-http（18 项）等全部失败都是这一条连锁，失败输入均为这条 ExecutionFailure。
- 存量数据：5 份 workspace 配置都显式声明了该字段（缺失 0），线上不受影响。
- 修复方向：在 `MODEL_PROVIDER_CONFIG_CONTRACT` 定义唯一语义（必填并由 repair 补齐，或给出唯一协议缺省值），删除实现层两处 `undefined` 分支，夹具按协议声明。不要只补夹具字段。

### 2.2 视频生成显式参数被协议拒绝（本次引入，已复现）

- 工具 schema（`multimodal-generate-tool.js`）对所有 `output_type` 都暴露 `n`、`quality`、`complexity`。`generation-operation.js` 会原样透传 `quality`、`complexity`，`n !== 1` 时也会透传 `n`。
- `model-protocol/src/protocol/generation-options.js` 的视频白名单只有 `duration/aspectRatio/resolution/imageUrls`。
- 复现结果：视频请求传入 `n:2`、`quality:"high"`、`complexity:"low"` 都抛出 `unsupported video generation option`。现有测试没有覆盖。
- 修复方向：工具入参按 `output_type` 区分字段（由协议导出各模态的选项集合），不在工具层再建一套规则。

### 2.3 损坏的用户 JSON 不再备份恢复（本次引入，需决策）

- `client/shared/electron/runtime/config.js` 删除了 `readJsonFileForRepair`（备份为 `.invalid-*` 后恢复），改为 `parseConfigDocumentText` 抛错，再由 `reportUserConfigError` 记诊断日志，损坏文件原样保留。`CONFIG_REPAIR_ACTION.RESTORE_INVALID_DOCUMENT` 在仓库中已无引用。
- `client/shared/tests/electron/desktop-config-repair.test.js:14` 仍按旧契约断言。该用例在 v4.4.4 通过，当前失败。
- 需决策：如果采用"只诊断不自动恢复"，就更新测试并补充"用户如何修复"的闭环说明；否则恢复备份路径。

### 2.4 模型库升级留下悬空 `default_provider`（存量）

- `agent-config-protocol/src/pipeline/model-library-upgrade.js` 删除非 custom 的退役 provider 后，没有校验或回写 `default_provider` 及其他模型引用。`service/__tests__/model-library-startup-upgrade.test.js` 的 versioned 用例在 v4.4.4 上同样失败。
- `model_library_version` 高于当前版本（`+1`）时，也会按"需要升级"处理，并改写为更低版本。协议没有定义未来版本的处理方式，应当显式拒绝。
- 修复方向：升级后用 `diagnoseConfigModelReferences` 产出 issue，或由协议规定引用如何迁移；对未来版本抛 `INVALID_MODEL_LIBRARY_CONFIG`。

## 3. 协议 / 单一事实源 / 职责

| #    | 问题                                                                                                                                                     | 证据                                                                                                                                                   | 级别              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| 3.1  | `generate:audio` 无法闭环：契约和前端选择器都声明了它，但生成协议只支持 image/video                                                                      | `model-reference.js` REQUIREMENTS；`client/shared/ui/ModelPicker.vue` capabilities；`model-capabilities.js` GENERATION_API_OUTPUTS；`operation.js:128` | 本次引入          |
| 3.2  | 错误码来源不统一：`CONFIG_ISSUE_POLICY` 部分用 `CONFIG_ERROR_CODE`，部分用裸字符串；`model-library-upgrade.js` 也直接写 `"INVALID_MODEL_LIBRARY_CONFIG"` | `contract/issues.js`                                                                                                                                   | 本次引入          |
| 3.3  | `createConfigIssue` 已把 `impact` 写入 issue，`configIssueBlocksStartup` 又查一次策略表，同一事实读两次                                                  | `contract/issues.js`                                                                                                                                   | 本次引入          |
| 3.4  | 契约层依赖修复层：`issues.js` 从 `repair.js` 引入 `CONFIG_DOCUMENT_SCOPE`                                                                                | `contract/issues.js:5`                                                                                                                                 | 本次引入          |
| 3.5  | 默认值掩盖调用方必须提供的事实：`requirement="model"`、`path=[]`、`document.providers \|\| {}`，报错信息又用 `issue.path \|\| issue.alias`               | `model-reference.js:43,59,72`                                                                                                                          | 本次引入          |
| 3.6  | 原生生成分派（8 家厂商）挂在 OpenAI 兼容适配器下，职责错位；非 openai-compatible 适配器能否进入生成路径待验证                                            | `openai-capability-adapter.js:69`、`native-generation.js`                                                                                              | 本次引入 / 待验证 |
| 3.7  | `Api-Revision: "2026-05-20"` 写死在 runtime，没有进入协议或 model-library                                                                                | `native-generation.js`                                                                                                                                 | 本次引入          |
| 3.8  | 生成超时起了两次（请求一次、下载一次），总耗时上限实际可达 2 × `generationTimeoutMs`                                                                     | `native-generation.js`、`generation-artifacts.js`                                                                                                      | 本次引入          |
| 3.9  | startup 绕过入口传入的 `messages`，直接导入 `noobot-i18n` 并手写 `translateModelPicker`，同一文案有两个来源                                              | `client/startup/src/components/SuperAdminSetupForm.vue:85,100`                                                                                         | 本次引入          |
| 3.10 | 字段错位：startup 用 `alias: item.key` 改名，desktop 用 `key: alias` 反向改名，选项字段没有对齐 `createClientModelOptions` 契约                          | `SuperAdminSetupForm.vue:98`、`electron/runtime/config.js` collectModelOptionsFromConfig                                                               | 本次引入          |

## 4. 兜底 / 僵尸代码

- `generation-artifacts.js`：`typeof fetchImpl !== "function"` 是对注入依赖的防御校验。`!MIME_TO_EXTENSION[mediaType]` 永远不成立，因为上一行已强制 `mediaType === artifact.mimeType`，`normalizeGeneratedMediaArtifact` 也已校验过，属于死分支。
- `native-generation.js`：`input.clock || SYSTEM_CLOCK_PORT`；`openai-capability-adapter.js`：`fetchImpl = globalThis.fetch`。
- `native-generation-http.js`：`payload.error?.message || payload.message || HTTP` 回退链。
- `multimodal-generate-tool.js` `runMultimodalGeneration`：用默认值对象补齐入参，`output_type` 缺省为 `"image"`，没有由 schema 或调用方声明。
- `operation.js` MULTIMODAL_PARSE 结果：`output` 不是数组时静默降级为 `[]`（待验证是否为本次引入）。
- `scripts/quality/model-context-convergence/request-log-audit.mjs`：`body.contents || body.input || body.content` 新增三段回退。

## 5. 质量门禁（`npm run check:quality` 6/49 失败）

与 v4.4.4 的样本做全量差集（去掉行号后比较）的结果：

| 门禁            | 现状                                                         | 结论                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| complexity      | 实测 119/56/48/74/250/39，均不高于 v4.4.4（120/…/74/251/41） | 基线被预先压到 118/73/247/38，低于实测，属于"基线先收紧、修复没跟上"。本次引入的违规项：`repair.js` `repairStructureNode`；`model-reference.js` `visit`（5 参数、嵌套 3 层）；`config-resolver.js:49` 嵌套三元；`file-search.js`、`attachmentInlineRefPlugin.js`×2、`preview-resource-budget.js`、`electron/runtime/config.js` 深嵌套；`markdown-renderer.js` 长参数（由 `useMarkdownRenderer` 迁入）；`task-runner.js` `runMcpTaskWithTools`（由 `executeMcpTask` 迁入） |
| fallback-chain  | fallbackChain 244 > 243                                      | 净新增 `model-reference.js` `issue.path \|\| issue.alias` 和 `request-log-audit.mjs` 三段链；rawTypeof 416 < 420，基线应下调                                                                                                                                                                                                                                                                                                                                              |
| source-comments | 12 处                                                        | `client/shared/styles/**` 11 个 CSS 文件头注释，以及 `agent-config-protocol/src/contract/repair.js:47`                                                                                                                                                                                                                                                                                                                                                                    |
| format          | 10 个文件                                                    | `client/shared/ui/ModelPicker.vue`、`model-library-upgrade.js`、`multimodal-generate-tool.js`、`i18n/src/client/locales/en-US.js` 等                                                                                                                                                                                                                                                                                                                                      |
| i18n-imports    | 1 处                                                         | 即 3.9                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| duplication     | 26/313 < 27/322                                              | 正向变化，基线应下调                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

另外：`check-fallback-chain-baseline.mjs` 的 vendor-adapters 豁免已移除 `inlineTrim`，计数仍为 48，说明适配器内没有 inlineTrim，这项收紧有效。

## 6. 已确认无问题

- 生成链路只有一条：旧的 `requestJson` 已从 `openai-capability-adapter.js` 删除，`MEDIA_GENERATION` 统一走 `executeNativeGeneration`，没有两套并存。
- `BaseModelPicker.vue` 只是 `client/shared/ui/ModelPicker.vue` 的薄适配层（注入 locale、抽屉尺寸、返回键历史），不是重复实现。

## 7. 建议修复顺序

1. 2.1 `used_for_conversation` 协议定义唯一语义（一处修复解除 84 项失败）。
2. 2.3 拍板损坏 JSON 的处理策略。
3. 2.2、3.1：生成选项和 `generate:audio` 收敛到协议。
4. 3.2–3.5 契约整理，同时消除 `model-reference.js` 的门禁违规。
5. 第 4 节兜底与死代码清理；3.9、3.10 前端对齐。
6. 门禁收口：format、注释、基线按实测下调；2.4 存量修复。
