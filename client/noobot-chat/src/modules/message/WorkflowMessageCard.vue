<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { getWorkflowSessionDetailApi } from "../../services/api/chatApi";
import { WorkflowCanvasGraph } from "./workflow-graph";

const props = defineProps({
  messageItem: { type: Object, default: () => ({}) },
  userId: { type: String, default: "" },
  authFetch: { type: Function, default: null },
  renderMarkdown: { type: Function, required: true },
  formatTime: { type: Function, required: true },
});

const viewerVisible = ref(false);
const viewerLoading = ref(false);
const viewerError = ref("");
const selectedNode = ref(null);
const selectedNodeMessages = ref([]);
const selectedNodeSessionId = ref("");
const selectedGraphDialogId = ref("");
const activeMessageTab = ref("primary");
const semanticPreviewExpanded = ref(false);

const workflowMeta = computed(() =>
  props.messageItem?.workflowMeta &&
  typeof props.messageItem.workflowMeta === "object" &&
  !Array.isArray(props.messageItem.workflowMeta)
    ? props.messageItem.workflowMeta
    : {},
);

const workflowPayload = computed(() =>
  workflowMeta.value?.payload &&
  typeof workflowMeta.value.payload === "object" &&
  !Array.isArray(workflowMeta.value.payload)
    ? workflowMeta.value.payload
    : {},
);

const nodeSessions = computed(() => {
  const fromPayload = Array.isArray(workflowPayload.value?.nodeSessions)
    ? workflowPayload.value.nodeSessions
    : [];
  return fromPayload;
});

const semanticNodeMap = computed(() => {
  const map = new Map();
  const nodes = Array.isArray(workflowPayload.value?.semantic?.nodes)
    ? workflowPayload.value.semantic.nodes
    : [];
  for (const nodeItem of nodes) {
    const id = String(nodeItem?.id || "").trim();
    const name = String(nodeItem?.name || "").trim();
    if (id) map.set(`id:${id}`, nodeItem);
    if (name) map.set(`name:${name}`, nodeItem);
  }
  return map;
});

const executionMeta = computed(() =>
  workflowPayload.value?.execution &&
  typeof workflowPayload.value.execution === "object" &&
  !Array.isArray(workflowPayload.value.execution)
    ? workflowPayload.value.execution
    : {},
);

const nodeRunByDialogId = computed(() => {
  const map = new Map();
  const runs = Array.isArray(executionMeta.value?.nodeAgentRuns)
    ? executionMeta.value.nodeAgentRuns
    : [];
  for (const runItem of runs) {
    const dialogId = String(runItem?.nodeDialogId || "").trim();
    if (!dialogId) continue;
    map.set(dialogId, runItem);
  }
  return map;
});

function resolveNodeStatus(nodeItem = {}) {
  const explicit = String(nodeItem?.status || "").trim().toLowerCase();
  if (explicit) return explicit;
  const completed = executionMeta.value?.completed === true;
  if (completed) return "success";
  const workflowFailed = String(workflowPayload.value?.status || "").trim().toLowerCase() === "failed";
  const dialogId = String(nodeItem?.dialogId || "").trim();
  const hasRunRecord = dialogId && nodeRunByDialogId.value.has(dialogId);
  if (hasRunRecord) return "success";
  if (workflowFailed) return "failed";
  return "pending";
}

const flowNodes = computed(() =>
  nodeSessions.value
    .map((item = {}, index) => {
      const semanticNode =
        semanticNodeMap.value.get(`id:${String(item?.nodeId || "").trim()}`) ||
        semanticNodeMap.value.get(`name:${String(item?.nodeName || "").trim()}`) ||
        null;
      return {
        ...item,
        type: String(item?.type || semanticNode?.type || "").trim(),
        stateType: Number.isFinite(Number(item?.stateType))
          ? Number(item.stateType)
          : Number.isFinite(Number(semanticNode?.stateType))
            ? Number(semanticNode.stateType)
            : undefined,
        status: resolveNodeStatus(item),
        _order: Number.isFinite(Number(item?.transition))
          ? Number(item.transition)
          : index + 1,
      };
    })
    .sort((left, right) => Number(left?._order || 0) - Number(right?._order || 0)),
);

