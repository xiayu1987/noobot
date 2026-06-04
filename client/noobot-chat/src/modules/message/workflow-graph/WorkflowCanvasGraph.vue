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
  selectedDialogId: { type: String, default: "" },
});

const emit = defineEmits(["node-click", "update:selectedDialogId"]);

const hostRef = ref(null);
const resizeObserverRef = ref(null);
const hostWidth = ref(0);
const zoomScale = ref(1);
const innerSelectedDialogId = ref("");

const NODE_WIDTH = 192;
const NODE_HEIGHT = 58;
const NODE_GAP_Y = 22;
const NODE_GAP_X = 28;
const PARALLEL_RAIL_WIDTH = 104;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 12;
const PADDING_LEFT = 12;
const PADDING_RIGHT = 12;

const normalizedNodes = computed(() => {
  const baseNodes = (Array.isArray(props.nodes) ? props.nodes : []).map((nodeItem = {}, index) => {
    const status = String(nodeItem?.status || nodeItem?._status || "").trim().toLowerCase();
    const resolvedStatus = status || "pending";
    return {
      ...nodeItem,
      _index: index,
      _status: resolvedStatus,
      _hasSession: resolvedStatus === "success" || Boolean(String(nodeItem?.sessionId || "").trim()),
    };
  });
  if (!baseNodes.length) return [];

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
  return [startNode, ...baseNodes, endNode];
});

const layoutRows = computed(() => {
  const sorted = normalizedNodes.value
    .slice()
    .sort((left, right) => Number(left?.transition || 0) - Number(right?.transition || 0));
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
      key: `serial_${String(nodeItem?.dialogId || nodeItem?._index || rows.length)}`,
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
  const maxCount = Math.max(1, flattenedNodes.value.length);
  return (
    PADDING_TOP +
    PADDING_BOTTOM +
    maxCount * NODE_HEIGHT +
    Math.max(0, maxCount - 1) * NODE_GAP_Y
  );
});

const graphWidth = computed(() => {
  return PADDING_LEFT + PADDING_RIGHT + PARALLEL_RAIL_WIDTH + NODE_WIDTH;
});

