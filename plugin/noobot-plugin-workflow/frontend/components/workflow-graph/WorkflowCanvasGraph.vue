<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useWorkflowLocale } from "../../i18n/index.js";
import { BaseZoomControls } from "noobot-chat/plugin-api/ui";
import WorkflowGraphNode from "./WorkflowGraphNode.vue";
import WorkflowGraphEdges from "./WorkflowGraphEdges.vue";
import { resolveWorkflowDialogProcessId } from "../../utils/workflowDialogProcessId.js";
import { WORKFLOW_NODE_TYPE } from "@noobot/event-protocol/workflow-runtime-event";
import { resolveWorkflowNodeStatus } from "../../runtime/workflowRuntimeStatus.js";
import { text } from "@noobot/shared/value";

const props = defineProps({
  nodes: { type: Array, default: () => [] },
  flowtos: { type: Array, default: () => [] },
  selectedDialogProcessId: { type: String, default: "" },
});

const emit = defineEmits(["node-click", "step-click", "update:selected-dialog-process-id"]);
const { translate } = useWorkflowLocale();

const hostRef = ref(null);
const resizeObserverRef = ref(null);
const hostWidth = ref(0);
const zoomScale = ref(1);
const innerSelectedDialogProcessId = ref("");

const DESKTOP_NODE_WIDTH = 192;
const COMPACT_MIN_NODE_WIDTH = 148;

function resolveDialogProcessId(item = {}) {
  return resolveWorkflowDialogProcessId(item);
}

const isCompactGraph = computed(
  () => Number(hostWidth.value || 0) > 0 && Number(hostWidth.value || 0) <= 480,
);
const nodeHeight = computed(() => (isCompactGraph.value ? 54 : 58));
const nodeGapY = computed(() => (isCompactGraph.value ? 16 : 22));
const parallelRailWidth = computed(() => {
  if (!isCompactGraph.value) return 72;
  const width = Math.max(0, Number(hostWidth.value || 0));
  if (!width) return 46;
  return Math.max(32, Math.min(52, Math.floor((width - COMPACT_MIN_NODE_WIDTH - 16) / 2)));
});
const paddingTop = computed(() => (isCompactGraph.value ? 8 : 12));
const paddingBottom = computed(() => (isCompactGraph.value ? 8 : 12));
const paddingLeft = computed(() => (isCompactGraph.value ? 8 : 12));
const paddingRight = computed(() => (isCompactGraph.value ? 8 : 12));
const nodeWidth = computed(() => {
  if (!isCompactGraph.value) return DESKTOP_NODE_WIDTH;
  const width = Math.max(0, Number(hostWidth.value || 0));
  if (!width) return DESKTOP_NODE_WIDTH;
  const available = width - paddingLeft.value - paddingRight.value - parallelRailWidth.value * 2;
  return Math.max(COMPACT_MIN_NODE_WIDTH, Math.min(DESKTOP_NODE_WIDTH, available));
});

const normalizedNodes = computed(() => {
  return (Array.isArray(props.nodes) ? props.nodes : []).map((nodeItem = {}) => {
    const dialogProcessId = resolveDialogProcessId(nodeItem);
    const nodeSessionId = text(nodeItem?.nodeSessionId);
    const actionNodeStates = resolveActionNodeStates(nodeItem);
    const stepDialogProcessIds = [];
    for (const stateBox of actionNodeStates) {
      for (const stepItem of Array.isArray(stateBox?.steps) ? stateBox.steps : []) {
        const stepDialogProcessId = resolveDialogProcessId(stepItem);
        if (stepDialogProcessId) stepDialogProcessIds.push(stepDialogProcessId);
      }
    }
    const hasSessionRef = Boolean(dialogProcessId || nodeSessionId || stepDialogProcessIds.length);
    return {
      ...nodeItem,
      dialogProcessId,
      actionNodeStates,
      ...(isActionNode(nodeItem) ? { status: resolveWorkflowNodeStatus(nodeItem) } : {}),
      _hasSession: hasSessionRef,
      _stepDialogProcessIds: stepDialogProcessIds,
    };
  });
});

function resolveSemanticNodeId(nodeItem = {}) {
  return text(nodeItem?.nodeId);
}

