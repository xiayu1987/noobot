<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { BaseEmptyHint, BaseMessageErrorAlert, useMobileViewport } from "noobot-chat/plugin-api/ui";
import { AgentExecutionView, ChatMessageItem } from "noobot-chat/plugin-api/chat-ui";
import { resolveMessageViewKey } from "@noobot/event-protocol/message-event";
import { resolveWorkflowDialogProcessId } from "../../utils/workflowDialogProcessId.js";
import { buildExecutionForest } from "@noobot/session-protocol/execution-lifecycle";

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
  executionDirectory: { type: Array, required: true },
  attemptExecutionIds: { type: Array, default: () => [] },
  stopExecution: { type: Function, required: true },
  fetchExecutionReport: { type: Function, required: true },
  selectedRuntimeNode: { type: Object, default: null },
  selectedRuntimeStep: { type: Object, default: null },
  selectedActionNodeStates: { type: Array, default: () => [] },
  selectedGraphDialogProcessId: { type: String, default: "" },
  displayNodeMessages: { type: Array, default: () => [] },
  logWorkflowDiagnostics: { type: Function, required: true },
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

const { drawerSize } = useMobileViewport();
const messageScrollRef = ref(null);
const followRealtime = ref(true);
const expandedExecutionIds = ref(new Set());
const stopPendingExecutionId = ref("");
const stopError = ref("");

const executionForest = computed(() => buildExecutionForest(props.executionDirectory));

const executionTreeRows = computed(() => {
  const { executions, rootExecutionIds } = executionForest.value;
  const rows = [];
  const visit = (id, depth) => {
    const execution = executions[id];
    const childIds = execution.childExecutionIds;
    rows.push({ execution, depth, hasChildren: childIds.length > 0 });
    if (expandedExecutionIds.value.has(id))
      childIds.forEach((childId) => visit(childId, depth + 1));
  };
  rootExecutionIds.forEach((id) => visit(id, 0));
  return rows;
});

const selectedExecution = computed(() => {
  return executionForest.value.executions[props.selectedExecutionId];
});

const canStopSelectedExecution = computed(() =>
  Boolean(props.selectedExecutionId && selectedExecution.value?.capabilities?.canStop === true),
);

