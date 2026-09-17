<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { BaseEmptyHint, BaseMessageErrorAlert } from "noobot-chat/plugin-api/ui";
import { AgentExecutionView } from "noobot-chat/plugin-api/chat-ui";
import { resolveWorkflowDialogProcessId } from "../../utils/workflowDialogProcessId.js";

function resolveDialogProcessId(item = {}) {
  return resolveWorkflowDialogProcessId(item);
}

const props = defineProps({
  translate: { type: Function, required: true },
  viewerLoading: { type: Boolean, default: false },
  viewerError: { type: String, default: "" },
  viewerState: { type: String, default: "idle" },
  selectedNodeSessionId: { type: String, default: "" },
  runningPlaceholderViewModel: { type: Object, default: null },
  selectedExecutionId: { type: String, default: "" },
  executionDirectory: { type: Array, default: () => [] },
  attemptExecutionIds: { type: Array, default: () => [] },
  stopExecution: { type: Function, default: null },
  selectedRuntimeNode: { type: Object, default: null },
  selectedRuntimeStep: { type: Object, default: null },
  selectedRuntimeBoxes: { type: Array, default: () => [] },
  selectedGraphDialogProcessId: { type: String, default: "" },
  displayNodeMessages: { type: Array, default: () => [] },
  logWorkflowDiagnostics: { type: Function, default: null },
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
  const byId = new Map(
    items.map((item = {}) => [String(item.executionId || "").trim(), item]).filter(([id]) => id),
  );
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
    if (expandedExecutionIds.value.has(id))
      childIds.forEach((childId) => visit(childId, depth + 1));
  };
  roots.forEach((id) => visit(id, 0));
  [...byId.keys()].filter((id) => !visited.has(id)).forEach((id) => visit(id, 0));
  return rows;
});

const selectedExecution = computed(() => {
  const selectedId = String(props.selectedExecutionId || "").trim();
  return (
    (Array.isArray(props.executionDirectory) ? props.executionDirectory : []).find(
      (item = {}) => String(item.executionId || "").trim() === selectedId,
    ) || null
  );
});

const canStopSelectedExecution = computed(() =>
  Boolean(
    props.stopExecution &&
    props.selectedExecutionId &&
    selectedExecution.value?.capabilities?.canStop === true &&
    selectedExecution.value?.terminal !== true &&
    selectedExecution.value?.lifecycle?.terminal !== true,
  ),
);

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

watch(
  () => props.selectedExecutionId,
  () => {
    stopError.value = "";
  },
);

function toggleExecution(executionId = "") {
  const id = String(executionId || "").trim();
  if (!id) return;
  const next = new Set(expandedExecutionIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedExecutionIds.value = next;
}

watch(
  () => props.executionDirectory,
  (items = []) => {
    const next = new Set(expandedExecutionIds.value);
    for (const item of items) {
      const id = String(item?.executionId || "").trim();
      if (id && (id === props.selectedExecutionId || !item?.parentExecutionId)) next.add(id);
    }
    expandedExecutionIds.value = next;
  },
  { immediate: true, deep: true },
);

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
    props.displayNodeMessages
      .map(
        (item = {}) =>
          `${String(item?.content || "").length}:${JSON.stringify(item?.thinking || null).length}:${Array.isArray(item?.thinkingSteps) ? item.thinkingSteps.length : 0}:${Array.isArray(item?.toolLogs) ? item.toolLogs.length : 0}:${JSON.stringify(item?.turnTimings || item?.timings || null).length}`,
      )
      .join("|"),
  ],
  ([visible, sessionId], previous = []) => {
    if (!visible) return;
    const force = !previous[0] || sessionId !== previous[1];
    if (force) followRealtime.value = true;
    scrollRealtimeToBottom(force);
  },
  { flush: "post" },
);

