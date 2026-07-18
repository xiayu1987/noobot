<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import { BaseEmptyHint, BaseMessageErrorAlert } from "../../../../../client/noobot-chat/src/shared/ui";
import WorkflowSessionMessageItem from "../WorkflowSessionMessageItem.vue";
import { resolveWorkflowDialogProcessId } from "./workflowDialogProcessIdCompat.js";

function resolveDialogProcessId(item = {}) {
  return resolveWorkflowDialogProcessId(item);
}

defineProps({
  translate: { type: Function, required: true },
  viewerLoading: { type: Boolean, default: false },
  viewerError: { type: String, default: "" },
  selectedNodeSessionId: { type: String, default: "" },
  selectedRuntimeNode: { type: Object, default: null },
  selectedRuntimeBoxes: { type: Array, default: () => [] },
  selectedGraphDialogProcessId: { type: String, default: "" },
  displayNodeMessages: { type: Array, default: () => [] },
  nodeSessionAllMessages: { type: Array, default: () => [] },
  selectedNodeSessionDocs: { type: Array, default: () => [] },
  userId: { type: String, default: "" },
  authFetch: { type: Function, default: null },
  renderMarkdown: { type: Function, required: true },
  formatTime: { type: Function, required: true },
  formatFileSize: { type: Function, required: true },
  isImageMime: { type: Function, required: true },
  resolveStateBoxLabel: { type: Function, required: true },
  resolveStepLabel: { type: Function, required: true },
  resolveStatusClass: { type: Function, required: true },
  resolveStatusLabel: { type: Function, required: true },
  stepHasSession: { type: Function, required: true },
});

const viewerVisible = defineModel("viewerVisible", { type: Boolean, default: false });

const drawerSize = ref("72%");
let mobileMediaQuery;

function updateDrawerSize(event) {
  drawerSize.value = event.matches ? "100%" : "72%";
}

onMounted(() => {
  mobileMediaQuery = window.matchMedia("(max-width: 720px)");
  updateDrawerSize(mobileMediaQuery);
  mobileMediaQuery.addEventListener("change", updateDrawerSize);
});

onBeforeUnmount(() => {
  mobileMediaQuery?.removeEventListener("change", updateDrawerSize);
});

defineEmits(["runtime-step-click", "open-thinking-details"]);
</script>

<template>
  <el-drawer
    v-model="viewerVisible"
    direction="rtl"
    :size="drawerSize"
    destroy-on-close
    :append-to-body="true"
    :title="translate('workflow.nodeSessionTitle', { sessionId: selectedNodeSessionId || '' })"
    modal-class="workflow-node-session-modal noobot-side-drawer-modal"
    body-class="workflow-node-session-drawer__body noobot-side-drawer__body"
    header-class="workflow-node-session-drawer__header noobot-side-drawer__header"
    class="workflow-node-session-drawer noobot-side-drawer"
  >
    <div
      v-loading="viewerLoading"
      class="workflow-node-session-content"
      :element-loading-text="translate('workflow.loadingNodeSession')"
      element-loading-background="var(--noobot-panel-bg)"
    >
      <BaseMessageErrorAlert :error="viewerError" />
      <template v-if="!viewerError">
        <div v-if="selectedRuntimeNode" class="workflow-runtime-panel">
          <div class="workflow-runtime-panel-header">
            <div>
              <div class="workflow-runtime-panel-title">
                {{
                  selectedRuntimeNode?.nodeName ||
                  selectedRuntimeNode?.nodeId ||
                  translate("workflow.actionNode")
                }}
                ·
                {{ translate("workflow.runtimeState") }}
              </div>
              <div class="workflow-runtime-panel-subtitle">
                {{ translate("workflow.runtimeInspectorSubtitle") }}
              </div>
            </div>
          </div>
          <div class="workflow-runtime-panel-body">
            <div
              v-for="(stateBox, stateIndex) in selectedRuntimeBoxes"
              :key="`${String(selectedRuntimeNode?.nodeId || resolveDialogProcessId(selectedRuntimeNode) || '')}-${String(stateBox?.actionNodeStateId || stateIndex)}`"
              class="workflow-runtime-state-box"
            >
              <div class="workflow-runtime-state-title">
                <span>{{ resolveStateBoxLabel(stateBox, stateIndex) }}</span>
                <span class="workflow-runtime-state-count">
                  {{ translate("workflow.stepCount", { count: (stateBox?.steps || []).length }) }}
                </span>
              </div>
              <button
                v-for="(stepItem, stepIndex) in (stateBox?.steps || [])"
                :key="`${String(stepItem?.stepId || resolveDialogProcessId(stepItem) || stepIndex)}-${stepIndex}`"
                type="button"
                class="workflow-runtime-step-box"
                :class="[
                  resolveStatusClass(stepItem),
                  {
                    'is-selected': resolveDialogProcessId(stepItem) === selectedGraphDialogProcessId,
                    'is-disabled': !stepHasSession(stepItem),
                  },
                ]"
                :disabled="!stepHasSession(stepItem)"
                @click.stop="$emit('runtime-step-click', stepItem)"
              >
                <span class="workflow-runtime-step-name">{{ resolveStepLabel(stepItem, stepIndex) }}</span>
                <span class="workflow-runtime-step-status">{{ resolveStatusLabel(stepItem) }}</span>
              </button>
              <BaseEmptyHint
                v-if="!(stateBox?.steps || []).length"
                class="workflow-runtime-step-empty"
                :text="translate('workflow.noStepBox')"
              />
            </div>
          </div>
        </div>
        <div
          v-for="(messageItem, messageIndex) in displayNodeMessages"
          :key="`thinking-${String(messageItem?.ts || '')}-${messageIndex}`"
          class="workflow-node-session-item"
        >
          <WorkflowSessionMessageItem
            :message-item="messageItem"
            :all-messages="nodeSessionAllMessages"
            :session-docs="selectedNodeSessionDocs"
            :user-id="userId"
            :auth-fetch="authFetch"
            :render-markdown="renderMarkdown"
            :format-time="formatTime"
            :format-file-size="formatFileSize"
            :is-image-mime="isImageMime"
            @open-thinking-details="$emit('open-thinking-details', $event)"
          />
        </div>
        <BaseEmptyHint
          v-if="!displayNodeMessages.length && !viewerLoading"
          class="workflow-node-empty"
          :text="translate('workflow.noNodeSessionContent')"
        />
      </template>
    </div>
  </el-drawer>
