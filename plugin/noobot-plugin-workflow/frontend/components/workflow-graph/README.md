# workflow-graph 组件说明

该目录用于承载「工作流消息」里的 Canvas 图形化流程组件，采用**布局协调器 + 原子子组件**模式：

- `WorkflowCanvasGraph.vue`：布局协调器（计算节点位置、并行分组、选中态、缩放、minimap、运行态检查面板）
- `WorkflowGraphEdges.vue`：仅负责 canvas 连线渲染
- `WorkflowGraphNode.vue`：仅负责模型节点卡片渲染与点击事件
- `WorkflowGraphStatusBadge.vue`：仅负责节点状态徽标渲染
- `index.js`：统一导出入口

## 数据契约（nodes）

`WorkflowCanvasGraph` 的 `nodes` 输入以工作流引擎结构为准：

```text
Model Node
  -> NodeBox / ActionNodeState / actionNodeStateId
      -> StepBox / StepState / stepId
          -> sub-agent session
```

推荐字段：

- `nodeName: string` 模型节点名
- `nodeId: string` 模型节点ID
- `type: "action" | "state"` 节点类型
- `stateType: number` 状态节点类型（可选）
- `status: "success" | "failed" | "error" | "running" | "pending"`（可选）
- `transition: number`（可选，排序）
- `parallelWave: number`（可选，并行层）
- `waveOrder: number`（可选，并行层内顺序）
- `actionNodeStates: Array` 动作节点运行态节点Box列表：

```js
{
  actionNodeStates: [
    {
      actionNodeStateId: "...",
      steps: [
        {
          stepId: "...",
          stepIndex: 0,
          dialogId: "...", // 子 agent 对话ID，用于打开 session
          sessionId: "...",
          rootSessionId: "...",
          stepStatus: "success",
          stepFailure: null,
        },
      ],
    },
  ],
}
```

动作节点点击只打开/收起运行态检查面板，不改变模型图拓扑布局；**子 agent session 挂在 step box 上**，由 step 点击触发打开。

## 事件契约

`WorkflowCanvasGraph` 对外事件：

- `node-click(node)`：点击动作模型节点，仅用于打开/收起运行态检查面板后的通知
- `step-click(step)`：点击步骤Box，用于打开子 agent session
- `update:selectedDialogId(dialogId)`：受控选中 step dialogId 回传

## 扩展建议

- 若后端后续提供更丰富的节点Box/步骤Box元数据，可继续挂在 `actionNodeStates[].steps[]`，图组件不需要反查语义图。
- 若需支持更复杂并行/汇聚，可在布局层新增 `row type` 与 `anchor` 概念，子组件无需改动。
