<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import WorkflowGraphNode from "./WorkflowGraphNode.vue";
import WorkflowGraphEdges from "./WorkflowGraphEdges.vue";

const props = defineProps({
  nodes: { type: Array, default: () => [] },
  flowtos: { type: Array, default: () => [] },
  selectedDialogId: { type: String, default: "" },
});

const emit = defineEmits(["node-click", "update:selectedDialogId"]);

const hostRef = ref(null);
const resizeObserverRef = ref(null);
const hostWidth = ref(0);
const zoomScale = ref(1);
const innerSelectedDialogId = ref("");

const DESKTOP_NODE_WIDTH = 192;
const COMPACT_MIN_NODE_WIDTH = 148;
const NODE_GAP_X = 34;

const isCompactGraph = computed(() => Number(hostWidth.value || 0) > 0 && Number(hostWidth.value || 0) <= 480);
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
  const baseNodes = (Array.isArray(props.nodes) ? props.nodes : []).map((nodeItem = {}, index) => {
    const status = String(nodeItem?.status || nodeItem?._status || "").trim().toLowerCase();
    const resolvedStatus = status || "pending";
    const dialogId = String(nodeItem?.dialogId || "").trim();
    const sessionId = String(nodeItem?.sessionId || "").trim();
    const hasSessionRef = Boolean(dialogId || sessionId);
    return {
      ...nodeItem,
      _index: index,
      _status: resolvedStatus,
      _hasSession: hasSessionRef,
    };
  });
  if (!baseNodes.length) return [];

  const hasStartBoundary = baseNodes.some((item) => {
    const nodeId = String(item?.nodeId || item?.id || "").trim().toLowerCase();
    return Number(item?.stateType) === 0 && nodeId === "start";
  });
  const hasEndBoundary = baseNodes.some((item) => {
    const nodeId = String(item?.nodeId || item?.id || "").trim().toLowerCase();
    return Number(item?.stateType) === 1 && nodeId === "end";
  });

  const maxTransition = baseNodes.reduce((acc, item) => {
    const t = Number(item?.transition || 0);
    return Number.isFinite(t) ? Math.max(acc, t) : acc;
  }, 0);

  const allFinished = baseNodes.every((item) => {
    const status = String(item?._status || "").trim().toLowerCase();
    return status === "success" || status === "failed" || status === "error";
  });

  const startNode = {
    dialogId: "__wf_start__",
    nodeId: "__wf_start__",
    nodeName: "开始",
    type: "state",
    nodeType: 0,
    stateType: 0,
    transition: -1,
    parallelWave: 0,
    waveOrder: 0,
    _index: -1,
    _status: "success",
    _hasSession: true,
    _virtualBoundary: "start",
  };
  const endNode = {
    dialogId: "__wf_end__",
    nodeId: "__wf_end__",
    nodeName: "结束",
    type: "state",
    nodeType: 0,
    stateType: 1,
    transition: maxTransition + 1,
    parallelWave: 0,
    waveOrder: 0,
    _index: baseNodes.length,
    _status: allFinished ? "success" : "pending",
    _hasSession: allFinished,
    _virtualBoundary: "end",
  };
  return [
    ...(hasStartBoundary ? [] : [startNode]),
    ...baseNodes,
    ...(hasEndBoundary ? [] : [endNode]),
  ];
});

function resolveSemanticNodeId(nodeItem = {}) {
  return String(nodeItem?.nodeId || nodeItem?.id || "").trim();
}

