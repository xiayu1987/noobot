# v4.4.4 以来改动审核（2026-11-07）

## 整改复验（2026-11-09，A1–A4 / S1–S3 / V1–V2）

本节承接下方增量审核。用户已授权修复全部问题；下文“尚未修复”“待明确”保留为审核时的历史记录，当前状态以本节为准。本轮修改尚未提交。

| 编号 | 修复结果与权威归属                                                                                                                                                                                                                                                         | 验证依据                                                                                                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1   | 工具 schema 删除默认模型解析，只消费静态结构与本地化说明。默认模型错配在操作执行期通过 `diagnoseModelReference` 返回明确诊断，不阻断工具构造或显式选择合法模型。                                                                                                           | `agent/__tests__/tools/multimodal-generate-tool.test.js` 覆盖错配时双语 schema 构造、默认操作拒绝且不发请求、显式合法模型成功。                                                                             |
| A2   | 删除工具层尺寸校验及 API 类型解析，尺寸规则唯一归属 model-protocol，由 model-runtime 执行边界校验。                                                                                                                                                                        | 生成工具回归、`model-runtime/__tests__/native-generation.test.js` 和协议尺寸用例通过。                                                                                                                      |
| A3   | 删除全 API 英文规则拼接与无消费方的 `describeImageGenerationSizes`，字段说明改为简短双语文案，不依赖默认模型。                                                                                                                                                             | 生成工具回归验证两种语言，不再包含默认模型/API 全量规则。                                                                                                                                                   |
| A4   | 将可接受尺寸字段及互斥约束放入 `IMAGE_SIZE_RULES`，统一消费；图片类型提取为本模块常量。                                                                                                                                                                                    | `model-protocol/__tests__/media-generation.test.js` 验证合法值、非法值及 DashScope 互斥。                                                                                                                   |
| S1   | 健康探测唯一入口为 `health-probe.js`，明确区分就绪、未就绪、连接拒绝、超时。畸形响应、HTTP 错误和未知异常保留 cause 并拒绝启动，定时器始终清理；协调者只在状态变化时记录日志。异常通过 `messageKey/messageParams` 传至启动页，消息和日志支持切换语言，并显示具体响应错误。 | `health-probe.test.js`、桌面启动测试及 `client/startup/__tests__/health-diagnostics.test.js`；后者实际串起探测 → bootstrap → Vue bridge，覆盖 HTTP 401、字段错误、JSON 错误与未知错误，验证双语消息和日志。 |
| S2   | `attachment-protocol` 的 `projectAttachmentAccessRequest` 是访问身份契约，必需身份缺失明确拒绝；删除空 userId 默认值和空 URL 降级。卡片展示只读取解析关系，访问动作才构造地址，删除无用 userId 属性及传参。                                                                | `attachmentAccessContract.spec.js` 对每个身份字段的缺失/空白逐一验证，URL 编码及聊天消息链路回归通过；测试明确提供身份。                                                                                    |
| S3   | workflow 抽屉删除宿主私有类名，由插件自有样式负责遮罩、header、body 和移动端布局，使用公开设计令牌。                                                                                                                                                                       | 源码对照、质量门禁、前端回归与构建；浏览器人工视觉验证未执行。                                                                                                                                              |
| V1   | 中英文模型协议明确“同 executor、同 scope 的相邻 HTTP 请求体 UTF-8 字节比较”；新 executor 没有基线，不代表完整会话复用率或供应商缓存命中率。分块比较替代长前缀逐字节扫描，比较块阈值统一到 shared 并补齐双语参数目录。                                                      | `model-runtime/__tests__/audit-closure.test.js` 验证分块边界、UTF-8 字节数、scope 与 executor 隔离；每 scope 仍保留最新完整请求体直到 executor 释放，未做性能压测，不宣称实测收益。                         |
| V2   | `ModelProtocolError` 默认分类收敛为 `protocol` 且不可重试；流模式策略禁止协议错误隐式切换模式重放。明确的上游失败响应仍按其协议分类处理。                                                                                                                                  | 协议分类、Anthropic 重复起始帧、Responses 终止帧及执行报告回归通过，保留失败计量和 usage 不可用断言；协议错误仅一次请求。                                                                                   |