</template>

<style>
.workflow-node-session-drawer {
  --noobot-text-primary: var(--noobot-text-main);
  --workflow-accent-rgb: 109, 74, 255;
  --workflow-accent-strong-rgb: 122, 75, 244;
  --workflow-success-rgb: 31, 143, 74;
  --workflow-failed-rgb: 199, 59, 59;
}

.workflow-node-session-drawer__body {
  display: flex;
  flex-direction: column;
}

.workflow-node-session-content {
  position: relative;
  flex: 1 1 auto;
  min-height: 260px;
  padding: 12px;
  box-sizing: border-box;
}

.workflow-node-session-content .el-loading-mask {
  display: flex;
  align-items: center;
  justify-content: center;
}

.workflow-node-session-content .el-loading-spinner {
  top: auto;
  margin-top: 0;
}

.workflow-node-session-drawer__body .workflow-node-empty {
  color: var(--noobot-text-secondary);
  font-size: 13px;
}

.workflow-node-session-item {
  margin-bottom: 12px;
}

.workflow-node-session-item:last-child {
  margin-bottom: 0;
}

.workflow-runtime-panel {
  border: 1px solid color-mix(in srgb, var(--noobot-msg-assistant-border) 78%, rgb(var(--workflow-accent-rgb)) 22%);
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 14px;
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 94%, rgb(var(--workflow-accent-rgb)) 6%);
  box-shadow: 0 8px 20px rgba(var(--workflow-accent-rgb), 0.08);
}

.workflow-runtime-panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.workflow-runtime-panel-title {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--noobot-text-primary);
}

.workflow-runtime-panel-subtitle {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--noobot-text-secondary);
}

.workflow-runtime-panel-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.workflow-runtime-state-box {
  border: 1px solid color-mix(in srgb, var(--noobot-msg-assistant-border) 86%, transparent 14%);
  border-radius: 10px;
  padding: 10px;
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 98%, #000 2%);
}

.workflow-runtime-state-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
  color: var(--noobot-text-primary);
  font-size: 12px;
  font-weight: 650;
}

.workflow-runtime-state-count {
  flex: 0 0 auto;
  color: var(--noobot-text-secondary);
  font-size: 11px;
  font-weight: 500;
}

.workflow-runtime-step-box {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 34px;
  padding: 7px 9px;
  margin-top: 7px;
  border: 1px solid color-mix(in srgb, var(--noobot-msg-assistant-border) 78%, transparent 22%);
  border-radius: 8px;
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 96%, #000 4%);
  color: var(--noobot-text-primary);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}

.workflow-runtime-step-box:hover:not(:disabled) {
  border-color: rgba(var(--workflow-accent-rgb), 0.58);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 90%, rgb(var(--workflow-accent-rgb)) 10%);
  box-shadow: 0 5px 12px rgba(var(--workflow-accent-rgb), 0.12);
}

.workflow-runtime-step-box.is-selected {
  border-color: rgba(var(--workflow-accent-rgb), 0.9);
  box-shadow: 0 0 0 2px rgba(var(--workflow-accent-rgb), 0.14);
}

.workflow-runtime-step-box.is-disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.workflow-runtime-step-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}

.workflow-runtime-step-status {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 2px 7px;
  font-size: 11px;
  color: var(--noobot-text-secondary);
  background: rgba(127, 127, 127, 0.12);
}

.workflow-runtime-step-box.success .workflow-runtime-step-status {
  color: color-mix(in srgb, var(--noobot-status-success) 78%, var(--noobot-text-primary) 22%);
  background: color-mix(in srgb, var(--noobot-status-success) 14%, transparent 86%);
}

.workflow-runtime-step-box.failed .workflow-runtime-step-status {
  color: color-mix(in srgb, rgb(var(--workflow-failed-rgb)) 82%, var(--noobot-text-primary) 18%);
  background: rgba(var(--workflow-failed-rgb), 0.12);
}

.workflow-runtime-step-box.running .workflow-runtime-step-status {
  color: color-mix(in srgb, rgb(var(--workflow-accent-strong-rgb)) 82%, var(--noobot-text-primary) 18%);
  background: rgba(var(--workflow-accent-strong-rgb), 0.12);
}

.workflow-runtime-step-empty {
  margin-top: 6px;
  color: var(--noobot-text-secondary);
  font-size: 12px;
}
</style>