watch(
  () => ({
    visible: viewerVisible.value,
    viewerState: String(props.viewerState || ""),
    sessionId: String(props.selectedNodeSessionId || ""),
    executionId: String(props.selectedExecutionId || ""),
    nodeExecutionId: String(props.selectedRuntimeNode?.nodeExecutionId || ""),
    nodeStatus: String(props.selectedRuntimeNode?.status || ""),
    selectedStepId: String(props.selectedRuntimeStep?.stepId || ""),
    selectedStepStatus: String(props.selectedRuntimeStep?.status || ""),
    runtimeBoxCount: props.selectedRuntimeBoxes.length,
    runtimeStepCount: props.selectedRuntimeBoxes.reduce(
      (count, box = {}) => count + (Array.isArray(box?.steps) ? box.steps.length : 0),
      0,
    ),
    messageCount: props.displayNodeMessages.length,
    runningMessageCount: props.displayNodeMessages.filter(
      (message = {}) => message?.pending === true,
    ).length,
    messages: props.displayNodeMessages.map((message = {}) => ({
      messageId: String(message?.presentationMessageId || message?.messageId || message?.id || ""),
      role: String(message?.role || ""),
      turnScopeId: String(message?.turnScopeId || ""),
      dialogProcessId: String(message?.dialogProcessId || ""),
      pending: message?.pending === true,
      channelState: String(message?.channelState?.state || message?.channelState || ""),
      status: String(message?.status || message?.state || ""),
      contentLength: String(message?.content || "").length,
    })),
    timingCount: props.displayNodeMessages.reduce(
      (count, message = {}) =>
        count +
        (Array.isArray(message?.turnTimings || message?.timings)
          ? (message.turnTimings || message.timings).length
          : 0),
      0,
    ),
    sessionTimingCount: props.selectedNodeSessionDocs.reduce(
      (count, session = {}) =>
        count + (Array.isArray(session?.turnTimings) ? session.turnTimings.length : 0),
      0,
    ),
  }),
  (renderState) => {
    if (!renderState.visible) return;
    props.logWorkflowDiagnostics?.("frontend.workflowRender.nodeDrawerCommitted", renderState);
  },
  { immediate: true, flush: "post" },
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
    <el-scrollbar
      ref="messageScrollRef"
      class="workflow-node-session-scroll"
      @scroll="updateFollowRealtime"
    >
      <div
        v-loading="viewerLoading"
        class="workflow-node-session-content"
        :element-loading-text="translate('workflow.loadingNodeSession')"
        element-loading-background="var(--noobot-panel-bg)"
      >
        <BaseMessageErrorAlert :error="viewerError" />
        <template v-if="!viewerError">
          <div
            v-if="attemptExecutionIds.length || executionDirectory.length"
            class="workflow-execution-directory"
          >
            <div class="workflow-execution-directory__title">Agent executions</div>
            <div v-if="selectedExecutionId" class="workflow-execution-directory__actions">
              <button
                type="button"
                class="workflow-execution-directory__stop"
                :disabled="!canStopSelectedExecution || Boolean(stopPendingExecutionId)"
                @click="stopSelectedExecution"
              >
                {{ stopPendingExecutionId ? "Stopping…" : "Stop execution" }}
              </button>
              <span v-if="stopError" class="workflow-execution-directory__stop-error">{{
                stopError
              }}</span>
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
              >
                Attempt {{ index + 1 }}
              </button>
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
                <span
                  v-if="row.hasChildren"
                  @click.stop="toggleExecution(row.execution.executionId)"
                >
                  {{ expandedExecutionIds.has(row.execution.executionId) ? "▾" : "▸" }}
                </span>
                {{ row.execution.executionKind || "agent" }} ·
                {{ row.execution.stage || row.execution.state || "pending" }}
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
                  v-for="(stepItem, stepIndex) in stateBox?.steps || []"
                  :key="`${String(stepItem?.stepId || resolveDialogProcessId(stepItem) || stepIndex)}-${stepIndex}`"
                  type="button"
                  class="workflow-runtime-step-box"
                  :class="[
                    resolveStatusClass(stepItem),
                    {
                      'is-selected':
                        resolveDialogProcessId(stepItem) === selectedGraphDialogProcessId,
                      'is-disabled': !stepHasSession(stepItem),
                    },
                  ]"
                  :disabled="!stepHasSession(stepItem)"
                  @click.stop="$emit('runtime-step-click', stepItem)"
                >
                  <span class="workflow-runtime-step-name">{{
                    resolveStepLabel(stepItem, stepIndex)
                  }}</span>
                  <span class="workflow-runtime-step-status">{{
                    resolveStatusLabel(stepItem)
                  }}</span>
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
            :empty-text="
              viewerLoading
                ? ''
                : displayNodeMessages.length
                  ? ''
                  : viewerState === 'pending'
                    ? translate('workflow.nodeSessionPending')
                    : translate('workflow.noNodeSessionContent')
            "
            attachment-preview-dialog-class="workflow-session-preview-dialog"
            file-preview-dialog-class="workflow-session-preview-dialog"
            @open-thinking-details="$emit('open-thinking-details', $event)"
          />
          <div
            v-if="selectedRuntimeStep && runningPlaceholderViewModel"
            class="workflow-node-running-placeholder"
            data-testid="workflow-node-running-placeholder"
          >
            {{ translate("workflow.nodeSessionPending") }}
          </div>
          <BaseEmptyHint
            v-else-if="selectedRuntimeStep && !viewerLoading && !displayNodeMessages.length"
            class="workflow-node-empty"
            :text="
              viewerState === 'pending'
                ? translate('workflow.nodeSessionPending')
                : translate('workflow.noNodeSessionContent')
            "
          />
        </template>
      </div>
    </el-scrollbar>
  </el-drawer>