最新业务代码已实际重跑 `test:all` 与构建：43 个 Node 汇总块共 5870 项，5868 通过、0 失败、2 条环境跳过；chat 244 个文件、1773 项全部通过；startup/chat 构建通过，仍有大 chunk 告警。质量复验因兜底链从 242 降到 241 触发“旧基线需收紧”，已同步降低基线；依赖默认值基线同样从 88 收紧到 86，没有放宽规则或新增豁免。收紧后再次执行质量门禁，结果为 **49/49 通过**；`git diff --check` 通过，临时 EOF 复现脚本已确认不存在。A1–A4、S1–S3 已完成代码整改，V1/V2 已通过协议明确及回归验证闭环。

日志位于用户工作区 `runtime/ops_workdir/`：`fix-all-tests-verified.log`、`fix-all-quality-verified.log`、`fix-all-build-verified.log`。自动验证使用模拟接口，未调用真实收费模型；未执行桌面安装包实机测试、浏览器人工视觉验收或性能压测。这些验证边界不作为已验证结论。

## 增量复核（2026-11-09，范围 `73cc65ffd..c87f253fa`）

完整范围为 `v4.4.4..c87f253fa`：15 个提交、546 个文件（+25335/−5492）。本文此前已覆盖到 73cc65ffd，本次复核后续 7 个提交、106 个文件（+5510/−730），并核对旧问题的提交状态。开始时工作区干净。本节只记录审核结果，没有修改业务代码；下文旧节的“当前没有未处理项”仅代表当时状态，以本节为准。

**结论：尚未完全闭环。** 主流程收敛、计量终止处理和附件访问链路已有正向证据，但 c87f253fa 引入 1 项高风险功能缺陷及 2 项中风险职责/文案问题。门禁通过不能替代错误配置路径的验证。

### 本次引入：已确认问题

| 编号 | 级别 | 问题与证据                                                                                                                                                                                                                                                                                                                                                                     | 影响及根因修复方向                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1   | 高   | `agent/src/tools/ai-models/multimodal-generate-tool.js:363-370` 在 `generationSchema` 中解析默认图片模型并调用 `resolveModelGenerationApiType`。`audit3-schema-default.log` 记录：默认 image 指向 chat 模型时，协议诊断为 `MODEL_REFERENCE_CAPABILITY_MISMATCH`、`impact=operation`，schema 却抛 `TypeError: unsupported model generation API type:`；合法图片模型可正常构造。 | 为生成说明文案引入了构造期执行依赖，并额外解析一次模型。`agent/src/tools/index.js:92` 在构建整个工具数组时调用它，`context/application/build-agent-execution-context.js:86` 直接等待 `buildTools` 且不捕获，因此默认路径的执行上下文构建会拒绝，超出生成操作的边界；显式指定其他合法模型的机会也被提前阻断。schema 应只消费静态协议与本地化说明，模型引用诊断统一在操作执行期处理，删除构造期解析，不能捕获后静默隐藏工具。最外层如何展示失败尚未做界面验证。 |
| A2   | 中   | 同文件 `buildMediaGenerationRequest:218` 调用 `requireModelGenerationSize`，`model-runtime/src/adapters/native-generation.js:36` 对同一 operation 再调用一次。两处均来自 c87f253fa 的改动。                                                                                                                                                                                    | 规则定义已统一到 model-protocol，但执行责任重复；工具层提前拒绝还会绕过 runtime 的统一执行观测入口。删除工具层的 API 类型解析及尺寸校验，由 runtime 执行边界消费协议规则；保留工具 schema 的字段结构校验。                                                                                                                                                                                                                                                    |
| A3   | 中   | 同文件 `generationSchema:391` 将 `describeImageGenerationSizes()` 的英文全量规则拼到中英两种 `fieldSize` 文案后。文案入口为 `i18n/src/agent/locales/zh-CN/tool-schema/assistance.js:114` 和 `en-US/...:132`；`agent/__tests__/tools/multimodal-generate-tool.test.js:196-198` 在两种语言下均断言英文规则。                                                                     | 中文工具说明混入整段英文，且每次 schema 都枚举全部 API，包含当前调用不使用的规则；默认模型说明也不能代表显式 `model_name`。保留简洁双语字段说明和明确的参数契约，精确约束由协议校验反馈；同步更新固化该行为的测试，并检查全量规则描述函数是否还存在消费方。                                                                                                                                                                                                   |