async function stopSelectedExecution() {
  const executionId = props.selectedExecutionId;
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

function toggleExecution(id) {
  const next = new Set(expandedExecutionIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedExecutionIds.value = next;
}

watch(
  () => executionForest.value,
  ({ executions, rootExecutionIds }) => {
    const next = new Set(expandedExecutionIds.value);
    rootExecutionIds.forEach((id) => next.add(id));
    if (Object.hasOwn(executions, props.selectedExecutionId)) next.add(props.selectedExecutionId);
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
          `${String(item?.content || "").length}:${JSON.stringify(item?.thinking || null).length}:${Array.isArray(item?.thinkingSteps) ? item.thinkingSteps.length : 0}:${Array.isArray(item?.toolLogs) ? item.toolLogs.length : 0}`,
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
    actionNodeStateCount: props.selectedActionNodeStates.length,
    runtimeStepCount: props.selectedActionNodeStates.reduce(
      (count, box = {}) => count + (Array.isArray(box?.steps) ? box.steps.length : 0),
      0,
    ),
    messageCount: props.displayNodeMessages.length,
    runningMessageCount: props.displayNodeMessages.filter(
      (message = {}) => message?.pending === true,
    ).length,
    messages: props.displayNodeMessages.map((message = {}) => ({
      messageUid: String(message?.messageUid || ""),
      presentationMessageId: String(message?.presentationMessageId || ""),
      role: String(message?.role || ""),
      turnScopeId: String(message?.turnScopeId || ""),
      dialogProcessId: String(message?.dialogProcessId || ""),
      pending: message?.pending === true,
      channelState: String(message?.channelState?.state || message?.channelState || ""),
      status: String(message?.status || message?.state || ""),
      contentLength: String(message?.content || "").length,
    })),
  }),
  (renderState) => {
    if (!renderState.visible) return;
    props.logWorkflowDiagnostics("frontend.workflowRender.nodeDrawerCommitted", renderState);
  },
  { immediate: true, flush: "post" },
);

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
    modal-class="workflow-node-session-modal"
    body-class="workflow-node-session-drawer__body"
    header-class="workflow-node-session-drawer__header"
    class="workflow-node-session-drawer"
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
                {{ row.execution.executionKind }} ·
                {{ row.execution.state }}
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
                v-for="stateBox in selectedActionNodeStates"
                :key="stateBox.nodeExecutionId"
                class="workflow-runtime-state-box"
              >
                <div class="workflow-runtime-state-title">
                  <span>{{ resolveStateBoxLabel(stateBox) }}</span>
                  <span class="workflow-runtime-state-count">
                    {{ translate("workflow.stepCount", { count: stateBox.steps.length }) }}
                  </span>
                </div>
                <button
                  v-for="(stepItem, stepIndex) in stateBox.steps"
                  :key="stepItem.nodeExecutionId"
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
                  <span class="workflow-runtime-step-name">{{ resolveStepLabel(stepIndex) }}</span>
                  <span class="workflow-runtime-step-status">{{
                    resolveStatusLabel(stepItem)
                  }}</span>
                </button>
                <BaseEmptyHint
                  v-if="!stateBox.steps.length"
                  class="workflow-runtime-step-empty"
                  :text="translate('workflow.noStepBox')"
                />
              </div>
            </div>
          </div>
          <AgentExecutionView
            v-if="selectedRuntimeStep && selectedExecutionId"
            :execution-id="selectedExecutionId"
            channel-context="workflow-node"
            :messages="displayNodeMessages"
            :session-docs="selectedNodeSessionDocs"
            :user-id="userId"
            :render-markdown="renderMarkdown"
            :format-time="formatTime"
            :format-file-size="formatFileSize"
            :is-image-mime="isImageMime"
            :stop-execution="stopExecution"
            :fetch-execution-report="fetchExecutionReport"
            :empty-text="
              viewerLoading
                ? ''
                : displayNodeMessages.length
                  ? ''
                  : viewerState === 'pending'
                    ? translate('workflow.nodeSessionPending')
                    : translate('workflow.noNodeSessionContent')
            "
            @open-thinking-details="$emit('open-thinking-details', $event)"
          />
          <div
            v-if="selectedRuntimeStep && !selectedExecutionId && selectedNodeSessionId"
            class="workflow-node-session-messages"
          >
            <ChatMessageItem
              v-for="message in displayNodeMessages"
              :key="resolveMessageViewKey(message)"
              :message-item="message"
              :all-messages="displayNodeMessages"
              :session-docs="selectedNodeSessionDocs"
              :user-id="userId"
              :render-markdown="renderMarkdown"
              :format-time="formatTime"
              :format-file-size="formatFileSize"
              :is-image-mime="isImageMime"
              :stop-execution="stopExecution"
              :fetch-execution-report="fetchExecutionReport"
              @open-thinking-details="$emit('open-thinking-details', $event)"
            />
          </div>
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
.workflow-node-session-modal {
  background: var(--noobot-mask-bg);
}

.workflow-node-session-drawer__header {
  background: var(--noobot-panel-head-bg);
  border-bottom: 1px solid var(--noobot-divider);
  margin-bottom: 0;
  padding: var(--noobot-space-lg) var(--noobot-space-xl);
  color: var(--noobot-text-strong);
}

.workflow-node-session-drawer__body {
  display: flex;
  flex-direction: column;
  background: var(--noobot-panel-bg);
  padding: var(--noobot-space-xs);
  box-sizing: border-box;
  overflow: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}

@media (max-width: 768px) {
  .workflow-node-session-drawer.el-drawer {
    height: 100svh;
    display: flex;
    flex-direction: column;
  }

  .workflow-node-session-drawer__header {
    flex: 0 0 auto;
  }

  .workflow-node-session-drawer__body {
    flex: 1 1 auto;
    min-height: 0;
    padding: 0;
  }
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
  font-weight: var(--noobot-font-weight-semibold);
}
.workflow-execution-directory__actions {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-sm);
  margin-bottom: var(--noobot-space-sm);
}
.workflow-execution-directory__stop {
  border: 1px solid var(--noobot-status-error);
  border-radius: var(--noobot-radius-xs);
  padding: var(--noobot-space-2xs) var(--noobot-space-md);
  color: var(--noobot-status-error);
  background: transparent;
  cursor: pointer;
}
.workflow-execution-directory__stop:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.workflow-execution-directory__stop-error {
  color: var(--noobot-status-error);
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
  font-weight: var(--noobot-font-weight-bold);
  line-height: var(--noobot-line-height-balanced);
  color: var(--noobot-text-main);
}

.workflow-runtime-panel-subtitle {
  margin-top: var(--noobot-space-2xs);
  font-size: var(--noobot-font-size-xs);
  line-height: var(--noobot-line-height-comfortable);
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
  color: var(--noobot-text-main);
  font-size: var(--noobot-font-size-xs);
  font-weight: var(--noobot-font-weight-semibold);
}

.workflow-runtime-state-count {
  flex: 0 0 auto;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-xs);
  font-weight: var(--noobot-font-weight-medium);
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
  color: var(--noobot-text-main);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--noobot-duration-fast) var(--noobot-ease-standard),
    background var(--noobot-duration-fast) var(--noobot-ease-standard);
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
  font-weight: var(--noobot-font-weight-semibold);
}

.workflow-runtime-step-status {
  flex: 0 0 auto;
  border-radius: var(--noobot-radius-pill);
  padding: var(--noobot-space-3xs) var(--noobot-space-xs);
  font-size: var(--noobot-font-size-xs);
  color: var(--noobot-text-secondary);
  background: color-mix(in srgb, var(--noobot-text-secondary) 12%, transparent);
}

.workflow-runtime-step-box.succeeded .workflow-runtime-step-status {
  color: color-mix(in srgb, var(--noobot-status-success) 78%, var(--noobot-text-main) 22%);
  background: color-mix(in srgb, var(--noobot-status-success) 14%, transparent 86%);
}

.workflow-runtime-step-box.failed .workflow-runtime-step-status,
.workflow-runtime-step-box.stopped .workflow-runtime-step-status {
  color: color-mix(in srgb, var(--noobot-status-error) 82%, var(--noobot-text-main) 18%);
  background: color-mix(in srgb, var(--noobot-status-error) 12%, transparent);
}

.workflow-runtime-step-box.running .workflow-runtime-step-status {
  color: color-mix(in srgb, var(--noobot-status-running) 82%, var(--noobot-text-main) 18%);
  background: color-mix(in srgb, var(--noobot-status-running) 12%, transparent);
}

.workflow-runtime-step-empty {
  margin-top: var(--noobot-space-xs);
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-xs);
}
</style>