const positionedNodes = computed(() => {
  const positioned = [];
  const stageWidth = Math.max(hostWidth.value, graphWidth.value, NODE_WIDTH + 24);
  const centeredX = Math.round((stageWidth - NODE_WIDTH) / 2);
  const x = Math.max(PADDING_LEFT + PARALLEL_RAIL_WIDTH, centeredX);
  flattenedNodes.value.forEach((nodeItem, nodeIndex) => {
    positioned.push({
      ...nodeItem,
      _rowIndex: nodeIndex,
      _colIndex: 0,
      _x: x,
      _y: PADDING_TOP + nodeIndex * (NODE_HEIGHT + NODE_GAP_Y),
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
  width: `${Math.max(hostWidth.value, graphWidth.value, NODE_WIDTH + 24)}px`,
  height: `${Math.max(graphHeight.value, 1)}px`,
}));

function getNodeStyle(nodeItem = {}) {
  return {
    left: `${Math.round(Number(nodeItem?._x || 0))}px`,
    top: `${Math.round(Number(nodeItem?._y || 0))}px`,
    width: `${NODE_WIDTH}px`,
    height: `${NODE_HEIGHT}px`,
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

const edgeSegments = computed(() => {
  const segments = [];
  if (positionedNodes.value.length <= 1) return segments;
  const selectedRowIndex = Number(selectedNode.value?._rowIndex ?? -1);
  for (let rowIndex = 0; rowIndex < positionedNodes.value.length - 1; rowIndex += 1) {
    const fromNode = positionedNodes.value[rowIndex];
    const toNode = positionedNodes.value[rowIndex + 1];
    segments.push({
      fromX: Number(fromNode?._x || 0) + NODE_WIDTH / 2,
      fromY: Number(fromNode?._y || 0) + NODE_HEIGHT,
      toX: Number(toNode?._x || 0) + NODE_WIDTH / 2,
      toY: Number(toNode?._y || 0),
      highlighted: selectedRowIndex >= 0 && rowIndex < selectedRowIndex,
    });
  }
  return segments;
});

const parallelGroups = computed(() => {
  const map = new Map();
  for (const nodeItem of positionedNodes.value) {
    if (nodeItem?._virtualBoundary) continue;
    const wave = Number(nodeItem?.parallelWave || 0);
    if (wave <= 0) continue;
    if (!map.has(wave)) {
      map.set(wave, {
        wave,
        count: 0,
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
        x: Number(nodeItem?._x || 0),
      });
    }
    const group = map.get(wave);
    group.count += 1;
    group.minY = Math.min(group.minY, Number(nodeItem?._y || 0));
    group.maxY = Math.max(group.maxY, Number(nodeItem?._y || 0) + NODE_HEIGHT);
    group.x = Number(nodeItem?._x || 0);
  }
  return Array.from(map.values())
    .filter((group) => Number(group?.count || 0) > 1)
    .sort((a, b) => Number(a.wave || 0) - Number(b.wave || 0));
});

function getParallelGroupStyle(group = {}) {
  return {
    left: `${Math.round(Number(group?.x || 0) - PARALLEL_RAIL_WIDTH + 12)}px`,
    top: `${Math.round(Number(group?.minY || 0) + 2)}px`,
    width: `${PARALLEL_RAIL_WIDTH - 24}px`,
    height: `${Math.max(28, Number(group?.maxY || 0) - Number(group?.minY || 0) - 4)}px`,
  };
}

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
  const dialogId = String(nodeItem?.dialogId || "").trim();
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
        :width="Math.max(hostWidth, graphWidth, NODE_WIDTH + 24)"
        :height="Math.max(graphHeight, 1)"
        :segments="edgeSegments"
      />

      <div
        v-for="group in parallelGroups"
        :key="`parallel-group-${Number(group?.wave || 0)}`"
        class="workflow-parallel-group"
        :style="getParallelGroupStyle(group)"
      >
        <div class="workflow-parallel-group-label">
          并发波次 {{ Number(group?.wave || 0) }}（{{ Number(group?.count || 0) }}节点）
        </div>
      </div>

      <WorkflowGraphNode
        v-for="(nodeItem, nodeIndex) in positionedNodes"
        :key="`${String(nodeItem?.dialogId || '')}-${nodeIndex}`"
        :node-item="nodeItem"
        :node-index="nodeIndex"
        :style-obj="getNodeStyle(nodeItem)"
        :clickable="!nodeItem?._virtualBoundary"
        :boundary-type="String(nodeItem?._virtualBoundary || '')"
        :selected="String(nodeItem?.dialogId || '').trim() === effectiveSelectedDialogId"
        @click="handleNodeClick"
      />

      <div class="workflow-minimap" v-if="layoutRows.length">
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
  overflow-x: auto;
  overflow-y: hidden;
}

.workflow-stage {
  position: relative;
}

:deep(.workflow-canvas) {
  position: relative;
  z-index: 0;
}

.workflow-parallel-group {
  position: absolute;
  border-left: 3px solid rgba(109, 74, 255, 0.45);
  border-radius: 8px;
  background: linear-gradient(
    90deg,
    rgba(109, 74, 255, 0.09),
    rgba(109, 74, 255, 0.02)
  );
  pointer-events: none;
  z-index: 1;
}

.workflow-parallel-group-label {
  position: absolute;
  top: 8px;
  left: 8px;
  right: 8px;
  padding: 4px 6px;
  line-height: 1.25;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 600;
  color: color-mix(in srgb, #6d4aff 78%, var(--noobot-text-secondary) 22%);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 88%, #6d4aff 12%);
  border: 1px solid rgba(109, 74, 255, 0.22);
  text-align: center;
  word-break: keep-all;
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
</style>