</template>

<style>
.workflow-node-session-drawer {
  --noobot-text-primary: var(--noobot-text-main);
}

.workflow-node-session-drawer__body {
  display: flex;
  flex-direction: column;
}

.workflow-node-session-content {
  position: relative;
  flex: 1 1 auto;
  min-height: 260px;
  padding: var(--noobot-space-lg);
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
  font-size: var(--noobot-font-size-sm);
}

.workflow-node-session-item {
  margin-bottom: var(--noobot-space-lg);
}

.workflow-execution-directory {
  margin-bottom: var(--noobot-space-lg);
  padding: var(--noobot-space-md);
  border: 1px solid var(--noobot-msg-assistant-border);
  border-radius: var(--noobot-radius-xs);
}
.workflow-execution-directory__title {
  margin-bottom: var(--noobot-space-sm);
  font-weight: 600;
}
.workflow-execution-directory__actions {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-sm);
  margin-bottom: var(--noobot-space-sm);
}
.workflow-execution-directory__stop {
  border: 1px solid var(--el-color-danger);
  border-radius: var(--noobot-radius-xs);
  padding: var(--noobot-space-2xs) var(--noobot-space-md);
  color: var(--el-color-danger);
  background: transparent;
  cursor: pointer;
}
.workflow-execution-directory__stop:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.workflow-execution-directory__stop-error {
  color: var(--el-color-danger);
  font-size: var(--noobot-font-size-xs);
}
.workflow-execution-directory__group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--noobot-space-xs);
  margin-top: var(--noobot-space-xs);
}
.workflow-execution-directory__label {
  flex-basis: 100%;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-xs);
}
.workflow-execution-directory__item {
  border: 1px solid var(--noobot-msg-assistant-border);
  border-radius: var(--noobot-radius-xs);
  padding: var(--noobot-space-2xs) var(--noobot-space-md);
  color: var(--noobot-text-main);
  background: var(--noobot-panel-bg);
  cursor: pointer;
}
.workflow-execution-directory__item.is-selected {
  border-color: var(--noobot-accent);
  color: var(--noobot-accent);
}

