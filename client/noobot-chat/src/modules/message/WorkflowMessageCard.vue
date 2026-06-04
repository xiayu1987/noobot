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

const flowNodes = computed(() =>
  nodeSessions.value
    .map((item = {}, index) => ({
      ...item,
      _order: Number.isFinite(Number(item?.transition))
        ? Number(item.transition)
        : index + 1,
    }))
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
    <div class="workflow-card-title">工作流规划模型输出</div>
    <pre class="workflow-card-preview">{{ semanticPreview || "（空）" }}</pre>

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
        <div
          v-for="(messageItem, messageIndex) in selectedNodeMessages"
          :key="`${String(messageItem?.ts || '')}-${messageIndex}`"
          class="workflow-node-message"
        >
          <div class="workflow-node-message-header">
            <span>{{ messageItem?.role || "assistant" }}</span>
            <span>{{ formatTime(messageItem?.ts || "") }}</span>
          </div>
          <div class="workflow-node-message-content" v-html="renderMarkdown(messageItem?.content || '')" />
        </div>
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
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 92%, #6d4aff 8%);
}

.workflow-card-title {
  font-weight: 600;
  margin-bottom: 8px;
}

.workflow-card-preview {
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  margin: 0;
  padding: 10px;
  border-radius: var(--noobot-radius-sm);
  background: color-mix(in srgb, var(--noobot-msg-assistant-bg) 94%, #000 6%);
}

.workflow-node-list {
  margin-top: 10px;
}

.workflow-node-title {
  font-size: 13px;
  margin-bottom: 6px;
  color: var(--noobot-text-secondary);
}

.workflow-node-message {
  border: 1px solid var(--noobot-msg-assistant-border);
  border-radius: var(--noobot-radius-md);
  padding: 10px;
  margin-bottom: 10px;
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
}
</style>
