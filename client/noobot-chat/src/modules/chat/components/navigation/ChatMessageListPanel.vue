<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch } from "vue";
import ChatMessageItem from "../message/ChatMessageItem.vue";
import { useChatStore } from "../../stores/useChatStore.js";
import { selectTurnPresentations } from "../../runtime/engine/turnPresentation.js";
import {
  logWorkflowDiagnostics,
  summarizeWorkflowMessages,
} from "../../../debug/loggers/workflowDiagnosticsLogger.js";
import {
  logStateMachineDebug,
  summarizeStateMachineMessage,
} from "../../../debug/loggers/stateMachineLogger.js";
import { useLocale } from "../../../../shared/i18n/useLocale.js";
import {
  getMessageSessionId,
  getMessageTurnScopeId,
  getMessageRole,
  getMessageTurnScopeKey,
} from "../../model/messageIdentity.js";
import { sharedMessageRenderProps } from "../../model/messageItemProps.js";

defineEmits(["open-thinking-details"]);

const props = defineProps({
  loadingSessionDetail: { type: Boolean, default: false },
  activeSession: { type: Object, default: () => ({}) },
  shouldRenderMessageInChat: { type: Function, required: true },
  ...sharedMessageRenderProps,
  emptyLogoSrc: { type: String, default: "" },
});

const listRef = ref(null);
const { translate } = useLocale();
const chatStore = useChatStore();
const presentedMessages = computed(() => {
  return selectTurnPresentations({
    activeSession: props.activeSession,
    workflowRegistry: chatStore.workflowNodeStateRegistry,
    turnRuntimeRegistry: chatStore.turnRuntimeRegistry,
    subSessionMessageRegistry: chatStore.subSessionMessageRegistry,
  });
});
const presentationDiagnosticsSignature = computed(() =>
  [
    String(props.activeSession?.sessionId || ""),
    Array.isArray(props.activeSession?.messages) ? props.activeSession.messages.length : 0,
    presentedMessages.value.length,
    Number(chatStore.workflowNodeStateRegistry?.version || 0),
    Number(chatStore.subSessionMessageRegistryVersion || 0),
  ].join("|"),
);
watch(
  presentationDiagnosticsSignature,
  () => {
    logWorkflowDiagnostics("frontend.workflowRender.turnPresentationsSelected", () => ({
      sessionId: String(props.activeSession?.sessionId || ""),
      sourceMessageCount: Array.isArray(props.activeSession?.messages)
        ? props.activeSession.messages.length
        : 0,
      presentationMessageCount: presentedMessages.value.length,
      workflowPresentations: summarizeWorkflowMessages(presentedMessages.value),
    }));
  },
  { flush: "post" },
);
const messageItemSharedProps = computed(() => ({
  allMessages: presentedMessages.value,
  sessionDocs: props.activeSession?.sessionDocs || [],
  userId: props.userId,
  renderMarkdown: props.renderMarkdown,
  formatTime: props.formatTime,
  formatFileSize: props.formatFileSize,
  isImageMime: props.isImageMime,
  sending: props.sending,
  deleteMonotonicMessage: props.deleteMonotonicMessage,
  resendMonotonicMessage: props.resendMonotonicMessage,
  stopExecution: props.stopExecution,
}));
const currentAssistantMessage = computed(() => {
  for (let index = presentedMessages.value.length - 1; index >= 0; index -= 1) {
    const messageItem = presentedMessages.value[index];
    if (getMessageRole(messageItem) === "assistant") return messageItem;
  }
  return null;
});

function isCurrentTurnMessage(messageItem = {}) {
  const current = currentAssistantMessage.value;
  if (!current || getMessageRole(messageItem) !== "assistant") return false;
  const currentTurnKey = getMessageTurnScopeKey(current);
  const candidateTurnKey = getMessageTurnScopeKey(messageItem);
  return currentTurnKey && candidateTurnKey
    ? currentTurnKey === candidateTurnKey
    : current === messageItem;
}

function getWrapRef() {
  return listRef.value?.wrapRef || null;
}

