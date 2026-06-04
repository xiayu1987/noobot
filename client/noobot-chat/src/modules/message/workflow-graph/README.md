# workflow-graph 组件说明

该目录用于承载「工作流消息」里的 Canvas 图形化流程组件，采用**布局协调器 + 原子子组件**模式：

- `WorkflowCanvasGraph.vue`：布局协调器（计算节点位置、并行分组、选中态、缩放、minimap）
- `WorkflowGraphEdges.vue`：仅负责 canvas 连线渲染
- `WorkflowGraphNode.vue`：仅负责单节点卡片渲染与点击事件
- `WorkflowGraphStatusBadge.vue`：仅负责节点状态徽标渲染
- `index.js`：统一导出入口

## 数据契约（nodes）

`WorkflowCanvasGraph` 的 `nodes` 输入推荐字段：

- `dialogId: string` 节点对话ID（用于选中与回查）
- `sessionId: string` 节点子会话ID（用于状态推导）
- `nodeName: string` 节点名
- `nodeId: string` 节点ID
- `status: "success" | "failed" | "error" | "running" | "pending"`（可选）
- `transition: number`（可选，排序）
- `parallelWave: number`（可选，并行层）
- `waveOrder: number`（可选，并行层内顺序）

当 `status` 缺失时，默认推导：有 `sessionId` => `success`，否则 `pending`。

## 事件契约

`WorkflowCanvasGraph` 对外事件：

- `node-click(node)`：点击节点
- `update:selectedDialogId(dialogId)`：受控选中ID回传

## 扩展建议

- 若后端后续提供真实边数据（from/to），可直接替换 `WorkflowCanvasGraph` 内 `edgeSegments` 生成逻辑。
- 若需支持更复杂并行/汇聚，可在布局层新增 `row type` 与 `anchor` 概念，子组件无需改动。
