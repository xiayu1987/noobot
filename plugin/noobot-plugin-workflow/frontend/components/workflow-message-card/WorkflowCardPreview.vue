<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { BaseEmptyHint } from "noobot-chat/plugin-api/ui";
import WorkflowCanvasGraph from "../workflow-graph/WorkflowCanvasGraph.vue";

defineProps({
  translate: { type: Function, required: true },
  semanticPreviewLineCount: { type: Number, default: 0 },
  semanticPreviewCollapsible: { type: Boolean, default: false },
  semanticPreviewExpanded: { type: Boolean, default: false },
  semanticPreview: { type: String, default: "" },
  flowNodes: { type: Array, default: () => [] },
  semanticFlowtos: { type: Array, default: () => [] },
  selectedGraphDialogProcessId: { type: String, default: "" },
});

defineEmits([
  "update:semantic-preview-expanded",
  "update:selected-dialog-process-id",
  "node-click",
  "step-click",
]);
</script>

<template>
  <div class="workflow-card">
    <div class="workflow-card-header">
      <div>
        <div class="workflow-card-title">{{ translate("workflow.planningOutputTitle") }}</div>
        <div class="workflow-card-subtitle">
          {{ translate("workflow.lineCount", { count: semanticPreviewLineCount }) }}
        </div>
      </div>
      <button
        v-if="semanticPreviewCollapsible"
        type="button"
        class="workflow-preview-toggle"
        @click="$emit('update:semantic-preview-expanded', !semanticPreviewExpanded)"
      >
        {{ translate(semanticPreviewExpanded ? "workflow.collapse" : "workflow.expand") }}
      </button>
    </div>
    <div
      class="workflow-card-preview-shell"
      :class="{
        'is-collapsed': semanticPreviewCollapsible && !semanticPreviewExpanded,
      }"
    >
      <pre class="workflow-card-preview">{{ semanticPreview || translate("workflow.empty") }}</pre>
    </div>

    <div v-if="flowNodes.length" class="workflow-node-list">
      <div class="workflow-node-title">{{ translate("workflow.componentizedNodes") }}</div>
      <WorkflowCanvasGraph
        :nodes="flowNodes"
        :flowtos="semanticFlowtos"
        :selected-dialog-process-id="selectedGraphDialogProcessId"
        @update:selected-dialog-process-id="$emit('update:selected-dialog-process-id', $event)"
        @node-click="$emit('node-click', $event)"
        @step-click="$emit('step-click', $event)"
      />
    </div>
    <BaseEmptyHint
      v-else
      class="workflow-node-empty"
      :text="translate('workflow.noWorkflowNodes')"
    />

  </div>
</template>

<style scoped>
.workflow-card {
  --noobot-text-primary: var(--noobot-text-main);
  --workflow-card-space-sm: 10px;
  --workflow-card-space-md: 12px;
  border: 1px solid var(--noobot-msg-assistant-border);
  border-radius: var(--noobot-radius-md);
  padding: var(--workflow-card-space-md);
  margin-bottom: var(--workflow-card-space-sm);
  background: var(--noobot-msg-assistant-bg);
}

.workflow-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--workflow-card-space-md);
  margin-bottom: var(--workflow-card-space-sm);
}

.workflow-card-title {
  font-weight: 600;
  line-height: 1.35;
}

.workflow-card-subtitle {
  margin-top: 2px;
  font-size: 12px;
  color: var(--noobot-text-secondary);
}

.workflow-preview-toggle {
  flex: 0 0 auto;
  height: 26px;
  padding: 0 var(--workflow-card-space-sm);
  border: 1px solid var(--noobot-msg-assistant-border);
  border-radius: var(--noobot-radius-sm);
  background: var(--noobot-accent-soft);
  color: var(--noobot-text-primary);
  font-size: 12px;
  cursor: pointer;
}

.workflow-preview-toggle:hover {
  border-color: var(--noobot-border-primary);
  color: var(--noobot-text-accent);
}

.workflow-card-preview-shell {
  border: 1px solid color-mix(in srgb, var(--noobot-msg-assistant-border) 86%, transparent 14%);
  border-radius: var(--noobot-radius-sm);
  background: var(--noobot-panel-muted);
  overflow: hidden;
}

.workflow-card-preview-shell.is-collapsed {
  max-height: 188px;
}

.workflow-card-preview {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: var(--workflow-card-space-sm) var(--workflow-card-space-md);
  color: var(--noobot-text-primary);
  font-size: 12px;
  line-height: 1.55;
  background: transparent;
  overflow: visible;
}

.workflow-node-list {
  margin-top: var(--workflow-card-space-sm);
}

.workflow-node-title {
  font-size: 13px;
  margin-bottom: 6px;
  color: var(--noobot-text-secondary);
}

.workflow-node-empty {
  color: var(--noobot-text-secondary);
  font-size: 13px;
}

</style>
