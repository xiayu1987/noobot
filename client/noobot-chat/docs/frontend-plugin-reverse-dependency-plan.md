# 前端插件反向依赖治理任务文档（Step by Step）

> 目标：消除 `plugin/*/frontend -> client/noobot-chat/src/modules/*` 的反向依赖，建立稳定的前端插件依赖边界。

---

## 0. 范围与原则

- 允许依赖方向：`client(noobot-chat) -> plugin/*/frontend/index.js`
- 禁止依赖方向：`plugin/*/frontend/* -> client/noobot-chat/src/modules/*`
- 通用能力沉淀到 shared 层，业务组件归插件私有。

---

## 1. 现状盘点（Inventory）

- [x] I1. 统计所有 `plugin/*/frontend` 中对 `client/noobot-chat/src/modules/*` 的 import。
- [x] I2. 按插件拆分清单（workflow/harness/...）。
- [x] I3. 标记每个组件类型：
  - 插件私有组件（迁入插件）
  - 通用基础组件（抽到 shared）

**验收标准**
- 有一份完整依赖清单（文件路径 + import 路径 + 归类）。

### 盘点结果（2026-06-05）

#### workflow

1. `plugin/noobot-plugin-workflow/frontend/index.js`
   - `client/noobot-chat/src/modules/message/WorkflowMessageCard.vue`
   - 归类：**插件私有组件**（迁入 `plugin/noobot-plugin-workflow/frontend/components`）

#### harness

1. `plugin/noobot-plugin-harness/frontend/index.js`
   - `client/noobot-chat/src/modules/message/ThinkingPanel.vue`
   - `client/noobot-chat/src/modules/message/actions/AssistantCopyActions.vue`
   - `client/noobot-chat/src/modules/message/MessageStatusRow.vue`
   - `client/noobot-chat/src/modules/message/MessageWrittenFiles.vue`
   - `client/noobot-chat/src/modules/message/MessageAttachments.vue`
   - 归类：**插件私有组件优先迁入**（后续评估可抽 `shared/ui` 的基础壳组件）

---

## 2. 目录目标（Target Layout）

```txt
plugin/noobot-plugin-workflow/frontend/
  index.js
  components/
    *.vue

plugin/noobot-plugin-harness/frontend/
  index.js
  components/
    *.vue

client/noobot-chat/src/shared/ui/
  Base*.vue
```

- [x] T1. workflow 目标目录创建
- [x] T2. harness 目标目录创建
- [x] T3. shared/ui 目录准备（若需要）

---

## 3. 分阶段迁移（Migration）

### Phase M1：workflow 组件迁移
- [x] M1-1. 将 workflow 相关组件复制/迁移到 `plugin/noobot-plugin-workflow/frontend/components`
- [x] M1-2. 调整 `plugin/noobot-plugin-workflow/frontend/index.js` 仅引用插件内组件
- [x] M1-3. 移除旧反向 import

### Phase M2：harness 组件迁移
- [x] M2-1. 将 harness 相关组件复制/迁移到 `plugin/noobot-plugin-harness/frontend/components`
- [x] M2-2. 调整 `plugin/noobot-plugin-harness/frontend/index.js` 仅引用插件内组件
- [x] M2-3. 移除旧反向 import

### Phase M3：通用组件抽离（可选）
- [x] M3-1. 识别可复用 UI（卡片壳、动作条等）
- [x] M3-2. 下沉到 `client/noobot-chat/src/shared/ui`
- [x] M3-3. 插件与宿主统一引用 shared/ui

#### M3-2 执行拆解（下一步）
- [x] M3-2a. 新建 `BaseActionButtons.vue`，先替换 `AssistantCopyActions.vue`
- [x] M3-2b. 新建 `BaseSectionHeader.vue`，先替换 `MessageWrittenFiles.vue` 标题区
- [x] M3-2c. 新建 `BaseStatusChipsRow.vue`，先替换 `MessageStatusRow.vue`
- [x] M3-2d. 新建 `BaseFileCardList.vue`，最后替换附件/文件卡片（风险最高）
- [x] M3-2e. 每步执行 `npm run build && npm test`