.workflow-node-session-item:last-child {
  margin-bottom: 0;
}

.workflow-runtime-panel {
  border: 1px solid
    color-mix(in srgb, var(--noobot-msg-assistant-border) 78%, var(--noobot-accent) 22%);
  border-radius: var(--noobot-radius-md);
  padding: var(--noobot-space-lg);
  margin-bottom: var(--noobot-space-xl);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 94%, var(--noobot-accent) 6%);
}

.workflow-runtime-panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--noobot-space-lg);
  margin-bottom: var(--noobot-space-md);
}

.workflow-runtime-panel-title {
  font-size: var(--noobot-font-size-md);
  font-weight: 700;
  line-height: 1.35;
  color: var(--noobot-text-primary);
}

.workflow-runtime-panel-subtitle {
  margin-top: var(--noobot-space-2xs);
  font-size: var(--noobot-font-size-xs);
  line-height: 1.45;
  color: var(--noobot-text-secondary);
}

.workflow-runtime-panel-body {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-md);
}

.workflow-runtime-state-box {
  border: 1px solid color-mix(in srgb, var(--noobot-msg-assistant-border) 86%, transparent 14%);
  border-radius: var(--noobot-radius-sm);
  padding: var(--noobot-space-md);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 98%, var(--noobot-base-black) 2%);
}

.workflow-runtime-state-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--noobot-space-md);
  margin-bottom: var(--noobot-space-sm);
  color: var(--noobot-text-primary);
  font-size: var(--noobot-font-size-xs);
  font-weight: 650;
}

.workflow-runtime-state-count {
  flex: 0 0 auto;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-xs);
  font-weight: 500;
}

.workflow-runtime-step-box {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--noobot-space-md);
  min-height: var(--noobot-control-height-md);
  padding: var(--noobot-space-xs) var(--noobot-space-sm);
  margin-top: var(--noobot-space-xs);
  border: 1px solid color-mix(in srgb, var(--noobot-msg-assistant-border) 78%, transparent 22%);
  border-radius: var(--noobot-radius-xs);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 96%, var(--noobot-base-black) 4%);
  color: var(--noobot-text-primary);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--noobot-duration-fast) ease,
    background var(--noobot-duration-fast) ease;
}

.workflow-runtime-step-box:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--noobot-accent) 58%, transparent);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 90%, var(--noobot-accent) 10%);
}

.workflow-runtime-step-box.is-selected {
  border-color: color-mix(in srgb, var(--noobot-accent) 90%, transparent);
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
  font-size: var(--noobot-font-size-xs);
  font-weight: 600;
}

.workflow-runtime-step-status {
  flex: 0 0 auto;
  border-radius: var(--noobot-radius-pill);
  padding: var(--noobot-space-3xs) var(--noobot-space-xs);
  font-size: var(--noobot-font-size-xs);
  color: var(--noobot-text-secondary);
  background: color-mix(in srgb, var(--noobot-text-muted) 12%, transparent);
}

.workflow-runtime-step-box.success .workflow-runtime-step-status {
  color: color-mix(in srgb, var(--noobot-status-success) 78%, var(--noobot-text-primary) 22%);
  background: color-mix(in srgb, var(--noobot-status-success) 14%, transparent 86%);
}

.workflow-runtime-step-box.failed .workflow-runtime-step-status {
  color: color-mix(in srgb, var(--noobot-status-error) 82%, var(--noobot-text-primary) 18%);
  background: color-mix(in srgb, var(--noobot-status-error) 12%, transparent);
}

.workflow-runtime-step-box.running .workflow-runtime-step-status {
  color: color-mix(in srgb, var(--noobot-status-running) 82%, var(--noobot-text-primary) 18%);
  background: color-mix(in srgb, var(--noobot-status-running) 12%, transparent);
}

.workflow-runtime-step-empty {
  margin-top: var(--noobot-space-xs);
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-xs);
}
</style>