低优先级整理项 A4：`model-protocol/src/protocol/generation-options.js:34-44` 使用 `"image"` 字面量，并在 `requireModelGenerationSize` 内对 DashScope 的 size/resolution 互斥及取值单独分支。它仍位于协议层，不能据此认定存在跨模块第二套契约或功能错误；可将选项来源与互斥约束归入 `IMAGE_SIZE_RULES`，统一消费。现有 `MODEL_GENERATION_OUTPUT_TYPES` 是数组，不是可直接引用 `.IMAGE` 的枚举，不能凭空假定常量接口。

### 存量问题

以下行为与 `v4.4.4` 源码对照后确认早已存在，不归为本次新增缺陷。

| 编号 | 证据                                                                                                                                                                                                     | 未闭环之处及建议                                                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1   | `client/shared/electron/runtime/services.js:241-257` 的 `isHealthy` 用 `catch { return false }` 合并网络、超时和 JSON 解析异常。v4.4.4 的两个健康探测已有同类吞错。                                      | 取消/超时、暂未就绪与畸形响应缺少可区分的诊断。正常未就绪仍可作为探测状态，但异常应通过明确结果契约传给启动协调者，由它决定等待、停止或报错，避免每次轮询重复日志。 |
| S2   | `client/noobot-chat/src/infrastructure/api/attachments/attachmentAccess.js:51` 的 `resolveAttachmentAccessMeta` 默认 `userId = ""`；下游 `chatApi.js:43-52` 在缺少 userId 或 attachmentId 时返回空 URL。 | 必需身份缺失被转换为空地址。应统一附件访问输入契约，由调用方提供身份，边界显式拒绝缺失；当前未复现正常生成图片路径丢失 userId，不能宣称该路径已经失败。             |
| S3   | `plugin/noobot-plugin-workflow/frontend/components/workflow-message-card/WorkflowNodeSessionDrawer.vue:212-213` 使用宿主 `noobot-side-drawer__body/__header`，前次审计已确认 v4.4.4 存在。               | 插件与宿主样式耦合仍未消除。应以明确的前端插件样式协议承接，或由插件独立承担自己的样式，删除隐式宿主依赖。                                                          |

### 待验证与性能边界

- **V1，前缀指标的生命周期语义：** `agent/src/bot/execution/runner/runtime-binding.js:82` 每次 dispatch 初始化模型宿主，`model-port-host.js` 创建 executor，`model-runtime/src/executor/model-request-executor.js:105` 的 `previousBodies` 属于该 executor。`request-measurement.js:21-40` 只与同 scope 的上一请求比较；新 executor 的首次请求为 `no_previous_request`。memory 摘要也创建辅助模型端口。因此当前基线不能覆盖不同 executor 之间的跨轮比较，不能将该指标解释为完整会话前缀复用率。是否符合产品预期、scope 与 executor 生命周期应如何写入协议，仍待明确；未据此认定内存泄漏。每个已观察 scope 保留一份完整 UTF-8 请求体，每次比较最坏线性扫描共同前缀，实际 CPU/内存影响尚未压测，不能报成已测性能退化。
- **V2，协议错误分类：** Responses 缺终止帧时，日志的失败码为 `MODEL_PROTOCOL_ERROR`，但分类为 `kind=unknown`、`retryable=false`。拒绝不完整输出已验证；这种错误类别和重试策略是否符合协议预期仍待核对，不能把自动重试作为默认修复。

### 已闭环或未发现新增断点

- **抽屉样式归属：** 3a52c5416 的 7 个文件与前次记录的修复一致，已正式提交；旧节“尚未提交”仅是历史状态。浏览器目测边界仍沿用前次记录。
- **流终止与计量：** 实际重跑 Responses 缺终止帧复现，`invoke` 以 `ModelProtocolError` 拒绝，`model.request.finished` 为 failed，四项 usage 均为 unavailable / `stream_interrupted`，没有把部分输出计为成功。日志见 `audit3-responses-eof-recheck.log`，原复现日志保留；V2 不影响这一结论。
- **计量数据闭环：** 请求事件经过协议校验；`model-request-metrics.js` 显式拒绝重复、未配对及终止后事件，`execution-model-measurements.js` 校验计数守恒和比例范围，前端缺少样本显示“—”。执行报告 v6 用 `legacy_not_collected` 明确区分历史缺失，未将旧报告推算为新指标。
- **删除与签名变更：** `buildAttachmentRefIndex` 的消费方已同步，`model-proxy/src` 未发现 cache-diagnostics 残留。生成图片访问 URL 与跨会话切换已有自动测试覆盖，S2 是缺失身份时的存量契约问题。
- **desktop：** 启动与重启统一检查取消/停止状态，代理就绪统一到 `ensureAgentProxyStarted`；探测定时器在 finally 清理。日志轮转改为 rename + appendFile，避免整文件读取。S1 的异常诊断仍需整改。
- **尺寸协议：** 各 runtime 适配器内原有尺寸正则已迁至 model-protocol，主方向正确；剩余 A1–A3 应沿这条主流程收敛，不恢复适配器私有规则。