const semanticPreview = computed(
  () =>
    String(
      workflowMeta.value?.semanticTextPreview ||
        workflowPayload.value?.interaction?.semanticTextPreview ||
        props.messageItem?.content ||
        "",
    ).trim(),
);

const semanticPreviewLineCount = computed(() =>
  String(semanticPreview.value || "").split(/\r?\n/).length,
);

const semanticPreviewCollapsible = computed(
  () => semanticPreviewLineCount.value > 8 || String(semanticPreview.value || "").length > 900,
);

function isInjectedMessage(messageItem = {}) {
  if (messageItem?.injectedMessage === true) return true;
  const injectedBy = String(messageItem?.injectedBy || "").trim().toLowerCase();
  if (injectedBy) return true;
  return false;
}

function isToolRelatedMessage(messageItem = {}) {
  const role = String(messageItem?.role || "").trim().toLowerCase();
  const type = String(messageItem?.type || "").trim().toLowerCase();
  const toolCalls = Array.isArray(messageItem?.tool_calls) ? messageItem.tool_calls : [];
  if (toolCalls.length) return true;
  if (role === "tool") return true;
  if (type === "tool_call" || type === "tool_result") return true;
  return false;
}

function isPrimaryCandidateMessage(messageItem = {}) {
  const role = String(messageItem?.role || "").trim().toLowerCase();
  return !isInjectedMessage(messageItem) && !isToolRelatedMessage(messageItem) && (role === "user" || role === "assistant");
}

const primaryNodeMessages = computed(() => {
  const source = Array.isArray(selectedNodeMessages.value) ? selectedNodeMessages.value : [];
  const firstUser = source.find((messageItem = {}) => {
    if (!isPrimaryCandidateMessage(messageItem)) return false;
    return String(messageItem?.role || "").trim().toLowerCase() === "user";
  }) || null;
  let lastAssistant = null;
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const messageItem = source[index] || {};
    if (!isPrimaryCandidateMessage(messageItem)) continue;
    if (String(messageItem?.role || "").trim().toLowerCase() !== "assistant") continue;
    lastAssistant = messageItem;
    break;
  }
  const result = [];
  if (firstUser) result.push(firstUser);
  if (lastAssistant && lastAssistant !== firstUser) result.push(lastAssistant);
  return result;
});

const toolNodeMessages = computed(() =>
  (Array.isArray(selectedNodeMessages.value) ? selectedNodeMessages.value : []).filter(
    (messageItem = {}) => isToolRelatedMessage(messageItem) && !isInjectedMessage(messageItem),
  ),
);

const injectedNodeMessages = computed(() =>
  (Array.isArray(selectedNodeMessages.value) ? selectedNodeMessages.value : []).filter(
    (messageItem = {}) => isInjectedMessage(messageItem),
  ),
);

