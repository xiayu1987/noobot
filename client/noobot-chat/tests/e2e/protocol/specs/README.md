# Scenario Implementation Index / 场景落地索引

[English](#english) | [中文](#中文)

## English

Scenario IDs and acceptance conditions are defined by the shared protocol plan and the executable
specs. See the [English plan](../../../../../../docs/browser-protocol-e2e-test-plan.en.md) and the
[Chinese plan](../../../../../../docs/browser-protocol-e2e-test-plan.zh-CN.md).

- `002`-`008`: connection, send, attachments, stop, snapshots, and repeated continuation.
- `009`-`012`: merged into the single-Session resend chain in PBE-029.
- `013`-`015`: reconnect, concurrent reconnect, and multi-page consistency.
- `016`-`017`: Harness completion, Hook interruption, and Model Context.
- `021`-`032`: Session recovery/conflicts, stop idempotency, offline recovery, negative protocol,
  plugin/runtime identity, and Workflow lifecycle.
- `033`-`036`: full Harness injections, main-Agent summary checkpoints, periodic task checks, tools,
  live thinking, and interaction closure.
- `044`: two stop/continue cycles during an eight-step tool chain, including snapshot restoration.
- `045`: parallel tool calls stopped mid-batch, with complete call/result pairing after restoration.
- `046`: real-time user, assistant, Workflow card, DSL collapse, and stop-state consistency across
  two browser contexts.

PBE-018, PBE-019, and PBE-020 are strict subsets of PBE-033, PBE-032, and PBE-028. PBE-047 covers
connector creation, persisted-Session selection write ordering, database access, model context, and
persistence. It blocks the selection write and asserts that a concurrent send cannot overtake the
Session authority update. PBE-099 was removed as duplicate coverage. All current scenarios are
implemented; permanent skips and placeholder scenarios without business assertions are forbidden.

### PBE-033: Low-turn complete Harness flow

Enable planning and acceptance and configure guidance analysis through the Harness UI. Use the
formal `update:pluginModelConfig` boundary to lower E2E-only thresholds, then execute a five-step
dependent tool chain with explicit plan refinement and task acceptance. Assert planning, guidance,
summary, revision/refinement, phase acceptance, semantic validation, and review facts; capability
relays, checkpoint identities, cache prefixes, and all tool results must close.

### PBE-034: Low-turn main-Agent phase summary

Without Harness, set `preferences.summaryPolicy.phaseSummaryLoopTurns=2` through the Composer and
run a three-step dependent chain. Assert the main flow independently emits the summary requirement
and checkpoint, preserves tool call/result pairs, removes summarized UIDs from later provider
input, and performs exactly three `execute_script` calls plus one `task_summary`.

### PBE-035: Periodic task check

Lower `taskCheckLoopTurns` and `phaseSummaryLoopTurns` through the formal Composer boundary, run a
five-step chain, then send a dependent follow-up. Assert one marker per requirement, no marker leak,
`NOOBOT_TASK_CHECK/1` input, receipt-only output, latest check evidence retained before checkpoint,
and the result visible in both thinking details and later model history.

### PBE-036: Tools, live thinking, and interaction closure

Enable real Harness guidance analysis and execute the declared safe tool set in order. Continuously
sample the live thinking UI and complete the interaction card. Assert the authoritative tool set is
exact, every `toolCallId` closes with arguments and a successful result, live content changes over
time, all seven call/result pairs remain expandable in details, and tool/interaction results reach
the final answer.

## 中文

场景编号和验收条件以项目根目录 `docs/browser-protocol-e2e-test-plan.zh-CN.md` 为唯一事实源。

- `002`～`008`：连接、发送、附件、停止、快照和连续继续；PBE-001、004、005 分别合并到 PBE-002、006、007。
- `009`～`012`：已合并到 PBE-029 的单 Session resend 链路，覆盖保留、移除和新增附件。
- `013`～`015`：刷新 reconnect、并发 reconnect 和双页面状态一致性。
- `016`～`017`：Harness 自然完成、Hook 中断和 Model Context。
- `021`～`026`：Session 恢复、版本冲突、停止幂等、断网和非法协议拒绝。
- `027`～`032`：插件协议、Session 协议、本地 Session 刷新和 Workflow 生命周期。
- `033`～`036`：Harness 全流程注入、主 Agent `task_summary` checkpoint、周期 `task_check` 切片，以及安全工具/实时思考/交互模型输入闭环。
- `044`：自然完成后执行工具链，两次在工具结果后停止并继续，最终自然完成；逐份审计停止快照的序列化结构及 Continue 后真实模型输入的恢复投影。
- `045`：同一 assistant 响应并行发起四个工具，部分完成后停止；审计整批调用结果配对、停止快照及 Continue 模型输入恢复。
- PBE-018、PBE-019、PBE-020 已分别合并到 PBE-033、PBE-032、PBE-028；PBE-047 覆盖连接器创建、持久化 Session 选择写入顺序、数据库访问、模型上下文及持久化审计，并通过阻塞选择写入验证并发发送不能越过 Session 权威更新；PBE-099 的重复组合审计已删除。
- 当前场景均已落地；禁止提交永久 `skip` 或无业务断言的占位场景。

### PBE-033：Harness 低轮次完整流程

步骤：从 Harness UI 启用 planning 和 acceptance，并设置 guidance analysis 强度；测试通过正式 `update:pluginModelConfig` 参数边界降低 summary、plan update 和 phase acceptance 阈值，驱动五步依赖计算链，并显式请求 plan refinement 和 task acceptance。

断言：planning、guidance analysis、summary、plan revision/refinement、phase acceptance、semantic validation 和 review 都形成运行事实；每个辅助模型 purpose 都有 provider 观测和 capability trace，每个模型输出及其 follow-up 都以规范 `separate_model_relay:*` 进入后续主模型 provider 输入；阈值来源、summary checkpoint、缓存前缀与七次工具结果闭合。

### PBE-034：主 Agent 低轮次阶段小结

步骤：不选择 Harness，通过核心 Composer 设置 `preferences.summaryPolicy.phaseSummaryLoopTurns=2`，发送不包含小结或 `task_summary` 指令的三步依赖工具链。前两个业务工具完成后由主流程阈值自主注入阶段小结要求，小结后继续完成第三步。

断言：主流程阈值不从插件配置读取；`phase_summary_required`、`summary_checkpoint_committed` 和 `turn.completed` 依次发生；唯一 checkpoint receipt 的 UID 与 turn journal 中 `summarized=true` 消息完全对应，tool-call/result 不拆对；每个 receipt 提交后的主 Agent provider 输入不再含该 receipt 已小结 UID，阶段小结 marker 不累积；全程严格产生三次 `execute_script` 和一次 `task_summary`，专用模型仍按自己的消息生产协议观测。

### PBE-035 周期任务检查

步骤：Composer 界面不显示任何主流程阈值控件；测试通过 Composer 正式 `update:summaryPolicy` 事件把 `taskCheckLoopTurns` 和 `phaseSummaryLoopTurns` 降低，仅用于缩短真实浏览器运行时间。执行五步顺序工具链，随后发送一条依赖上一轮结果的普通消息。

步骤：用户任务明确要求模型在收到周期提示时调用 `task_check`，使真实模型 E2E 确定覆盖工具分支；这不改变生产系统提示的“按需调用”语义。

断言：每次主模型输入的 `Current execution context` 小于 256 字符且不含 Session 路由身份、Session tree 或执行器安全字段；`task_check_required` 每次只对应一个模型输入 marker，下一轮不残留；`task_check` 输入严格遵循 `NOOBOT_TASK_CHECK/1`，结果只含协议回执且不保存附件；最后一次 checkpoint 前的最新检查 call/result 保持 `summarized!=true`，思考面板展示本轮最新检查摘要，下一轮主模型的 history 仍能看到该工具结果。

### PBE-036 全工具与实时思考交互闭环

步骤：启用 Harness 的真实 guidance analysis，但关闭 planning/acceptance，按固定顺序调用本场景声明的安全业务工具集合 `write_file/read_file/search/patch_file(dryRun)/execute_script/list_skills/user_interaction`。浏览器在交互卡片填写固定验证码，并持续采样实时思考面板，而不是仅在完成后读取最终 DOM。模型/provider 若不输出工具调用前文本，不伪造主模型思考内容；分析区域由真实 Harness capability 事件驱动。

断言：权威 execution-events 中实际工具集合与声明集合严格相等，每个 `toolCallId` 的调用、参数、成功返回一一配对；实时面板至少出现两种不同内容签名，模型分析与执行记录都有内容；实时面板最近 10 条执行日志窗口内的调用/返回均可展开，思考详情则展示并可展开完整 7 对工具历史；思考内容标签有真实内容；交互标题、字段、提交值及工具返回闭合，读文件、搜索和脚本的实际结果进入最终回答。
