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
    </div>
    <WorkflowGraphStatusBadge v-if="!boundaryType" :status="nodeItem?._status || 'pending'" />
  </div>
</template>

<style scoped>
.workflow-node {
  position: absolute;
  border: 1px solid var(--noobot-msg-assistant-border);
  border-radius: var(--noobot-radius-sm);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 96%, #6d4aff 4%);
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  transition: box-shadow 0.18s ease, border-color 0.18s ease;
}

.workflow-node:hover {
  border-color: color-mix(in srgb, #6d4aff 54%, var(--noobot-msg-assistant-border) 46%);
  box-shadow: 0 6px 14px rgba(109, 74, 255, 0.12);
}

.workflow-node.is-selected {
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
}

.workflow-node.boundary-end {
  background: color-mix(in srgb, #6d4aff 12%, var(--noobot-msg-assistant-bg) 88%);
  border-color: color-mix(in srgb, #6d4aff 40%, var(--noobot-msg-assistant-border) 60%);
}

.workflow-node-index {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: color-mix(in srgb, #6d4aff 74%, #fff 26%);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}

.workflow-node-main {
  flex: 1;
  min-width: 0;
}

.workflow-node-name {
  font-weight: 600;
  line-height: 1.3;
  word-break: break-word;
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
