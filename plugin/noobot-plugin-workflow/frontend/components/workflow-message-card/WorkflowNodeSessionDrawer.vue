<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { BaseEmptyHint, BaseMessageErrorAlert } from "noobot-chat/plugin-api/ui";
import { AgentExecutionView } from "noobot-chat/plugin-api/chat-ui";
import { resolveWorkflowDialogProcessId } from "./workflowDialogProcessIdCompat.js";

function resolveDialogProcessId(item = {}) {
  return resolveWorkflowDialogProcessId(item);
}

const props = defineProps({
  translate: { type: Function, required: true },
  viewerLoading: { type: Boolean, default: false },
  viewerError: { type: String, default: "" },
  viewerState: { type: String, default: "idle" },
  selectedNodeSessionId: { type: String, default: "" },
  selectedExecutionId: { type: String, default: "" },
  executionDirectory: { type: Array, default: () => [] },
  attemptExecutionIds: { type: Array, default: () => [] },
  stopExecution: { type: Function, default: null },
  selectedRuntimeNode: { type: Object, default: null },
  selectedRuntimeStep: { type: Object, default: null },
  selectedRuntimeBoxes: { type: Array, default: () => [] },
  selectedGraphDialogProcessId: { type: String, default: "" },
  displayNodeMessages: { type: Array, default: () => [] },
  nodeSessionAllMessages: { type: Array, default: () => [] },
  selectedNodeSessionDocs: { type: Array, default: () => [] },
  userId: { type: String, default: "" },
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
const messageScrollRef = ref(null);
const followRealtime = ref(true);
const expandedExecutionIds = ref(new Set());
const stopPendingExecutionId = ref("");
const stopError = ref("");
let mobileMediaQuery;

const executionTreeRows = computed(() => {
  const items = Array.isArray(props.executionDirectory) ? props.executionDirectory : [];
  const byId = new Map(items.map((item = {}) => [String(item.executionId || "").trim(), item]).filter(([id]) => id));
  const children = new Map();
  for (const [id, item] of byId) {
    const parentId = String(item.parentExecutionId || "").trim();
    if (!byId.has(parentId) || parentId === id) continue;
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(id);
  }
  const roots = [...byId.keys()].filter((id) => {
    const parentId = String(byId.get(id)?.parentExecutionId || "").trim();
    return !parentId || !byId.has(parentId) || parentId === id;
  });
  const rows = [];
  const visited = new Set();
  const visit = (id, depth) => {
    if (visited.has(id)) return;
    visited.add(id);
    const childIds = children.get(id) || [];
    rows.push({ execution: byId.get(id), depth, hasChildren: childIds.length > 0 });
    if (expandedExecutionIds.value.has(id)) childIds.forEach((childId) => visit(childId, depth + 1));
  };
  roots.forEach((id) => visit(id, 0));
  [...byId.keys()].filter((id) => !visited.has(id)).forEach((id) => visit(id, 0));
  return rows;
});

const selectedExecution = computed(() => {
  const selectedId = String(props.selectedExecutionId || "").trim();
  return (Array.isArray(props.executionDirectory) ? props.executionDirectory : [])
    .find((item = {}) => String(item.executionId || "").trim() === selectedId) || null;
});

const canStopSelectedExecution = computed(() => Boolean(
  props.stopExecution &&
  props.selectedExecutionId &&
  selectedExecution.value?.capabilities?.canStop === true &&
  selectedExecution.value?.terminal !== true &&
  selectedExecution.value?.lifecycle?.terminal !== true,
));

async function stopSelectedExecution() {
  const executionId = String(props.selectedExecutionId || "").trim();
  if (!executionId || !canStopSelectedExecution.value || stopPendingExecutionId.value) return false;
  stopError.value = "";
  stopPendingExecutionId.value = executionId;
  try {
    const requested = await props.stopExecution(executionId);
    if (requested === false) stopError.value = "Unable to stop this execution.";
    return requested !== false;
  } catch (error) {
    stopError.value = String(error?.message || error || "Unable to stop this execution.");
    return false;
  } finally {
    if (stopPendingExecutionId.value === executionId) stopPendingExecutionId.value = "";
  }
}

watch(() => props.selectedExecutionId, () => {
  stopError.value = "";
});

function toggleExecution(executionId = "") {
  const id = String(executionId || "").trim();
  if (!id) return;
  const next = new Set(expandedExecutionIds.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  expandedExecutionIds.value = next;
}

watch(() => props.executionDirectory, (items = []) => {
  const next = new Set(expandedExecutionIds.value);
  for (const item of items) {
    const id = String(item?.executionId || "").trim();
    if (id && (id === props.selectedExecutionId || !item?.parentExecutionId)) next.add(id);
  }
  expandedExecutionIds.value = next;
}, { immediate: true, deep: true });

function getScrollWrap() {
  return messageScrollRef.value?.wrapRef || null;
}

function updateFollowRealtime() {
  const wrap = getScrollWrap();
  if (!wrap) return;
  followRealtime.value = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight <= 48;
}

async function scrollRealtimeToBottom(force = false) {
  await nextTick();
  const wrap = getScrollWrap();
  if (!wrap || (!force && !followRealtime.value)) return;
  wrap.scrollTop = wrap.scrollHeight;
}

watch(
  () => [
    viewerVisible.value,
    props.selectedNodeSessionId,
    props.displayNodeMessages.length,
    props.displayNodeMessages.map((item = {}) => `${String(item?.content || "").length}:${JSON.stringify(item?.thinking || null).length}:${Array.isArray(item?.thinkingSteps) ? item.thinkingSteps.length : 0}:${Array.isArray(item?.toolLogs) ? item.toolLogs.length : 0}:${JSON.stringify(item?.turnTimings || item?.timings || null).length}`).join("|"),
  ],
  ([visible, sessionId], previous = []) => {
    if (!visible) return;
    const force = !previous[0] || sessionId !== previous[1];
    if (force) followRealtime.value = true;
    scrollRealtimeToBottom(force);
  },
  { flush: "post" },
);

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

defineEmits(["runtime-step-click", "execution-select", "open-thinking-details"]);
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
    <el-scrollbar ref="messageScrollRef" class="workflow-node-session-scroll" @scroll="updateFollowRealtime">
    <div
      v-loading="viewerLoading"
      class="workflow-node-session-content"
      :element-loading-text="translate('workflow.loadingNodeSession')"
      element-loading-background="var(--noobot-panel-bg)"
    >
      <BaseMessageErrorAlert :error="viewerError" />
      <template v-if="!viewerError">
        <div v-if="attemptExecutionIds.length || executionDirectory.length" class="workflow-execution-directory">
          <div class="workflow-execution-directory__title">Agent executions</div>
          <div v-if="selectedExecutionId" class="workflow-execution-directory__actions">
            <button
              type="button"
              class="workflow-execution-directory__stop"
              :disabled="!canStopSelectedExecution || Boolean(stopPendingExecutionId)"
              @click="stopSelectedExecution"
            >{{ stopPendingExecutionId ? 'Stopping…' : 'Stop execution' }}</button>
            <span v-if="stopError" class="workflow-execution-directory__stop-error">{{ stopError }}</span>
          </div>
          <div v-if="attemptExecutionIds.length" class="workflow-execution-directory__group">
            <span class="workflow-execution-directory__label">Attempts</span>
            <button
              v-for="(executionId, index) in attemptExecutionIds"
              :key="executionId"
              type="button"
              class="workflow-execution-directory__item"
              :class="{ 'is-selected': executionId === selectedExecutionId }"
              @click="$emit('execution-select', executionId)"
            >Attempt {{ index + 1 }}</button>
          </div>
          <div v-if="executionDirectory.length" class="workflow-execution-directory__group">
            <span class="workflow-execution-directory__label">Execution tree</span>
            <button
              v-for="row in executionTreeRows"
              :key="row.execution.executionId"
              type="button"
              class="workflow-execution-directory__item"
              :class="{ 'is-selected': row.execution.executionId === selectedExecutionId }"
              :style="{ marginLeft: `${row.depth * 16}px` }"
              @click="$emit('execution-select', row.execution.executionId)"
            >
              <span v-if="row.hasChildren" @click.stop="toggleExecution(row.execution.executionId)">
                {{ expandedExecutionIds.has(row.execution.executionId) ? '▾' : '▸' }}
              </span>
              {{ row.execution.executionKind || 'agent' }} · {{ row.execution.stage || row.execution.state || 'pending' }}
            </button>
          </div>
        </div>
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
        <AgentExecutionView
          v-if="selectedRuntimeStep && (selectedExecutionId || selectedNodeSessionId)"
          :execution-id="selectedExecutionId || selectedNodeSessionId"
          channel-context="workflow-node"
          :messages="displayNodeMessages"
          :all-messages="nodeSessionAllMessages"
          :session-docs="selectedNodeSessionDocs"
          :user-id="userId"
          :render-markdown="renderMarkdown"
          :format-time="formatTime"
          :format-file-size="formatFileSize"
          :is-image-mime="isImageMime"
          :stop-execution="stopExecution"
          :empty-text="viewerLoading ? '' : (viewerState === 'pending' ? translate('workflow.nodeSessionPending') : translate('workflow.noNodeSessionContent'))"
          attachment-preview-dialog-class="workflow-session-preview-dialog"
          file-preview-dialog-class="workflow-session-preview-dialog"
          @open-thinking-details="$emit('open-thinking-details', $event)"
        />
        <BaseEmptyHint
          v-else-if="selectedRuntimeStep && !viewerLoading"
          class="workflow-node-empty"
          :text="viewerState === 'pending' ? translate('workflow.nodeSessionPending') : translate('workflow.noNodeSessionContent')"
        />
      </template>
    </div>
    </el-scrollbar>
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

.workflow-node-session-scroll {
  flex: 1 1 auto;
  min-height: 0;
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

.workflow-execution-directory { margin-bottom: 12px; padding: 10px; border: 1px solid var(--noobot-msg-assistant-border); border-radius: 8px; }
.workflow-execution-directory__title { margin-bottom: 8px; font-weight: 600; }
.workflow-execution-directory__actions { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.workflow-execution-directory__stop { border: 1px solid var(--el-color-danger); border-radius: 6px; padding: 4px 10px; color: var(--el-color-danger); background: transparent; cursor: pointer; }
.workflow-execution-directory__stop:disabled { opacity: .45; cursor: not-allowed; }
.workflow-execution-directory__stop-error { color: var(--el-color-danger); font-size: 12px; }
.workflow-execution-directory__group { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.workflow-execution-directory__label { flex-basis: 100%; color: var(--noobot-text-secondary); font-size: 12px; }
.workflow-execution-directory__item { border: 1px solid var(--noobot-msg-assistant-border); border-radius: 6px; padding: 5px 10px; color: var(--noobot-text-main); background: var(--noobot-panel-bg); cursor: pointer; }
.workflow-execution-directory__item.is-selected { border-color: rgb(var(--workflow-accent-rgb)); color: rgb(var(--workflow-accent-rgb)); }

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