### 验证证据及边界

日志在用户工作区 `/home/xiayu/projects/noobot/workspace/admin/runtime/ops_workdir/`。本节重新读取并核对既有全量验证日志；本次续写期间没有重新执行全量门禁、test:all 或构建。Responses EOF 复现另行实际重跑，避免将历史日志表述为本次新执行。

| 验证                          | 结果                                                   | 日志                                                            |
| ----------------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| 质量门禁                      | 49/49                                                  | `audit3-quality.log`                                            |
| test:all 中的 Node 测试       | 43 个测试汇总块，共 5865 项；5863 通过、0 失败、2 跳过 | `audit3-tests.log`                                              |
| chat 测试（与上一行分开计数） | 243 个文件，1771/1771 通过                             | 同上                                                            |
| startup / chat 构建           | 通过；有 chunk 体积告警                                | `audit3-build.log`                                              |
| 默认生成模型错配              | 复现 schema 构造 TypeError；对照的合法图片模型可构造   | `audit3-schema-default.log`                                     |
| Responses 缺终止帧            | 拒绝输出、请求 failed、usage 标为流中断；分类问题见 V2 | `audit3-responses-eof.log` / `audit3-responses-eof-recheck.log` |

两项跳过分别受 root 用户与 Windows 宿主条件限制，不计作通过。质量实测为 complexity `116/56/48/73/242/37`，duplication `26/313`、fallbackChain `242`、rawTypeof `416`、inlineTrim `48`；这些是存量基线，不代表规则违规已经清零。原生生成与流错误验证使用模拟 HTTP，未调用真实收费接口；未做新一轮浏览器人工验证或性能压测。

建议整改顺序：先 A1，补上“默认模型错配仍可构建工具、执行目标操作时明确诊断”的回归验证；再删除 A2 的重复执行入口并收敛 A3 的双语说明；随后处理 S1–S3 和 A4。V1/V2 先明确协议语义，再按协议验证实现。本次审核和文档记录已完成，上述实现问题尚未修复。

## 增量复核（2026-11-08，范围 `v4.4.4..73cc65ffd`）

范围：8 个提交，480 个文件（+19865/−4802）。前两次复核截止到 cc71cf878，本次新增审核 73cc65ffd（模型选择器按发布日期排序、共享样式调整），并重新检查 cc71cf878 引入的共享组件边界。复核开始时工作区干净；下表中的“已修复”项是本次改动，尚未提交。

| 分类           | 结论                                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 73cc65ffd 主体 | 闭环。发布日期、排序规则和消费方的边界清晰，未发现兜底或重复事实源。                                                                                                                     |
| 本次引入问题   | 1 项：共享 `ModelPicker.vue` 依赖 chat 内部样式（cc71cf878 引入），已按根因修复。                                                                                                        |
| 存量问题       | 1 项：workflow 插件依赖宿主抽屉样式类名（v4.4.4 已存在），本次未修改。                                                                                                                   |
| 待验证         | `.el-drawer__close-btn` 的颜色改由 Element Plus token 映射承接（`--el-text-color-*`、`--el-color-primary`），未在浏览器中目测确认；触发器单行省略后，长 alias 只能在抽屉列表中看到全称。 |

### 73cc65ffd 核实

