# 前端插件视觉回归清单（2026-06-05）

> 目标：在插件解耦后，快速确认 workflow/harness 的关键 UI 未出现“样式丢失、信息缺失、交互异常”。

## 1. Workflow 插件（noobot-plugin-workflow）

### 1.1 WorkflowMessageCard（主卡片）

- [x] 卡片边框/背景/阴影正常
- [x] 语义预览折叠/展开按钮可用
- [x] 节点图可见且可点击

### 1.2 子 Agent 会话 Drawer

- [x] Drawer header/body 背景与边框生效
- [x] 消息气泡（user/assistant）样式正常
- [x] Markdown 样式正常（代码块/表格/列表）
- [x] 附件/文件预览入口存在
- [x] Thinking 面板可见（由 harness action/card renderer 注入）

### 1.3 workflow-graph

- [x] 节点状态颜色（pending/running/success/failed）正常
- [x] 运行步骤 box 的 hover/selected 状态可见
- [x] minimap 节点颜色正常
- [x] 移动端（<=480）布局未破坏

---

## 2. Harness 插件（noobot-plugin-harness）

### 2.1 ThinkingPanel

- [x] 三个 Tab 可切换（执行过程/详情/注入消息）
- [x] 展开/收起交互正常
- [x] 详情长文本展开交互正常
- [x] 已移除组件内 `!important`

### 2.2 MessageAttachments / MessageWrittenFiles

- [x] 已复用 shared `file-card-common.css`
- [x] 文件名、省略、图标、下载按钮样式正常
- [x] parsed result 操作按钮仍可用
- [x] 插件内 `!important` 已清零（workflow + harness/frontend）

---

## 3. 自动化守护（已接入）

- [x] `npm run -s check:plugin-frontend-reverse-deps`
- [x] `npm test`
- [x] `npm run build`

---

## 4. 当前剩余高风险点（待观察）

1. **Element Plus 内部结构变更风险**  
   Drawer 内部类名若升级变化，可能影响 `body-class/header-class` 相关覆盖。

2. **大包体导致样式加载时机感知差异**  
   当前 chunk 较大（构建警告持续存在），弱网下可能出现短暂样式闪动。

3. **节点图复杂数据下的可读性**  
   workflow-graph 在极端节点数下（高并发 wave + 多层步骤）需补一次专项视觉回归。