function buildTopologyRows(nodes = [], flowtos = []) {
  const nodeList = Array.isArray(nodes) ? nodes : [];
  const edgeList = (Array.isArray(flowtos) ? flowtos : [])
    .map((flowto = {}, index) => ({
      from: text(flowto?.from),
      to: text(flowto?.to),
      index,
    }))
    .filter((flowto) => flowto.from && flowto.to);
  if (!nodeList.length || !edgeList.length) return [];

  const nodeById = new Map();
  const orderById = new Map();
  nodeList.forEach((nodeItem = {}, index) => {
    const id = resolveSemanticNodeId(nodeItem);
    if (!id || nodeById.has(id)) return;
    nodeById.set(id, nodeItem);
    orderById.set(id, index);
  });
  if (!nodeById.size) return [];

  const outgoing = new Map();
  const indegree = new Map();
  const firstIncomingEdgeOrder = new Map();
  for (const id of nodeById.keys()) indegree.set(id, 0);
  for (const edge of edgeList) {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) continue;
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
    indegree.set(edge.to, Number(indegree.get(edge.to) || 0) + 1);
    if (!firstIncomingEdgeOrder.has(edge.to)) firstIncomingEdgeOrder.set(edge.to, edge.index);
  }
  for (const list of outgoing.values()) {
    list.sort((left, right) => Number(left.index || 0) - Number(right.index || 0));
  }

  const queue = Array.from(nodeById.keys())
    .filter((id) => Number(indegree.get(id) || 0) === 0)
    .sort((left, right) => Number(orderById.get(left) || 0) - Number(orderById.get(right) || 0));
  const indegreeWork = new Map(indegree);
  const rankById = new Map(Array.from(nodeById.keys()).map((id) => [id, 0]));
  const visited = new Set();

  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const currentRank = Number(rankById.get(id) || 0);
    for (const edge of outgoing.get(id) || []) {
      rankById.set(edge.to, Math.max(Number(rankById.get(edge.to) || 0), currentRank + 1));
      indegreeWork.set(edge.to, Math.max(0, Number(indegreeWork.get(edge.to) || 0) - 1));
      if (Number(indegreeWork.get(edge.to) || 0) === 0) queue.push(edge.to);
    }
    queue.sort((left, right) => {
      const rankDelta = Number(rankById.get(left) || 0) - Number(rankById.get(right) || 0);
      if (rankDelta) return rankDelta;
      return Number(orderById.get(left) || 0) - Number(orderById.get(right) || 0);
    });
  }

  let fallbackRank = Math.max(
    0,
    ...Array.from(rankById.values()).map((value) => Number(value || 0)),
  );
  for (const id of nodeById.keys()) {
    if (visited.has(id)) continue;
    fallbackRank += 1;
    rankById.set(id, fallbackRank);
  }

  const rowMap = new Map();
  for (const [id, nodeItem] of nodeById.entries()) {
    const rank = Number(rankById.get(id) || 0);
    if (!rowMap.has(rank)) rowMap.set(rank, []);
    rowMap.get(rank).push(nodeItem);
  }

  return Array.from(rowMap.entries())
    .sort((left, right) => Number(left[0] || 0) - Number(right[0] || 0))
    .map(([rank, rowNodes]) => ({
      key: `rank_${rank}`,
      nodes: rowNodes.slice().sort((left, right) => {
        const leftId = resolveSemanticNodeId(left);
        const rightId = resolveSemanticNodeId(right);
        const incomingDelta =
          Number(firstIncomingEdgeOrder.get(leftId) ?? Number.MAX_SAFE_INTEGER) -
          Number(firstIncomingEdgeOrder.get(rightId) ?? Number.MAX_SAFE_INTEGER);
        if (incomingDelta) return incomingDelta;
        return Number(orderById.get(leftId) || 0) - Number(orderById.get(rightId) || 0);
      }),
    }));
}

const layoutRows = computed(() => buildTopologyRows(normalizedNodes.value, props.flowtos));

const flattenedNodes = computed(() => {
  const result = [];
  for (const row of layoutRows.value) {
    const nodes = Array.isArray(row?.nodes) ? row.nodes : [];
    for (const nodeItem of nodes) result.push(nodeItem);
  }
  return result;
});

function resolveActionNodeStates(nodeItem = {}) {
  return Array.isArray(nodeItem?.actionNodeStates) ? nodeItem.actionNodeStates : [];
}

function nodeContainsDialogProcessId(nodeItem = {}, dialogProcessId = "") {
  const selected = text(dialogProcessId);
  if (!selected) return false;
  if (resolveDialogProcessId(nodeItem) === selected) return true;
  if (
    Array.isArray(nodeItem?._stepDialogProcessIds) &&
    nodeItem._stepDialogProcessIds.includes(selected)
  )
    return true;
  for (const stateBox of resolveActionNodeStates(nodeItem)) {
    for (const stepItem of Array.isArray(stateBox?.steps) ? stateBox.steps : []) {
      if (resolveDialogProcessId(stepItem) === selected) return true;
    }
  }
  return false;
}

const graphHeight = computed(() => {
  const nodeCount = Math.max(1, flattenedNodes.value.length);
  return (
    paddingTop.value +
    paddingBottom.value +
    nodeCount * nodeHeight.value +
    Math.max(0, nodeCount - 1) * nodeGapY.value
  );
});

