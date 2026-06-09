<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import WorkflowGraphStatusBadge from "./WorkflowGraphStatusBadge.vue";
import { useWorkflowLocale } from "../../i18n";

defineProps({
  nodeItem: { type: Object, default: () => ({}) },
  nodeIndex: { type: Number, default: 0 },
  selected: { type: Boolean, default: false },
  styleObj: { type: Object, default: () => ({}) },
  clickable: { type: Boolean, default: true },
  boundaryType: { type: String, default: "" },
  expanded: { type: Boolean, default: false },
});

const emit = defineEmits(["click"]);
const { translate } = useWorkflowLocale();

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isStartName(value = "") {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  return (
    normalized === "start" ||
    normalized === normalizeText(translate("workflow.stateStart"))
  );
}

function isEndName(value = "") {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  return (
    normalized === "end" ||
    normalized === normalizeText(translate("workflow.stateEnd"))
  );
}

function isStateNode(nodeItem = {}, boundaryType = "") {
  if (boundaryType) return true;
  const type = String(nodeItem?.type || "").trim().toLowerCase();
  if (type === "state") return true;
  return Number(nodeItem?.nodeType) === 0;
}

function resolveStateTypeKey(nodeItem = {}, boundaryType = "") {
  if (boundaryType === "start") return "start";
  if (boundaryType === "end") return "end";
  const nodeId = String(nodeItem?.nodeId || nodeItem?.id || "").trim().toLowerCase();
  const nodeName = String(nodeItem?.nodeName || nodeItem?.name || "");
  const stateType = Number(nodeItem?.stateType);
  if (stateType === 1 || nodeId === "end" || isEndName(nodeName)) return "end";
  if (stateType === 2) return "branch";
  if (stateType === 3) return "merge";
  if (stateType === 0 && (nodeId === "start" || isStartName(nodeName))) {
    return "start";
  }
  return "normal";
}

function resolveStateTypeLabel(nodeItem = {}, boundaryType = "") {
  const key = resolveStateTypeKey(nodeItem, boundaryType);
  if (key === "start") return translate("workflow.stateStart");
  if (key === "end") return translate("workflow.stateEnd");
  if (key === "branch") return translate("workflow.stateBranch");
  if (key === "merge") return translate("workflow.stateMerge");
  return translate("workflow.stateNormal");
}

function isActionNode(nodeItem = {}, boundaryType = "") {
  if (boundaryType) return false;
  return !isStateNode(nodeItem, boundaryType);
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
      'is-clickable': clickable,
      'is-expanded': expanded,
    }"
    :style="styleObj"
    @click="handleClick(nodeItem, clickable)"
  >
    <div v-if="isActionNode(nodeItem, boundaryType)" class="workflow-node-index">{{ nodeIndex + 1 }}</div>
    <div
      v-else-if="isStateNode(nodeItem, boundaryType)"
      class="workflow-node-state-icon"
      :class="`state-icon-${resolveStateTypeKey(nodeItem, boundaryType)}`"
    >
      <span v-if="resolveStateTypeKey(nodeItem, boundaryType) === 'start'">▶</span>
      <span v-else-if="resolveStateTypeKey(nodeItem, boundaryType) === 'end'">●</span>
      <span v-else-if="resolveStateTypeKey(nodeItem, boundaryType) === 'branch'">◇</span>
      <span v-else-if="resolveStateTypeKey(nodeItem, boundaryType) === 'merge'">◆</span>
      <span v-else>•</span>
    </div>
    <div class="workflow-node-main">
      <div class="workflow-node-name">
        {{ nodeItem?.nodeName || nodeItem?.nodeId || translate("workflow.nodeFallback", { index: nodeIndex + 1 }) }}
      </div>
      <div
        v-if="!boundaryType && Number(nodeItem?.parallelWave || 0) > 0"
        class="workflow-node-parallel"
      >
        {{
          translate("workflow.parallelOrder", {
            wave: Number(nodeItem?.parallelWave || 0),
            order: Number(nodeItem?.waveOrder || 0) + 1,
          })
        }}
      </div>
      <div
        v-if="!boundaryType && isActionNode(nodeItem, boundaryType) && Array.isArray(nodeItem?.actionNodeStates) && nodeItem.actionNodeStates.length"
        class="workflow-node-runtime-hint"
      >
        {{
          translate(expanded ? "workflow.collapse" : "workflow.expand")
        }}
        ·
        {{
          translate("workflow.nodeBoxCount", {
            count: nodeItem.actionNodeStates.length,
          })
        }}
      </div>
      <div
        v-if="!boundaryType && isStateNode(nodeItem, boundaryType)"
        class="workflow-node-kind"
      >
        {{ resolveStateTypeLabel(nodeItem, boundaryType) }}
      </div>
    </div>
    <WorkflowGraphStatusBadge v-if="!boundaryType" :status="nodeItem?._status || 'pending'" />
    <span
      v-if="!boundaryType && isActionNode(nodeItem, boundaryType) && Array.isArray(nodeItem?.actionNodeStates) && nodeItem.actionNodeStates.length"
      class="workflow-node-expand-icon"
    >{{ expanded ? "⌃" : "⌄" }}</span>
  </div>
</template>