function getMessageRenderKey(messageItem = {}, messageIndex = 0) {
  const stableIndex = Number.isFinite(Number(messageIndex)) ? Number(messageIndex) : 0;
  const role = getMessageRole(messageItem);
  const turnScopeId = getMessageTurnScopeId(messageItem);
  const sessionId = getMessageSessionId(messageItem);
  const turnScopeKey = turnScopeId ? `${sessionId || "active"}::${turnScopeId}` : "";
  const taskId = String(messageItem?.taskId || "").trim();
  const toolCallId = String(messageItem?.tool_call_id || "").trim();
  const stablePrimaryId = turnScopeKey || taskId || toolCallId || String(stableIndex);
  return [role, stablePrimaryId, stableIndex]
    .map((item) => String(item ?? "").replaceAll("|", "/"))
    .join("|");
}

const renderedMessages = computed(() =>
  presentedMessages.value
    .map((messageItem, sourceIndex) => ({
      messageItem,
      sourceIndex,
      renderKey: getMessageRenderKey(messageItem, sourceIndex),
    }))
    .filter(({ messageItem }) => props.shouldRenderMessageInChat(messageItem)),
);
const renderDiagnosticsSignature = computed(() =>
  JSON.stringify(
    renderedMessages.value.map((entry) => ({
      ...summarizeStateMachineMessage(entry.messageItem),
      sourceIndex: entry.sourceIndex,
      renderKey: entry.renderKey,
    })),
  ),
);
watch(
  renderDiagnosticsSignature,
  (signature) => {
    logStateMachineDebug("stateMachine.presentation.renderList.committed", () => ({
      sessionId: String(props.activeSession?.sessionId || ""),
      sourceMessageCount: Array.isArray(props.activeSession?.messages)
        ? props.activeSession.messages.length
        : 0,
      presentationMessageCount: presentedMessages.value.length,
      renderedMessageCount: renderedMessages.value.length,
      messages: JSON.parse(signature),
    }));
  },
  { immediate: true, flush: "post" },
);

function getMessageAnchorId(messageItem = {}, messageIndex = 0) {
  return `chat-message-${getMessageRenderKey(messageItem, messageIndex).replace(
    /[^a-zA-Z0-9_-]/g,
    "-",
  )}`;
}

function scrollToMessageAnchor(anchorId = "") {
  const wrapRef = getWrapRef();
  const id = String(anchorId || "").trim();
  if (!wrapRef || !id) return false;
  const target = wrapRef.querySelector?.(`#${CSS.escape(id)}`);
  if (!target) return false;
  const offset = 16;
  const nextTop = target.offsetTop - offset;
  wrapRef.scrollTo?.({ top: Math.max(0, nextTop), behavior: "smooth" });
  return true;
}

defineExpose({
  getWrapRef,
  getMessageAnchorId,
  scrollToMessageAnchor,
});
</script>

<template>
  <div class="message-container">
    <el-scrollbar ref="listRef" class="msg-list">
      <div class="msg-list-inner">
        <el-skeleton
          v-if="loadingSessionDetail && !presentedMessages.length"
          :rows="6"
          animated
          class="skeleton-loading noobot-surface-card"
        />

        <div v-if="!presentedMessages.length && !loadingSessionDetail" class="empty-state">
          <div class="empty-icon">
            <img :src="emptyLogoSrc" alt="Noobot Logo" class="empty-logo" />
          </div>
          <p>{{ translate("common.emptyChatHint") }}</p>
        </div>

        <template
          v-for="{ messageItem, sourceIndex, renderKey } in renderedMessages"
          :key="renderKey"
        >
          <div
            :id="getMessageAnchorId(messageItem, sourceIndex)"
            class="chat-message-anchor"
            :data-chat-message-anchor="getMessageAnchorId(messageItem, sourceIndex)"
          >
            <ChatMessageItem
              v-bind="messageItemSharedProps"
              :message-item="messageItem"
              :current-turn="isCurrentTurnMessage(messageItem)"
              @open-thinking-details="$emit('open-thinking-details', $event)"
            />
          </div>
        </template>
      </div>
    </el-scrollbar>
  </div>
</template>

<style scoped>
.message-container {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.msg-list {
  height: 100%;
}

.msg-list-inner {
  padding: 24px max(24px, calc(50% - 400px));
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.skeleton-loading {
  padding: 16px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 40vh;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-lg);
}

.empty-icon {
  margin-bottom: 16px;
  opacity: 0.8;
}

.empty-logo {
  width: 52px;
  height: 52px;
  display: block;
}

@media (max-width: 768px) {
  .msg-list-inner {
    padding: 14px max(12px, env(safe-area-inset-left)) 14px max(12px, env(safe-area-inset-right));
    gap: 8px;
  }
}
</style>
