<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import WorkflowGraphStatusBadge from "./WorkflowGraphStatusBadge.vue";
import { useWorkflowLocale } from "../../i18n/index.js";
import {
  WORKFLOW_NODE_TYPE,
  WORKFLOW_STATE_TYPE,
} from "@noobot/event-protocol/workflow-runtime-event";

defineProps({
  nodeItem: { type: Object, default: () => ({}) },
  nodeIndex: { type: Number, default: 0 },
  selected: { type: Boolean, default: false },
  styleObj: { type: Object, default: () => ({}) },
  clickable: { type: Boolean, default: true },
  expanded: { type: Boolean, default: false },
});

const emit = defineEmits(["click"]);
const { translate } = useWorkflowLocale();

const STATE_TYPE_VIEW = Object.freeze({
  [WORKFLOW_STATE_TYPE.START]: { icon: "▶", labelKey: "workflow.stateStart" },
  [WORKFLOW_STATE_TYPE.END]: { icon: "●", labelKey: "workflow.stateEnd" },
  [WORKFLOW_STATE_TYPE.BRANCH]: { icon: "◇", labelKey: "workflow.stateBranch" },
  [WORKFLOW_STATE_TYPE.MERGE]: { icon: "◆", labelKey: "workflow.stateMerge" },
});

function isStateNode(nodeItem = {}) {
  return nodeItem?.type === WORKFLOW_NODE_TYPE.STATE;
}

function isActionNode(nodeItem = {}) {
  return nodeItem?.type === WORKFLOW_NODE_TYPE.ACTION;
}

function hasActionNodeStates(nodeItem = {}) {
  return isActionNode(nodeItem) && nodeItem.actionNodeStates.length > 0;
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
      'is-running': nodeItem.status === 'running',
      'is-selected': selected,
      'is-state-node': isStateNode(nodeItem),
      [`state-${nodeItem.stateType}`]: isStateNode(nodeItem),
      'is-clickable': clickable,
      'is-expanded': expanded,
    }"
    :style="styleObj"
    @click="handleClick(nodeItem, clickable)"
  >
    <div v-if="isActionNode(nodeItem)" class="workflow-node-index">
      {{ nodeIndex + 1 }}
    </div>
    <div
      v-else-if="isStateNode(nodeItem)"
      class="workflow-node-state-icon"
      :class="`state-icon-${nodeItem.stateType}`"
    >
      <span>{{ STATE_TYPE_VIEW[nodeItem.stateType].icon }}</span>
    </div>
    <div class="workflow-node-main">
      <div class="workflow-node-name">{{ nodeItem.nodeName }}</div>
      <div
        v-if="isActionNode(nodeItem) && nodeItem.parallelWave > 0"
        class="workflow-node-parallel"
      >
        {{
          translate("workflow.parallelOrder", {
            wave: nodeItem.parallelWave,
            order: nodeItem.waveOrder + 1,
          })
        }}
      </div>
      <div v-if="hasActionNodeStates(nodeItem)" class="workflow-node-runtime-hint">
        {{ translate("workflow.runtimeState") }}
        ·
        {{
          translate("workflow.nodeBoxCount", {
            count: nodeItem.actionNodeStates.length,
          })
        }}
      </div>
      <div v-if="isStateNode(nodeItem)" class="workflow-node-kind">
        {{ translate(STATE_TYPE_VIEW[nodeItem.stateType].labelKey) }}
      </div>
    </div>
    <WorkflowGraphStatusBadge v-if="isActionNode(nodeItem)" :status="nodeItem.status" />
    <span v-if="hasActionNodeStates(nodeItem)" class="workflow-node-expand-icon">↗</span>
  </div>
</template>

<style scoped>
.workflow-node {
  position: absolute;
  z-index: 2;
  border: 1px solid var(--noobot-msg-assistant-border);
  border-radius: var(--noobot-radius-sm);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 96%, var(--noobot-accent) 4%);
  padding: var(--noobot-space-xs);
  display: flex;
  align-items: center;
  gap: var(--noobot-space-xs);
  cursor: default;
  transition: border-color var(--noobot-duration-normal) var(--noobot-ease-standard);
}

.workflow-node.is-state-node {
  border-radius: var(--noobot-radius-lg);
  padding-inline: var(--noobot-space-md);
  background: color-mix(
    in srgb,
    var(--noobot-msg-assistant-bg) 94%,
    var(--noobot-status-success) 6%
  );
  border-color: color-mix(
    in srgb,
    var(--noobot-status-success) 34%,
    var(--noobot-msg-assistant-border) 66%
  );
}