- 单一事实源：发布日期只在 `model-protocol/model-library.json` 的 `releases` 中维护（57 条），`RELEASES.md` 只描述规则，不存数据。`createModelReleaseIndex` 在加载时校验日期必须是真实日历日、来源为 https、键必须对应库内模型 ID；不合法时抛错，不会静默跳过。
- 职责：排序 `sortModelsByReleaseDate` 定义在协议层，仓库内唯一消费方是 `client/shared/ui/ModelPicker.vue:26`；目录投影和候选项归一化保持配置顺序，与 RELEASES.md 的约定一致。
- 缺失日期：62 个库模型中有 5 个没有已验证日期（`deepseek-flash`、`glm-5.3-flashx`、`kimi-k3.1-pro`、`kimi-k3.1-pro-highspeed`、`grok-imagine-video-1.5-lite`）。按协议它们排在有日期的模型之后，并保持输入顺序。`resolveModelRelease` 对这些模型显式返回 `null`；排序时 `""` 只作为比较键，不会写回数据或对外暴露，不属于用默认值掩盖事实。
- 版本链：`releases` 不写入用户配置，`model-library-upgrade.js` 只比较 `version`，因此新增该字段不需要提升 `model_library_version`；`check:version-chain-coverage` 通过。
- 可访问性：触发器改为原生 `<button>`，保留 `aria-haspopup`、`aria-expanded`、`aria-label`。焦点由共享规则 `.noobot-choice-control:focus-visible` 的 `--noobot-focus-ring` 提供，组件内 `outline: none` 不会造成焦点不可见。完整的 WCAG 结论仍需要辅助技术人工测试。

### 本次修复：共享抽屉样式归属

- 根因：cc71cf878 让 `client/shared/ui/ModelPicker.vue` 使用 `noobot-side-drawer`、`noobot-side-drawer-modal`，但这两个类只定义在 chat 内部的 `src/shared/styles/components/drawer.css`。startup 只引入 client-shared 样式，修复前它的构建产物中 `noobot-side-drawer` 命中数为 0，抽屉 header 内边距、遮罩和移动端全高布局都不生效。
- 修复：按 `check-frontend-styles.js` 的既有契约（Element Plus 集成样式只放在 `client/shared/styles/integrations`，并由 `element-plus.css` 引入），新增 `element-plus-drawers.css`，并删除 chat 的 `drawer.css` 及其 import。同时删除冗余的 `workspace-drawer` 并列选择器：所有用到它的地方都同时带有 `noobot-side-drawer`，`workspace-drawer-modal` 也没有消费方。选择器契约已登记到 `formContractFiles`。
- 层叠顺序：共享样式现在排在 chat 组件样式之后。原先文件预览抽屉的 body 覆盖规则依赖 import 顺序才能生效，迁移后会被通用规则反超。本次没有调整 import 顺序，而是把两个变体改成与基类组合的选择器（`.noobot-side-drawer.noobot-file-preview-drawer .el-drawer__body`、`.noobot-side-drawer.model-picker-drawer .el-drawer__body`），明确表达“变体覆盖基类”。
- 改动文件：`client/shared/styles/integrations/element-plus-drawers.css`（新增）、`client/shared/styles/element-plus.css`、`client/noobot-chat/src/shared/styles/style.css`、`client/noobot-chat/src/shared/styles/components/drawer.css`（删除）、`client/noobot-chat/src/shared/styles/components/preview.css`、`client/shared/ui/ModelPicker.vue`、`client/noobot-chat/scripts/check-frontend-styles.js`。

### 存量：插件依赖宿主样式类名

`plugin/noobot-plugin-workflow/frontend/components/workflow-message-card/WorkflowNodeSessionDrawer.vue:212-213` 使用 `noobot-side-drawer__body/__header`，在 v4.4.4 已存在。迁移后这两个类由 client-shared 提供，但插件仍隐式依赖宿主类名，没有在 plugin-protocol 中声明。建议后续把共享抽屉类名作为前端插件样式契约写入协议，或由插件只使用自身类名；本次不扩大范围。

### 验证证据

日志位于用户工作区 `runtime/ops_workdir/`。

| 验证                                     | 结果                                                                                             | 日志                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| 质量门禁（修复前 / 修复后）              | 49/49 / 49/49                                                                                    | `audit2-quality.log` / `audit2-quality-fix.log` |
| model-protocol / agent-config-protocol   | 87/87、107/107                                                                                   | `audit2-pkg-*.log`                              |
| client/shared（修复后）                  | 131/131                                                                                          | `audit2-shared-fix.log`                         |
| chat（含前端样式检查，修复后）           | 241 个文件、1762 项全部通过                                                                      | `audit2-chat-fix.log`                           |
| startup / chat 构建（修复后）            | 通过；startup 产物包含全部 `noobot-side-drawer*` 规则及 model-picker 变体，chat 产物包含两个变体 | `audit2-build-fix.log`                          |
| prettier（改动文件）、`git diff --check` | 通过                                                                                             | 命令输出                                        |

验证边界：样式结论基于构建产物中的选择器和特异性分析，没有做浏览器截图对比。

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