function buildTopologyRows(nodes = [], flowtos = []) {
  const nodeList = Array.isArray(nodes) ? nodes : [];
  const edgeList = (Array.isArray(flowtos) ? flowtos : [])
    .map((flowto = {}, index) => ({
      from: String(flowto?.from || "").trim(),
      to: String(flowto?.to || "").trim(),
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

  // 有环或孤立节点时，仍按原始顺序追加，避免节点丢失。
  let fallbackRank = Math.max(0, ...Array.from(rankById.values()).map((value) => Number(value || 0)));
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

const layoutRows = computed(() => {
  const topologyRows = buildTopologyRows(normalizedNodes.value, props.flowtos);
  if (topologyRows.length) return topologyRows;

  const sorted = normalizedNodes.value
    .slice()
    .sort((left, right) => {
      const lt = Number(left?.transition);
      const rt = Number(right?.transition);
      const hasLt = Number.isFinite(lt);
      const hasRt = Number.isFinite(rt);
      if (hasLt && hasRt && lt !== rt) return lt - rt;
      if (hasLt && !hasRt) return -1;
      if (!hasLt && hasRt) return 1;
      return Number(left?._index || 0) - Number(right?._index || 0);
    });
  const rows = [];
  const waveMap = new Map();
  for (const nodeItem of sorted) {
    const parallelWave = Number(nodeItem?.parallelWave || 0);
    if (parallelWave > 0) {
      const key = `wave_${parallelWave}`;
      if (!waveMap.has(key)) {
        const row = { key, nodes: [] };
        waveMap.set(key, row);
        rows.push(row);
      }
      waveMap.get(key).nodes.push(nodeItem);
      continue;
    }
    rows.push({
      key: `serial_${String(nodeItem?.dialogId || nodeItem?.nodeId || nodeItem?._index || rows.length)}`,
      nodes: [nodeItem],
    });
  }
  for (const row of rows) {
    row.nodes.sort(
      (left, right) =>
        Number(left?.waveOrder || 0) - Number(right?.waveOrder || 0) ||
        Number(left?.transition || 0) - Number(right?.transition || 0),
    );
  }
  return rows;
});

const flattenedNodes = computed(() => {
  const result = [];
  for (const row of layoutRows.value) {
    const nodes = Array.isArray(row?.nodes) ? row.nodes : [];
    for (const nodeItem of nodes) result.push(nodeItem);
  }
  return result;
});

const graphHeight = computed(() => {
  const nodeCount = Math.max(1, flattenedNodes.value.length);
  return paddingTop.value + paddingBottom.value + nodeCount * nodeHeight.value + Math.max(0, nodeCount - 1) * nodeGapY.value;
});

const graphWidth = computed(() => paddingLeft.value + paddingRight.value + parallelRailWidth.value * 2 + nodeWidth.value);

const stageWidth = computed(() => Math.max(hostWidth.value, graphWidth.value, nodeWidth.value + 24));

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

const rowNodeMap = computed(() => {
  const map = new Map();
  for (const nodeItem of positionedNodes.value) {
    const rowIndex = Number(nodeItem?._rowIndex || 0);
    if (!map.has(rowIndex)) map.set(rowIndex, []);
    map.get(rowIndex).push(nodeItem);
  }
  return map;
});

const effectiveSelectedDialogId = computed(
  () => String(props.selectedDialogId || innerSelectedDialogId.value || "").trim(),
);

const selectedNode = computed(() =>
  positionedNodes.value.find(
    (nodeItem) =>
      String(nodeItem?.dialogId || "").trim() &&
      String(nodeItem?.dialogId || "").trim() === effectiveSelectedDialogId.value,
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

function resolveStatusLabel(nodeItem = {}) {
  const status = String(nodeItem?._status || "").trim();
  if (status === "success") return "成功";
  if (status === "failed" || status === "error") return "失败";
  if (status === "running") return "执行中";
  return "待执行";
}

function resolveStatusClass(nodeItem = {}) {
  const status = String(nodeItem?._status || "").trim();
  if (status === "success") return "success";
  if (status === "failed" || status === "error") return "failed";
  if (status === "running") return "running";
  return "pending";
}

function isActionNode(nodeItem = {}) {
  const type = String(nodeItem?.type || "").trim().toLowerCase();
  if (type) return type === "action";
  return Number(nodeItem?.nodeType) === 2;
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

function buildSideRailSegment({ fromNode = {}, toNode = {}, side = "left", highlighted = false } = {}) {
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
  if (positionedNodes.value.length <= 1) return segments;
  const flowtos = Array.isArray(props.flowtos) ? props.flowtos : [];
  const selectedRowIndex = Number(selectedNode.value?._rowIndex ?? -1);
  if (flowtos.length) {
    const nodeBySemanticId = new Map();
    for (const nodeItem of positionedNodes.value) {
      const semanticId = String(nodeItem?.nodeId || nodeItem?.id || "").trim();
      if (!semanticId) continue;
      nodeBySemanticId.set(semanticId, nodeItem);
    }
    for (const flowto of flowtos) {
      const fromId = String(flowto?.from || "").trim();
      const toId = String(flowto?.to || "").trim();
      const fromNode = nodeBySemanticId.get(fromId);
      const toNode = nodeBySemanticId.get(toId);
      if (!fromNode || !toNode) continue;
      const fromRow = Number(fromNode?._rowIndex ?? -1);
      const toRow = Number(toNode?._rowIndex ?? -1);
      const minRow = Math.min(fromRow, toRow);
      segments.push(buildWorkflowEdgeSegment({
        fromNode,
        toNode,
        highlighted: selectedRowIndex >= 0 && minRow >= 0 && minRow < selectedRowIndex,
      }));
    }
    return segments;
  }

  for (let rowIndex = 0; rowIndex < positionedNodes.value.length - 1; rowIndex += 1) {
    const fromNode = positionedNodes.value[rowIndex];
    const toNode = positionedNodes.value[rowIndex + 1];
    segments.push(buildWorkflowEdgeSegment({
      fromNode,
      toNode,
      highlighted: selectedRowIndex >= 0 && rowIndex < selectedRowIndex,
    }));
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

watch(
  () =>
    normalizedNodes.value
      .map(
        (item) =>
          `${item.dialogId}|${item.sessionId}|${item._status}|${item.parallelWave}|${item.waveOrder}`,
      )
      .join("||"),
  async () => {
    await nextTick();
  },
);

watch(
  () => effectiveSelectedDialogId.value,
  async () => {
    await nextTick();
  },
);

function handleNodeClick(nodeItem = {}) {
  if (nodeItem?._virtualBoundary) return;
  if (!isActionNode(nodeItem)) return;
  if (nodeItem?._hasSession !== true) return;
  const dialogId = String(nodeItem?.dialogId || "").trim();
  if (!dialogId) return;
  innerSelectedDialogId.value = dialogId;
  emit("update:selectedDialogId", dialogId);
  emit("node-click", nodeItem);
}
</script>

<template>
  <div class="workflow-toolbar">
    <div class="workflow-toolbar-title">Canvas流程图</div>
    <div class="workflow-toolbar-actions">
      <button type="button" class="workflow-zoom-btn" @click="zoomOut">-</button>
      <span class="workflow-zoom-text">{{ Math.round(zoomScale * 100) }}%</span>
      <button type="button" class="workflow-zoom-btn" @click="zoomIn">+</button>
      <button type="button" class="workflow-zoom-reset" @click="zoomReset">重置</button>
    </div>
  </div>
  <div ref="hostRef" class="workflow-canvas-graph" :style="hostStyle">
    <div class="workflow-stage" :style="stageStyle">
      <WorkflowGraphEdges
        :width="Math.max(stageWidth, 1)"
        :height="Math.max(graphHeight, 1)"
        :segments="edgeSegments"
      />



      <WorkflowGraphNode
        v-for="(nodeItem, nodeIndex) in positionedNodes"
        :key="`${String(nodeItem?.nodeId || nodeItem?.dialogId || nodeItem?.sessionId || '')}-${nodeIndex}`"
        :node-item="nodeItem"
        :node-index="nodeIndex"
        :style-obj="getNodeStyle(nodeItem)"
        :clickable="!nodeItem?._virtualBoundary && isActionNode(nodeItem) && nodeItem?._hasSession === true"
        :boundary-type="String(nodeItem?._virtualBoundary || '')"
        :selected="String(nodeItem?.dialogId || '').trim() === effectiveSelectedDialogId"
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
              :key="`${String(nodeItem?.dialogId || '')}-${colIndex}`"
              class="workflow-minimap-node"
              :class="resolveStatusClass(nodeItem)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.workflow-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.workflow-toolbar-title {
  font-size: 13px;
  color: var(--noobot-text-secondary);
}

.workflow-toolbar-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.workflow-zoom-btn,
.workflow-zoom-reset {
  border: 1px solid var(--noobot-msg-assistant-border);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 96%, #6d4aff 4%);
  border-radius: 6px;
  cursor: pointer;
  color: var(--noobot-text-primary);
}

.workflow-zoom-btn {
  width: 24px;
  height: 24px;
}

.workflow-zoom-reset {
  padding: 0 8px;
  height: 24px;
}

.workflow-zoom-text {
  font-size: 12px;
  color: var(--noobot-text-secondary);
  min-width: 44px;
  text-align: center;
}

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
  border-radius: 8px;
  padding: 6px;
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 94%, #000 6%);
  opacity: 0.72;
  z-index: 4;
}

.workflow-minimap-inner {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.workflow-minimap-row {
  display: flex;
  justify-content: center;
  gap: 3px;
}

.workflow-minimap-node {
  width: 10px;
  height: 6px;
  border-radius: 3px;
  background: rgba(127, 127, 127, 0.35);
}

.workflow-minimap-node.success {
  background: rgba(31, 143, 74, 0.65);
}

.workflow-minimap-node.failed {
  background: rgba(199, 59, 59, 0.72);
}

.workflow-minimap-node.running {
  background: rgba(122, 75, 244, 0.72);
}

@media (max-width: 480px) {
  .workflow-toolbar {
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .workflow-toolbar-title {
    display: none;
  }

  .workflow-toolbar-actions {
    margin-left: auto;
    gap: 4px;
  }

  .workflow-zoom-btn {
    width: 28px;
    height: 28px;
  }

  .workflow-zoom-reset {
    height: 28px;
    padding: 0 7px;
  }

  .workflow-zoom-text {
    min-width: 38px;
    font-size: 11px;
  }

  .workflow-canvas-graph {
    width: 100%;
  }
}
</style>
