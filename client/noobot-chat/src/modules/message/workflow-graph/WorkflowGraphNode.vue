<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import WorkflowGraphStatusBadge from "./WorkflowGraphStatusBadge.vue";

defineProps({
  nodeItem: { type: Object, default: () => ({}) },
  nodeIndex: { type: Number, default: 0 },
  selected: { type: Boolean, default: false },
  styleObj: { type: Object, default: () => ({}) },
  clickable: { type: Boolean, default: true },
  boundaryType: { type: String, default: "" },
});

const emit = defineEmits(["click"]);

function isStateNode(nodeItem = {}, boundaryType = "") {
  if (boundaryType) return true;
  const type = String(nodeItem?.type || "").trim().toLowerCase();
  if (type === "state") return true;
  return Number(nodeItem?.nodeType) === 0;
}

function resolveStateTypeKey(nodeItem = {}, boundaryType = "") {
  if (boundaryType === "start") return "start";
  if (boundaryType === "end") return "end";
  const stateType = Number(nodeItem?.stateType);
  if (stateType === 1) return "end";
  if (stateType === 2) return "branch";
  if (stateType === 3) return "merge";
  return "normal";
}

function resolveStateTypeLabel(nodeItem = {}, boundaryType = "") {
  const key = resolveStateTypeKey(nodeItem, boundaryType);
  if (key === "start") return "开始";
  if (key === "end") return "结束";
  if (key === "branch") return "分叉";
  if (key === "merge") return "汇聚";
  return "状态";
}

function handleClick(nodeItem = {}, clickable = true) {
  if (!clickable) return;
  emit("click", nodeItem);
}
</script>

<template>
  <div
    class="workflow-node"
    :class="{
      'is-running': String(nodeItem?._status || '').trim() === 'running',
      'is-selected': selected,
      'is-boundary': Boolean(boundaryType),
      'is-state-node': isStateNode(nodeItem, boundaryType),
      [`state-${resolveStateTypeKey(nodeItem, boundaryType)}`]: isStateNode(nodeItem, boundaryType),
      [`boundary-${String(boundaryType || '').trim()}`]: Boolean(boundaryType),
    }"
    :style="styleObj"
    @click="handleClick(nodeItem, clickable)"
  >
    <div v-if="!boundaryType" class="workflow-node-index">{{ nodeIndex + 1 }}</div>
    <div class="workflow-node-main">
      <div class="workflow-node-name">
        {{ nodeItem?.nodeName || nodeItem?.nodeId || `节点${nodeIndex + 1}` }}
      </div>
      <div
        v-if="!boundaryType && Number(nodeItem?.parallelWave || 0) > 0"
        class="workflow-node-parallel"
      >
        并发#{{ Number(nodeItem?.parallelWave || 0) }} · 序{{ Number(nodeItem?.waveOrder || 0) + 1 }}
      </div>
      <div
        v-if="!boundaryType && isStateNode(nodeItem, boundaryType)"
        class="workflow-node-kind"
      >
        {{ resolveStateTypeLabel(nodeItem, boundaryType) }}
      </div>
    </div>
    <WorkflowGraphStatusBadge v-if="!boundaryType" :status="nodeItem?._status || 'pending'" />
  </div>
</template>

<style scoped>
.workflow-node {
  position: absolute;
  z-index: 2;
  border: 1px solid var(--noobot-msg-assistant-border);
  border-radius: var(--noobot-radius-sm);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 96%, #6d4aff 4%);
  padding: 7px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: box-shadow 0.18s ease, border-color 0.18s ease;
}

.workflow-node.is-state-node {
  border-radius: 999px;
  padding-inline: 10px;
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 92%, #18a058 8%);
  border-color: color-mix(in srgb, var(--noobot-status-success) 32%, var(--noobot-msg-assistant-border) 68%);
}

.workflow-node.is-state-node.state-branch,
.workflow-node.is-state-node.state-merge {
  border-radius: 14px;
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 91%, #6d4aff 9%);
  border-color: rgba(109, 74, 255, 0.42);
}

.workflow-node.is-state-node.state-branch::before,
.workflow-node.is-state-node.state-merge::before,
.workflow-node.is-state-node.state-branch::after,
.workflow-node.is-state-node.state-merge::after {
  content: "";
  position: absolute;
  top: 12px;
  bottom: 12px;
  width: 3px;
  border-radius: 999px;
  background: rgba(109, 74, 255, 0.48);
}

.workflow-node.is-state-node.state-branch::before,
.workflow-node.is-state-node.state-merge::before {
  left: 6px;
}

.workflow-node.is-state-node.state-branch::after,
.workflow-node.is-state-node.state-merge::after {
  right: 6px;
}

.workflow-node:hover {
  border-color: color-mix(in srgb, #6d4aff 54%, var(--noobot-msg-assistant-border) 46%);
  box-shadow: 0 6px 14px rgba(109, 74, 255, 0.12);
}

.workflow-node.is-selected {
  z-index: 3;
  border-color: rgba(109, 74, 255, 0.95);
  box-shadow: 0 0 0 2px rgba(109, 74, 255, 0.2), 0 8px 20px rgba(109, 74, 255, 0.18);
}

.workflow-node.is-running {
  animation: workflow-node-pulse 1.25s ease-in-out infinite;
}

.workflow-node.is-boundary {
  justify-content: center;
  font-weight: 700;
  letter-spacing: 0.5px;
  cursor: default;
}

.workflow-node.boundary-start {
  background: color-mix(in srgb, var(--noobot-status-success) 12%, var(--noobot-msg-assistant-bg) 88%);
  border-color: color-mix(in srgb, var(--noobot-status-success) 36%, var(--noobot-msg-assistant-border) 64%);
  border-radius: 999px;
}

.workflow-node.boundary-end {
  background: color-mix(in srgb, #6d4aff 12%, var(--noobot-msg-assistant-bg) 88%);
  border-color: color-mix(in srgb, #6d4aff 40%, var(--noobot-msg-assistant-border) 60%);
  border-radius: 999px;
}

.workflow-node-index {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: color-mix(in srgb, #6d4aff 74%, #fff 26%);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
}

.workflow-node-main {
  flex: 1;
  min-width: 0;
}

.workflow-node-name {
  font-weight: 600;
  line-height: 1.25;
  font-size: 12px;
  word-break: break-word;
}

.workflow-node-parallel {
  margin-top: 2px;
  font-size: 10px;
  color: color-mix(in srgb, #6d4aff 82%, var(--noobot-text-secondary) 18%);
  line-height: 1.2;
}

.workflow-node-kind {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  margin-top: 3px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 1.3;
  color: color-mix(in srgb, var(--noobot-status-success) 74%, var(--noobot-text-secondary) 26%);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 82%, var(--noobot-status-success) 18%);
}

.workflow-node.state-branch .workflow-node-kind,
.workflow-node.state-merge .workflow-node-kind {
  color: color-mix(in srgb, #6d4aff 82%, var(--noobot-text-secondary) 18%);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 82%, #6d4aff 18%);
}

@keyframes workflow-node-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 rgba(122, 75, 244, 0.12);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(122, 75, 244, 0.08);
  }
}
</style>