#### M3-3 收口说明
- [x] 新增 `client/noobot-chat/src/shared/ui/index.js` 作为统一入口（barrel）。
- [x] harness 插件组件统一改为 `from ".../src/shared/ui"` 引用 shared/ui，不再按文件直连。
- [x] 新增 `BaseMessageShell.vue` / `BaseMarkdownContent.vue`，宿主消息与 workflow 子会话消息统一复用消息壳和 Markdown 渲染样式。

**验收标准**
- `plugin/*/frontend` 不再 import `client/src/modules/*`。

### M3-1 识别结果（2026-06-05）

| 候选共享组件 | 来源 | 当前重复点 | 建议落点 |
| --- | --- | --- | --- |
| `BaseStatusChipsRow` | `MessageStatusRow.vue` + workflow 节点状态展示 | “状态圆点 + chip + done/pending 样式”重复 | `client/noobot-chat/src/shared/ui/BaseStatusChipsRow.vue` |
| `BaseFileCardList` | `MessageAttachments.vue` + `MessageWrittenFiles.vue` | 文件卡片壳、图标区、标题区、下载按钮样式重复 | `client/noobot-chat/src/shared/ui/BaseFileCardList.vue` |
| `BaseActionButtons` | `AssistantCopyActions.vue` + 各类工具操作按钮组 | 小型按钮组布局/间距重复 | `client/noobot-chat/src/shared/ui/BaseActionButtons.vue` |
| `BaseSectionHeader` | `ThinkingPanel.vue` + 文件区头部 | 分段标题 + 计数信息展示模式重复 | `client/noobot-chat/src/shared/ui/BaseSectionHeader.vue` |

> 说明：本轮先只做“识别与落点”，不改变业务语义；`workflow-graph/*` 暂保留插件私有，不进入 shared。

### Phase M4：插件样式治理（进行中）

- [ ] M4-1. 完成样式体量盘点（按文件行数 + 功能风险）
- [ ] M4-2. 优先治理 `WorkflowMessageCard.vue`（子会话抽屉样式一致性）
- [ ] M4-3. 治理 `ThinkingPanel.vue`（提炼面板壳/列表行等基础样式）
- [ ] M4-4. `workflow-graph/*` 保持插件私有，仅做 token/变量统一，不强行抽 shared
- [x] M4-5. 每一步都执行 `generate/check/build/test`

#### M4-1 样式盘点（2026-06-05）

| 文件 | style 行数（约） | 优先级 | 说明 |
| --- | ---: | --- | --- |
| `plugin/noobot-plugin-workflow/frontend/components/WorkflowMessageCard.vue` | 369 | P0 | 直接影响“子 agent 会话抽屉”观感与消息区样式 |
| `plugin/noobot-plugin-workflow/frontend/components/workflow-graph/WorkflowCanvasGraph.vue` | 283 | P1 | 图形布局类样式多，建议私有保留 |
| `plugin/noobot-plugin-workflow/frontend/components/workflow-graph/WorkflowGraphNode.vue` | 217 | P1 | 节点视觉逻辑重，不建议强抽 shared |
| `plugin/noobot-plugin-harness/frontend/components/ThinkingPanel.vue` | 210 | P0 | 与消息展示体验强相关，可提炼基础面板样式 |
| `plugin/noobot-plugin-harness/frontend/components/MessageAttachments.vue` | 168 | P1 | 已部分共享化，后续再压缩 |
| `plugin/noobot-plugin-harness/frontend/components/MessageWrittenFiles.vue` | 74 | P2 | 可在 M4 后半段收敛 |
| `plugin/noobot-plugin-workflow/frontend/components/WorkflowSessionMessageItem.vue` | 59 | P2 | 已收敛到 shared 壳层，保持轻量 |

---

## 4. 规则固化（Guardrail）

- [x] G1. 新增检查脚本：扫描 `plugin/*/frontend` 禁止路径模式
- [x] G2. 将检查接入 `pretest` 或 CI
- [x] G3. 报错文案清晰（指出文件与违规 import）