const graphWidth = computed(
  () => paddingLeft.value + paddingRight.value + parallelRailWidth.value * 2 + nodeWidth.value,
);

const stageWidth = computed(() =>
  Math.max(hostWidth.value, graphWidth.value, nodeWidth.value + 24),
);

const positionedNodes = computed(() => {
  const positioned = [];
  const currentStageWidth = stageWidth.value;
  const centeredX = Math.round((currentStageWidth - nodeWidth.value) / 2);
  const x = Math.max(paddingLeft.value + Math.round(parallelRailWidth.value * 0.52), centeredX);
  let nodeIndex = 0;
  layoutRows.value.forEach((row = {}, rankIndex) => {
    const rowNodes = Array.isArray(row?.nodes) ? row.nodes : [];
    rowNodes.forEach((nodeItem = {}, colIndex) => {
      positioned.push({
        ...nodeItem,
        _rowIndex: nodeIndex,
        _rankIndex: rankIndex,
        _rankSize: rowNodes.length,
        _colIndex: colIndex,
        _x: x,
        _y: paddingTop.value + nodeIndex * (nodeHeight.value + nodeGapY.value),
      });
      nodeIndex += 1;
    });
  });
  return positioned;
});

const effectiveSelectedDialogProcessId = computed(() =>
  text(props.selectedDialogProcessId || innerSelectedDialogProcessId.value),
);

const selectedNode = computed(
  () =>
    positionedNodes.value.find((nodeItem) =>
      nodeContainsDialogProcessId(nodeItem, effectiveSelectedDialogProcessId.value),
    ) || null,
);

const hostStyle = computed(() => ({
  height: `${Math.max(graphHeight.value * zoomScale.value, 1)}px`,
}));

const stageStyle = computed(() => ({
  transform: `scale(${zoomScale.value})`,
  transformOrigin: "top left",
  width: `${Math.max(stageWidth.value, 1)}px`,
  height: `${Math.max(graphHeight.value, 1)}px`,
}));

function getNodeStyle(nodeItem = {}) {
  return {
    left: `${Math.round(Number(nodeItem?._x || 0))}px`,
    top: `${Math.round(Number(nodeItem?._y || 0))}px`,
    width: `${nodeWidth.value}px`,
    height: `${nodeHeight.value}px`,
  };
}

function isActionNode(nodeItem = {}) {
  return nodeItem?.type === WORKFLOW_NODE_TYPE.ACTION;
}

function buildCenterSegment({ fromNode = {}, toNode = {}, highlighted = false } = {}) {
  return {
    fromX: Number(fromNode?._x || 0) + nodeWidth.value / 2,
    fromY: Number(fromNode?._y || 0) + nodeHeight.value,
    toX: Number(toNode?._x || 0) + nodeWidth.value / 2,
    toY: Number(toNode?._y || 0),
    highlighted,
  };
}

function buildSideRailSegment({
  fromNode = {},
  toNode = {},
  side = "left",
  highlighted = false,
} = {}) {
  const fromLeftX = Number(fromNode?._x || 0);
  const toLeftX = Number(toNode?._x || 0);
  const fromRightX = fromLeftX + nodeWidth.value;
  const toRightX = toLeftX + nodeWidth.value;
  const isRight = String(side || "left") === "right";
  const fromX = isRight ? fromRightX : fromLeftX;
  const toX = isRight ? toRightX : toLeftX;
  const fromY = Number(fromNode?._y || 0) + nodeHeight.value / 2;
  const toY = Number(toNode?._y || 0) + nodeHeight.value / 2;
  const busX = isRight
    ? Math.max(fromRightX, toRightX) + Math.round(parallelRailWidth.value * 0.48)
    : Math.min(fromLeftX, toLeftX) - Math.round(parallelRailWidth.value * 0.48);
  return {
    fromX,
    fromY,
    toX,
    toY,
    busX,
    highlighted,
  };
}

function buildWorkflowEdgeSegment({ fromNode = {}, toNode = {}, highlighted = false } = {}) {
  const fromRankSize = Number(fromNode?._rankSize || 1);
  const toRankSize = Number(toNode?._rankSize || 1);
  if (toRankSize > 1 && fromRankSize <= 1) {
    return buildSideRailSegment({ fromNode, toNode, side: "left", highlighted });
  }
  if (fromRankSize > 1 && toRankSize <= 1) {
    return buildSideRailSegment({ fromNode, toNode, side: "right", highlighted });
  }
  return buildCenterSegment({ fromNode, toNode, highlighted });
}