<style scoped>
.workflow-node {
  --workflow-accent-rgb: 109, 74, 255;
  --workflow-accent-strong-rgb: 122, 75, 244;
  --workflow-success-rgb: 31, 143, 74;
  --workflow-muted-rgb: 100, 116, 139;
  --workflow-node-space-xs: 6px;
  --workflow-node-space-sm: 7px;
  --workflow-node-space-md: 10px;
  --workflow-node-radius-sm: 10px;
  --workflow-node-radius-md: 16px;
  --workflow-node-shadow-hover: 0 6px 14px rgba(var(--workflow-accent-rgb), 0.12);
  --workflow-node-shadow-selected:
    0 0 0 2px rgba(var(--workflow-accent-rgb), 0.2),
    0 8px 20px rgba(var(--workflow-accent-rgb), 0.18);
  position: absolute;
  z-index: 2;
  border: 1px solid var(--noobot-msg-assistant-border);
  border-radius: var(--noobot-radius-sm);
  background: color-mix(
    in srgb,
    var(--noobot-msg-assistant-bg) 96%,
    rgb(var(--workflow-accent-rgb)) 4%
  );
  padding: var(--workflow-node-space-sm);
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: default;
  transition: box-shadow 0.18s ease, border-color 0.18s ease;
}

.workflow-node.is-state-node {
  border-radius: var(--workflow-node-radius-md);
  padding-inline: var(--workflow-node-space-md);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--noobot-msg-assistant-bg) 92%, rgb(var(--workflow-success-rgb)) 8%),
    color-mix(in srgb, var(--noobot-msg-assistant-bg) 98%, rgb(var(--workflow-success-rgb)) 2%)
  );
  border-color: color-mix(
    in srgb,
    var(--noobot-status-success) 34%,
    var(--noobot-msg-assistant-border) 66%
  );
}

.workflow-node.is-state-node.state-start,
.workflow-node.is-state-node.state-end,
.workflow-node.is-boundary {
  border-radius: 999px;
}

.workflow-node.is-state-node.state-branch,
.workflow-node.is-state-node.state-merge {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--noobot-msg-assistant-bg) 88%, rgb(var(--workflow-accent-rgb)) 12%),
    color-mix(in srgb, var(--noobot-msg-assistant-bg) 98%, rgb(var(--workflow-accent-rgb)) 2%)
  );
  border-color: rgba(var(--workflow-accent-rgb), 0.45);
}

.workflow-node.is-clickable {
  cursor: pointer;
}

.workflow-node.is-clickable:hover {
  border-color: color-mix(
    in srgb,
    rgb(var(--workflow-accent-rgb)) 54%,
    var(--noobot-msg-assistant-border) 46%
  );
  box-shadow: var(--workflow-node-shadow-hover);
}

.workflow-node.is-selected,
.workflow-node.is-expanded {
  z-index: 3;
  border-color: rgba(var(--workflow-accent-rgb), 0.95);
  box-shadow: var(--workflow-node-shadow-selected);
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
  clip-path: none;
}

.workflow-node.boundary-end {
  background: color-mix(in srgb, rgb(var(--workflow-accent-rgb)) 12%, var(--noobot-msg-assistant-bg) 88%);
  border-color: color-mix(in srgb, rgb(var(--workflow-accent-rgb)) 40%, var(--noobot-msg-assistant-border) 60%);
  border-radius: 999px;
  clip-path: none;
}

.workflow-node-index,
.workflow-node-state-icon {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  flex: 0 0 auto;
}

.workflow-node-index {
  background: color-mix(in srgb, rgb(var(--workflow-accent-rgb)) 74%, #fff 26%);
}

.workflow-node-state-icon {
  background: color-mix(in srgb, rgb(var(--workflow-success-rgb)) 74%, #fff 26%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.42);
}

.workflow-node-state-icon.state-icon-branch,
.workflow-node-state-icon.state-icon-merge {
  background: color-mix(in srgb, rgb(var(--workflow-accent-rgb)) 76%, #fff 24%);
}

.workflow-node-state-icon.state-icon-end {
  background: color-mix(in srgb, rgb(var(--workflow-muted-rgb)) 70%, #fff 30%);
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
  color: color-mix(in srgb, rgb(var(--workflow-accent-rgb)) 82%, var(--noobot-text-secondary) 18%);
  line-height: 1.2;
}

.workflow-node-runtime-hint {
  margin-top: 2px;
  font-size: 10px;
  color: color-mix(in srgb, rgb(var(--workflow-accent-rgb)) 82%, var(--noobot-text-secondary) 18%);
  line-height: 1.2;
}

.workflow-node-expand-icon {
  position: absolute;
  right: 6px;
  bottom: 2px;
  font-size: 10px;
  color: color-mix(in srgb, rgb(var(--workflow-accent-rgb)) 80%, var(--noobot-text-secondary) 20%);
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
  color: color-mix(in srgb, rgb(var(--workflow-accent-rgb)) 82%, var(--noobot-text-secondary) 18%);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 82%, rgb(var(--workflow-accent-rgb)) 18%);
}

@keyframes workflow-node-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 rgba(var(--workflow-accent-strong-rgb), 0.12);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(var(--workflow-accent-strong-rgb), 0.08);
  }
}

@media (max-width: 480px) {
  .workflow-node {
    padding: var(--workflow-node-space-xs);
    gap: 5px;
    border-radius: var(--workflow-node-radius-sm);
  }

  .workflow-node.is-state-node {
    padding-inline: 8px;
  }

  .workflow-node-index,
  .workflow-node-state-icon {
    width: 18px;
    height: 18px;
    font-size: 9px;
  }

  .workflow-node-name {
    font-size: 11px;
    line-height: 1.25;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .workflow-node-parallel,
  .workflow-node-runtime-hint,
  .workflow-node-kind {
    display: none;
  }

  :deep(.workflow-node-status) {
    padding: 1px 5px;
    font-size: 9px;
  }
}
</style>