**验收标准**
- 新增违规 import 时，CI 能阻断并给出定位信息。

---

## 5. 验证清单（Verification）

每个阶段完成后执行：

```bash
cd client/noobot-chat
npm run build
npm test
npm run -s check:plugin-frontend-reverse-deps
```

如涉及插件 manifest/front entry 变更，额外执行：

```bash
npm run -s generate:frontend-plugin-entries
```

---

## 6. 回滚策略（Rollback）

- 回滚单插件迁移：恢复该插件 `frontend/index.js` 到上一步版本。
- 保持其它插件迁移不受影响（分插件提交、分插件回滚）。
- 回滚后必须重新执行 build/test。

---

## 7. 执行记录（Log）

- [x] 2026-06-05：完成 I1/I2/I3 盘点与分类。
- [x] 2026-06-05：完成 T1/T2/T3 目标目录创建（workflow/harness/components + shared/ui）。
- [x] 2026-06-05：完成 M1（workflow 组件迁移到插件目录，删除 workflow -> client/modules 反向 import）。
- [x] 2026-06-05：完成 M2（harness 组件迁移到插件目录，删除 harness -> client/modules 反向 import）。
- [x] 2026-06-05 20:52：完成 M3-1（识别 shared/ui 抽离候选与落点，暂不改业务实现）。
- [x] 2026-06-05 20:48：完成 M3-2a（新增 `BaseActionButtons.vue`，`AssistantCopyActions.vue` 改为复用 shared/ui）。
- [x] 2026-06-05 20:48：完成 M3-2e 本轮验证（`npm run build` / `npm test` / `npm run -s check:plugin-frontend-reverse-deps`）。
- [x] 2026-06-05 20:49：完成 M3-2b（新增 `BaseSectionHeader.vue`，`MessageWrittenFiles.vue` 标题区改为复用 shared/ui）。
- [x] 2026-06-05 20:49：完成 M3-2e 本轮验证（`npm run build` / `npm test` / `npm run -s check:plugin-frontend-reverse-deps`）。
- [x] 2026-06-05 20:50：完成 M3-2c（新增 `BaseStatusChipsRow.vue`，`MessageStatusRow.vue` 改为复用 shared/ui）。
- [x] 2026-06-05 20:50：完成 M3-2e 本轮验证（`npm run build` / `npm test` / `npm run -s check:plugin-frontend-reverse-deps`）。
- [x] 2026-06-05 20:51：完成 M3-2d（新增 `BaseFileCardList.vue`，`MessageAttachments.vue` / `MessageWrittenFiles.vue` 卡片容器改为复用 shared/ui）。
- [x] 2026-06-05 20:51：完成 M3-2e 本轮验证（`npm run build` / `npm test` / `npm run -s check:plugin-frontend-reverse-deps`）。
- [x] 2026-06-05 20:53：完成 M3-3（新增 shared/ui 统一入口并统一 import 路径）。
- [x] 2026-06-05 20:53：完成 M3-3 本轮验证（`npm run build` / `npm test` / `npm run -s check:plugin-frontend-reverse-deps`）。
- [x] 2026-06-05 21:20：完成消息级 shared/ui 收口（`BaseMessageShell` / `BaseMarkdownContent`，`ChatMessageItem` 与 workflow 子会话共用）。
- [x] 2026-06-05 21:20：完成本轮验证（`npm run build` / `npm test` / `npm run -s check:plugin-frontend-reverse-deps`）。
- [x] 2026-06-05 21:22：再次验证通过（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 21:23：新增 M4 样式治理阶段与优先级盘点（为后续“插件样式缺失”问题逐步收敛）。
- [x] 2026-06-05 21:25：完成 M4-2 第一轮收敛：`WorkflowMessageCard.vue` 清理历史遗留样式，改为 `WorkflowSessionMessageItem` 容器化渲染并增强 drawer body/header 选择器兜底。
- [x] 2026-06-05 21:25：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 21:27：完成 M4-3 第一轮收敛：`ThinkingPanel.vue` 去除 `!important`、合并重复布局样式（`thinking-single-line` / `thinking-detail-step`）。
- [x] 2026-06-05 21:27：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 21:29：完成 M4-3 第二轮收敛：新增 `src/shared/ui/file-card-common.css`，`MessageAttachments.vue` / `MessageWrittenFiles.vue` 复用统一文件卡片样式。
- [x] 2026-06-05 21:29：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 21:31：完成 M4-4 第一轮收敛：`workflow-graph` 内部统一 accent/success/failed/running 色值为组件 token（`WorkflowCanvasGraph.vue` / `WorkflowGraphNode.vue` / `WorkflowGraphStatusBadge.vue`）。
- [x] 2026-06-05 21:31：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 21:32：完成 M4-4 第二轮收敛：`workflow-graph` 与 `WorkflowMessageCard` 统一圆角/间距/阴影 token，减少硬编码视觉参数。
- [x] 2026-06-05 21:32：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 21:34：完成 M4 收尾：新增视觉回归清单 `frontend-plugin-visual-regression-checklist.md`，沉淀当前状态与剩余高风险点。
- [x] 2026-06-05 21:34：清理残余 `!important`（`MessageAttachments.vue` parsed-result 操作按钮）。
- [x] 2026-06-05 21:36：完成 P0 复用收敛：新增 `BasePreviewContent.vue`（shared/ui），`ChatMessageItem.vue` 与 `WorkflowSessionMessageItem.vue` 统一复用预览内容组件并删除历史重复实现。
- [x] 2026-06-05 21:39：完成 P1 第一轮复用：新增 `BaseMessageTypeTag.vue` / `BaseMessageErrorAlert.vue`，`ChatMessageItem.vue` 与 `WorkflowSessionMessageItem.vue` 统一替换消息类型标签与错误提示结构。
- [x] 2026-06-05 21:40：完成 P1 第二轮清理：移除 `ChatMessageItem.vue` 历史遗留且未被模板使用的 `.msg-wrapper/.bubble/.md` 样式块，减少样式负担。
- [x] 2026-06-05 21:42：完成全量扫描（plugin frontend + `src/modules/message`），清理未引用历史组件 `MessageHeader.vue`。
- [x] 2026-06-05 21:45：完成 `MessageAttachments.vue` 重复结构收敛：新增 `AttachmentFileCard.vue` 复用 normal/plugin 附件卡片渲染，移除双份重复模板与样式定义。
- [x] 2026-06-05 21:47：将 `AttachmentFileCard.vue` 上提到 shared 层（`BaseAttachmentFileCard.vue`），插件改为通过 shared/ui 统一复用。
- [x] 2026-06-05 21:50：完成 `MessageWrittenFiles.vue` 复用 `BaseAttachmentFileCard.vue`（含 recognized badge/预览下载参数化），移除本地重复卡片样式与结构。
- [x] 2026-06-05 21:50：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 21:52：完成 `ThinkingPanel.vue` 标题区复用 `BaseSectionHeader`，移除本地重复标题布局样式，保持行为不变。
- [x] 2026-06-05 21:52：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 21:53：新增 `BaseEmptyHint.vue`（shared/ui），`ThinkingPanel.vue` 空状态统一复用基础组件，移除重复 `.thinking-empty` 样式。
- [x] 2026-06-05 21:53：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 21:55：新增 `BaseThinkingLogLine.vue`（shared/ui），`ThinkingPanel.vue` 的 execution/detail 日志行统一复用，移除重复行样式。
- [x] 2026-06-05 21:55：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 21:56：`WorkflowMessageCard.vue` 子会话空状态改为复用 `BaseEmptyHint.vue`，减少跨插件重复空态结构。
- [x] 2026-06-05 21:56：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 21:57：`WorkflowCanvasGraph.vue` 运行态步骤空状态改为复用 `BaseEmptyHint.vue`，统一插件空态组件。
- [x] 2026-06-05 21:57：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 21:58：`WorkflowMessageCard.vue` 子会话抽屉错误提示改为复用 `BaseMessageErrorAlert.vue`，统一错误样式表达。
- [x] 2026-06-05 21:58：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 21:59：`WorkflowMessageCard.vue` 补齐工作流节点空状态（`暂无工作流节点`），复用 `BaseEmptyHint.vue` 统一空态展示。
- [x] 2026-06-05 21:59：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 22:00：`WorkflowCanvasGraph.vue` 清理无效 watch（仅 `await nextTick()` 的空副作用观察器），减少无意义响应开销。
- [x] 2026-06-05 22:00：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 22:01：新增 `BaseNoteBlock.vue`（shared/ui），`ThinkingPanel.vue` 注入消息块改为共享组件渲染，移除本地重复样式。
- [x] 2026-06-05 22:01：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 22:02：`ThinkingPanel.vue` 注入消息列表去除多余包裹层，直接渲染 `BaseNoteBlock`，减少无意义 DOM 层级。
- [x] 2026-06-05 22:02：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 22:03：`WorkflowCanvasGraph.vue` 删除未使用 `rowNodeMap` 计算属性，减少死代码。
- [x] 2026-06-05 22:03：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 22:05：新增 `BaseMetaLabel.vue` / `BasePillButton.vue`（shared/ui），`ThinkingPanel.vue` 分组标题与底部胶囊按钮改为共享组件。
- [x] 2026-06-05 22:05：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 22:08：新增 `BaseTabPanelBody.vue`（shared/ui），`ThinkingPanel.vue` 三个 Tab 内容容器统一复用并移除本地重复滚动样式。
- [x] 2026-06-05 22:08：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 22:11：新增 `BaseThinkingPanelShell.vue`（shared/ui），`ThinkingPanel.vue` 折叠壳层（collapse/tabs/footer 皮肤）迁移到共享组件。
- [x] 2026-06-05 22:11：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 22:13：新增 `BaseZoomControls.vue`（shared/ui），`WorkflowCanvasGraph.vue` 顶部缩放工具栏改为共享组件渲染并移除本地重复样式。
- [x] 2026-06-05 22:13：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05 22:14：`ChatMessageItem.vue` 与 `WorkflowSessionMessageItem.vue` 对齐渲染上下文构建方式（统一 `resolveRendererContext` 调用路径，减少实现分叉）。
- [x] 2026-06-05 22:14：完成本轮验证（`npm run -s check:plugin-frontend-reverse-deps` / `npm test` / `npm run build`）。
- [x] 2026-06-05：完成 G1/G2/G3（新增 `scripts/check-plugin-frontend-reverse-deps.mjs` 并接入 `pretest`）。
- [x] 2026-06-05 20:45：执行验证通过（`npm run -s check:plugin-frontend-reverse-deps` / `npm run build` / `npm test`）。
- [ ] 记录每一步完成时间、变更摘要、提交号（提交号待合并后补齐）。
- [x] 2026-06-05：未触发回滚。

---

## 8. 收尾与提交流水建议（Finalization）

### 8.1 建议提交切分（便于回滚）

1. `feat(frontend-plugin): migrate workflow/harness message components into plugin frontend`
2. `feat(frontend-plugin): add reverse-dependency guardrail script and wire pretest`
3. `feat(shared-ui): add BaseActionButtons/BaseSectionHeader/BaseStatusChipsRow/BaseFileCardList`
4. `refactor(harness-frontend): consume shared/ui barrel exports`
5. `docs(frontend-plugin): update reverse-dependency execution plan and logs`

### 8.2 合并前检查（一次性）

```bash
cd client/noobot-chat
npm run -s generate:frontend-plugin-entries
npm run -s check:plugin-frontend-reverse-deps
npm run build
npm test
```

### 8.3 已达成结果（结论）

- 插件前端已完成对 `client/src/modules/*` 的反向依赖清理。
- shared/ui 已形成统一出口 `src/shared/ui/index.js`。
- 规则检查已接入 `pretest`，可持续阻断回归。