function stringifyJson(value = null) {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function buildToolCallsPreview(messageItem = {}) {
  const toolCalls = Array.isArray(messageItem?.tool_calls) ? messageItem.tool_calls : [];
  if (!toolCalls.length) return "";
  return toolCalls
    .map((toolCall = {}, index) => {
      const name = String(toolCall?.function?.name || toolCall?.name || `tool_${index + 1}`).trim();
      const args = stringifyJson(toolCall?.function?.arguments ?? toolCall?.args ?? "");
      return [name, args].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

function renderableMessageContent(messageItem = {}) {
  const direct = String(messageItem?.content || "").trim();
  if (direct) return direct;
  if (isToolRelatedMessage(messageItem)) {
    const toolCallsPreview = buildToolCallsPreview(messageItem);
    if (toolCallsPreview) return `\`\`\`json\n${toolCallsPreview}\n\`\`\``;
  }
  return "（空）";
}

async function openNodeSession(nodeItem = {}) {
  selectedGraphDialogId.value = String(nodeItem?.dialogId || "").trim();
  const dialogId = String(nodeItem?.dialogId || "").trim();
  const rootSessionId = String(
    nodeItem?.rootSessionId ||
      workflowPayload.value?.planningDialog?.sessionId ||
      workflowPayload.value?.runMeta?.sessionId ||
      "",
  ).trim();
  if (!props.userId || !rootSessionId || !dialogId) {
    ElMessage.warning("工作流节点会话标识缺失");
    return;
  }
  viewerVisible.value = true;
  viewerLoading.value = true;
  viewerError.value = "";
  selectedNode.value = nodeItem;
  selectedNodeMessages.value = [];
  selectedNodeSessionId.value = "";
  activeMessageTab.value = "primary";
  try {
    const response = await getWorkflowSessionDetailApi(
      {
        userId: props.userId,
        sessionId: rootSessionId,
        dialogId,
      },
      { fetcher: props.authFetch || fetch },
    );
    const payload = await response.json();
    if (!payload?.ok) {
      throw new Error(String(payload?.error || "读取节点会话失败"));
    }
    const session = payload?.workflowSession?.session || {};
    selectedNodeSessionId.value = String(session?.sessionId || "").trim();
    selectedNodeMessages.value = Array.isArray(session?.messages) ? session.messages : [];
  } catch (error) {
    viewerError.value = String(error?.message || error || "读取节点会话失败");
  } finally {
    viewerLoading.value = false;
  }
}

function handleSelectedDialogUpdate(dialogId = "") {
  selectedGraphDialogId.value = String(dialogId || "").trim();
}
</script>

<template>
  <div class="workflow-card">
    <div class="workflow-card-header">
      <div>
        <div class="workflow-card-title">工作流规划模型输出</div>
        <div class="workflow-card-subtitle">
          {{ semanticPreviewLineCount }} 行
        </div>
      </div>
      <button
        v-if="semanticPreviewCollapsible"
        type="button"
        class="workflow-preview-toggle"
        @click="semanticPreviewExpanded = !semanticPreviewExpanded"
      >
        {{ semanticPreviewExpanded ? "收起" : "展开" }}
      </button>
    </div>
    <div
      class="workflow-card-preview-shell"
      :class="{
        'is-collapsed': semanticPreviewCollapsible && !semanticPreviewExpanded,
      }"
    >
      <pre class="workflow-card-preview">{{ semanticPreview || "（空）" }}</pre>
    </div>

    <div v-if="flowNodes.length" class="workflow-node-list">
      <div class="workflow-node-title">工作流节点（组件化流程）</div>
      <WorkflowCanvasGraph
        :nodes="flowNodes"
        :selected-dialog-id="selectedGraphDialogId"
        @update:selected-dialog-id="handleSelectedDialogUpdate"
        @node-click="openNodeSession"
      />
    </div>
  </div>

  <el-drawer
    v-model="viewerVisible"
    direction="rtl"
    size="72%"
    destroy-on-close
    :append-to-body="true"
    :title="`节点会话 ${selectedNodeSessionId || ''}`"
    class="workflow-node-session-drawer"
  >
    <div v-loading="viewerLoading">
      <el-alert
        v-if="viewerError"
        :title="viewerError"
        type="error"
        :closable="false"
        show-icon
      />
      <template v-else>
        <el-tabs v-model="activeMessageTab" class="workflow-node-tabs">
          <el-tab-pane
            :label="`主消息 (${primaryNodeMessages.length})`"
            name="primary"
          >
            <div
              v-for="(messageItem, messageIndex) in primaryNodeMessages"
              :key="`primary-${String(messageItem?.ts || '')}-${messageIndex}`"
              class="workflow-node-message"
            >
              <div class="workflow-node-message-header">
                <span>{{ messageItem?.role || "assistant" }}</span>
                <span>{{ formatTime(messageItem?.ts || "") }}</span>
              </div>
              <div class="workflow-node-message-content" v-html="renderMarkdown(renderableMessageContent(messageItem))" />
            </div>
            <div v-if="!primaryNodeMessages.length" class="workflow-node-empty">
              暂无主消息
            </div>
          </el-tab-pane>

          <el-tab-pane
            :label="`工具请求/调用 (${toolNodeMessages.length})`"
            name="tool"
          >
            <div
              v-for="(messageItem, messageIndex) in toolNodeMessages"
              :key="`tool-${String(messageItem?.ts || '')}-${messageIndex}`"
              class="workflow-node-message"
            >
              <div class="workflow-node-message-header">
                <span>{{ messageItem?.role || "assistant" }}</span>
                <span>{{ formatTime(messageItem?.ts || "") }}</span>
              </div>
              <div class="workflow-node-message-content" v-html="renderMarkdown(renderableMessageContent(messageItem))" />
            </div>
            <div v-if="!toolNodeMessages.length" class="workflow-node-empty">
              暂无工具请求/调用消息
            </div>
          </el-tab-pane>

          <el-tab-pane
            :label="`注入消息 (${injectedNodeMessages.length})`"
            name="injected"
          >
            <div
              v-for="(messageItem, messageIndex) in injectedNodeMessages"
              :key="`injected-${String(messageItem?.ts || '')}-${messageIndex}`"
              class="workflow-node-message"
            >
              <div class="workflow-node-message-header">
                <span>{{ messageItem?.role || "assistant" }}</span>
                <span>{{ formatTime(messageItem?.ts || "") }}</span>
              </div>
              <div class="workflow-node-message-content" v-html="renderMarkdown(renderableMessageContent(messageItem))" />
            </div>
            <div v-if="!injectedNodeMessages.length" class="workflow-node-empty">
              暂无注入消息
            </div>
          </el-tab-pane>
        </el-tabs>
        <div v-if="!selectedNodeMessages.length && !viewerLoading" class="workflow-node-empty">
          暂无节点会话内容
        </div>
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.workflow-card {
  border: 1px solid var(--noobot-msg-assistant-border);
  border-radius: var(--noobot-radius-md);
  padding: 12px;
  margin-bottom: 10px;
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 96%, #6d4aff 4%);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
}

.workflow-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
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
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--noobot-msg-assistant-border) 76%, #6d4aff 24%);
  border-radius: 7px;
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 94%, #6d4aff 6%);
  color: var(--noobot-text-primary);
  font-size: 12px;
  cursor: pointer;
}

.workflow-preview-toggle:hover {
  border-color: color-mix(in srgb, var(--noobot-msg-assistant-border) 46%, #6d4aff 54%);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 90%, #6d4aff 10%);
}

.workflow-card-preview-shell {
  position: relative;
  border: 1px solid color-mix(in srgb, var(--noobot-msg-assistant-border) 86%, transparent 14%);
  border-radius: var(--noobot-radius-sm);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 97%, #000 3%);
  overflow: hidden;
}

.workflow-card-preview-shell.is-collapsed {
  max-height: 188px;
}

.workflow-card-preview-shell.is-collapsed::after {
  content: "";
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 44px;
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--noobot-msg-assistant-bg) 0%, transparent 100%),
    color-mix(in srgb, var(--noobot-msg-assistant-bg) 98%, #000 2%)
  );
  pointer-events: none;
}