.workflow-node.is-state-node.state-start,
.workflow-node.is-state-node.state-end {
  border-radius: var(--noobot-radius-pill);
}

.workflow-node.is-state-node.state-branch,
.workflow-node.is-state-node.state-merge {
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 92%, var(--noobot-accent) 8%);
  border-color: color-mix(in srgb, var(--noobot-accent) 45%, transparent);
}

.workflow-node.is-clickable {
  cursor: pointer;
}

.workflow-node.is-clickable:hover {
  border-color: color-mix(
    in srgb,
    var(--noobot-accent) 54%,
    var(--noobot-msg-assistant-border) 46%
  );
}

.workflow-node.is-selected,
.workflow-node.is-expanded {
  z-index: 3;
  border-color: color-mix(in srgb, var(--noobot-accent) 95%, transparent);
}

.workflow-node-index,
.workflow-node-state-icon {
  width: 20px;
  height: 20px;
  border-radius: var(--noobot-radius-pill);
  color: var(--noobot-base-white);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--noobot-font-size-xs);
  font-weight: var(--noobot-font-weight-bold);
  flex: 0 0 auto;
}

.workflow-node-index {
  background: color-mix(in srgb, var(--noobot-accent) 74%, var(--noobot-base-white) 26%);
}

.workflow-node-state-icon {
  background: color-mix(in srgb, var(--noobot-status-success) 74%, var(--noobot-base-white) 26%);
}

.workflow-node-state-icon.state-icon-branch,
.workflow-node-state-icon.state-icon-merge {
  background: color-mix(in srgb, var(--noobot-accent) 76%, var(--noobot-base-white) 24%);
}

.workflow-node-state-icon.state-icon-end {
  background: color-mix(in srgb, var(--noobot-status-idle) 70%, var(--noobot-base-white) 30%);
}

.workflow-node-main {
  flex: 1;
  min-width: 0;
}

.workflow-node-name {
  font-weight: var(--noobot-font-weight-semibold);
  line-height: var(--noobot-line-height-tight);
  font-size: var(--noobot-font-size-xs);
  word-break: break-word;
}

.workflow-node-parallel {
  margin-top: var(--noobot-space-3xs);
  font-size: var(--noobot-font-size-xs);
  color: color-mix(in srgb, var(--noobot-accent) 82%, var(--noobot-text-secondary) 18%);
  line-height: var(--noobot-line-height-compact);
}

.workflow-node-runtime-hint {
  margin-top: var(--noobot-space-3xs);
  font-size: var(--noobot-font-size-xs);
  color: color-mix(in srgb, var(--noobot-accent) 82%, var(--noobot-text-secondary) 18%);
  line-height: var(--noobot-line-height-compact);
}

.workflow-node-expand-icon {
  position: absolute;
  right: var(--noobot-space-xs);
  bottom: var(--noobot-space-3xs);
  font-size: var(--noobot-font-size-xs);
  color: color-mix(in srgb, var(--noobot-accent) 80%, var(--noobot-text-secondary) 20%);
}

.workflow-node-kind {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  margin-top: var(--noobot-space-3xs);
  padding: var(--noobot-space-3xs) var(--noobot-space-xs);
  border-radius: var(--noobot-radius-pill);
  font-size: var(--noobot-font-size-xs);
  line-height: var(--noobot-line-height-tight);
  color: color-mix(in srgb, var(--noobot-status-success) 74%, var(--noobot-text-secondary) 26%);
  background: color-mix(
    in srgb,
    var(--noobot-msg-assistant-bg) 82%,
    var(--noobot-status-success) 18%
  );
}

.workflow-node.state-branch .workflow-node-kind,
.workflow-node.state-merge .workflow-node-kind {
  color: color-mix(in srgb, var(--noobot-accent) 82%, var(--noobot-text-secondary) 18%);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 82%, var(--noobot-accent) 18%);
}

@media (max-width: 480px) {
  .workflow-node {
    padding: var(--noobot-space-xs);
    gap: var(--noobot-space-xs);
    border-radius: var(--noobot-radius-lg);
  }

  .workflow-node.is-state-node {
    padding-inline: var(--noobot-space-sm);
  }

  .workflow-node-index,
  .workflow-node-state-icon {
    width: 18px;
    height: 18px;
    font-size: var(--noobot-font-size-xs);
  }

  .workflow-node-name {
    font-size: var(--noobot-font-size-xs);
    line-height: var(--noobot-line-height-tight);
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
    padding: var(--noobot-space-3xs) var(--noobot-space-2xs);
    font-size: var(--noobot-font-size-xs);
  }
}
</style>