const edgeSegments = computed(() => {
  const segments = [];
  const selectedRowIndex = Number(selectedNode.value?._rowIndex ?? -1);
  const nodeBySemanticId = new Map(
    positionedNodes.value.map((nodeItem) => [resolveSemanticNodeId(nodeItem), nodeItem]),
  );
  for (const flowto of props.flowtos) {
    const fromNode = nodeBySemanticId.get(text(flowto?.from));
    const toNode = nodeBySemanticId.get(text(flowto?.to));
    if (!fromNode || !toNode) continue;
    const minRow = Math.min(fromNode._rowIndex, toNode._rowIndex);
    segments.push(
      buildWorkflowEdgeSegment({
        fromNode,
        toNode,
        highlighted: selectedRowIndex >= 0 && minRow < selectedRowIndex,
      }),
    );
  }
  return segments;
});

function refreshSize() {
  const host = hostRef.value;
  if (!host) return;
  hostWidth.value = Math.ceil(host.clientWidth || 0);
}

function setupResizeObserver() {
  const host = hostRef.value;
  if (!host) return;
  resizeObserverRef.value = new ResizeObserver(() => {
    refreshSize();
  });
  resizeObserverRef.value.observe(host);
}

function teardownResizeObserver() {
  if (resizeObserverRef.value) {
    resizeObserverRef.value.disconnect();
    resizeObserverRef.value = null;
  }
}

onMounted(async () => {
  await nextTick();
  refreshSize();
  setupResizeObserver();
});

onBeforeUnmount(() => {
  teardownResizeObserver();
});

function zoomIn() {
  zoomScale.value = Math.min(1.5, Number((zoomScale.value + 0.1).toFixed(2)));
}

function zoomOut() {
  zoomScale.value = Math.max(0.7, Number((zoomScale.value - 0.1).toFixed(2)));
}

function zoomReset() {
  zoomScale.value = 1;
}

function handleNodeClick(nodeItem = {}) {
  if (!isActionNode(nodeItem)) return;
  emit("node-click", nodeItem);
}
</script>

<template>
  <div class="workflow-canvas-root">
    <BaseZoomControls
      :title="translate('workflow.canvasTitle')"
      :scale="zoomScale"
      :reset-label="translate('workflow.reset')"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
      @zoom-reset="zoomReset"
    />
    <div ref="hostRef" class="workflow-canvas-graph" :style="hostStyle">
      <div class="workflow-stage" :style="stageStyle">
        <WorkflowGraphEdges
          :width="Math.max(stageWidth, 1)"
          :height="Math.max(graphHeight, 1)"
          :segments="edgeSegments"
        />

        <WorkflowGraphNode
          v-for="(nodeItem, nodeIndex) in positionedNodes"
          :key="nodeItem.nodeId"
          :node-item="nodeItem"
          :node-index="nodeIndex"
          :style-obj="getNodeStyle(nodeItem)"
          :clickable="isActionNode(nodeItem)"
          :selected="nodeContainsDialogProcessId(nodeItem, effectiveSelectedDialogProcessId)"
          :expanded="false"
          @click="handleNodeClick"
        />

        <div class="workflow-minimap" v-if="layoutRows.length && !isCompactGraph">
          <div class="workflow-minimap-inner">
            <div
              v-for="(row, rowIndex) in layoutRows"
              :key="`${row.key}-${rowIndex}`"
              class="workflow-minimap-row"
            >
              <span
                v-for="(nodeItem, colIndex) in row.nodes"
                :key="nodeItem.nodeId"
                class="workflow-minimap-node"
                :class="nodeItem.status"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.workflow-canvas-graph {
  position: relative;
  min-height: 1px;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-x: contain;
}

.workflow-stage {
  position: relative;
}

:deep(.workflow-canvas) {
  position: relative;
  z-index: 0;
}

.workflow-minimap {
  position: absolute;
  right: 10px;
  bottom: 10px;
  border: 1px solid var(--noobot-msg-assistant-border);
  border-radius: var(--noobot-radius-md);
  padding: var(--noobot-space-xs);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 94%, var(--noobot-base-black) 6%);
  opacity: 0.72;
  z-index: 4;
}

.workflow-minimap-inner {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-2xs);
}

.workflow-minimap-row {
  display: flex;
  justify-content: center;
  gap: var(--noobot-space-3xs);
}

.workflow-minimap-node {
  width: 10px;
  height: 6px;
  border-radius: var(--noobot-radius-xs);
  background: color-mix(in srgb, var(--noobot-text-muted) 35%, transparent);
}

.workflow-minimap-node.succeeded {
  background: color-mix(in srgb, var(--noobot-status-success) 65%, transparent);
}

.workflow-minimap-node.failed,
.workflow-minimap-node.stopped {
  background: color-mix(in srgb, var(--noobot-status-error) 72%, transparent);
}

.workflow-minimap-node.running {
  background: color-mix(in srgb, var(--noobot-status-running) 72%, transparent);
}

@media (max-width: 480px) {
  .workflow-canvas-graph {
    width: 100%;
  }
}
</style>