.workflow-card-preview {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: 10px 12px;
  color: var(--noobot-text-primary);
  font-size: 12px;
  line-height: 1.55;
  background: transparent;
  overflow: visible;
}

.workflow-node-list {
  margin-top: 10px;
}

.workflow-node-title {
  font-size: 13px;
  margin-bottom: 6px;
  color: var(--noobot-text-secondary);
}

.workflow-node-tabs {
  width: 100%;
}

.workflow-node-message {
  border: 1px solid var(--noobot-msg-assistant-border);
  border-radius: var(--noobot-radius-md);
  padding: 10px;
  margin-bottom: 10px;
  background: var(--noobot-msg-assistant-bg);
}

.workflow-node-message-header {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--noobot-text-secondary);
  margin-bottom: 6px;
}

.workflow-node-empty {
  color: var(--noobot-text-secondary);
  font-size: 13px;
}

:deep(.workflow-node-session-drawer .el-drawer__body) {
  padding-top: 10px;
  background: var(--noobot-msg-assistant-bg);
}

:deep(.workflow-node-session-drawer .el-drawer) {
  background: var(--noobot-msg-assistant-bg) !important;
  border-left: 1px solid var(--noobot-msg-assistant-border) !important;
}

:deep(.workflow-node-session-drawer .el-drawer__header) {
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 94%, #e5e7eb 6%) !important;
  border-bottom: 1px solid var(--noobot-msg-assistant-border) !important;
}

:deep(.workflow-node-tabs .el-tabs__content) {
  padding-top: 4px;
  background: var(--noobot-msg-assistant-bg);
}
</style>
