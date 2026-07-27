<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import ChatMessageItem from "../modules/message/ChatMessageItem.vue";
import { useChatStore } from "../shared/stores/useChatStore.js";
import { selectTurnPresentations } from "../composables/chat/chatEngine/turnPresentation.js";
import { logWorkflowDiagnostics, summarizeWorkflowMessages } from "../composables/chat/debug/workflowDiagnosticsLogger.js";
import { useLocale } from "../shared/i18n/useLocale.js";
import {
  getMessageSessionId,
  getMessageTurnScopeId,
  getMessageRole,
} from "../composables/infra/messageIdentity.js";

defineEmits(["open-thinking-details"]);

const props = defineProps({
  loadingSessionDetail: { type: Boolean, default: false },
  activeSession: { type: Object, default: () => ({}) },
  shouldRenderMessageInChat: { type: Function, required: true },
  userId: { type: String, default: "" },
  renderMarkdown: { type: Function, required: true },
  formatTime: { type: Function, required: true },
  formatFileSize: { type: Function, required: true },
  isImageMime: { type: Function, required: true },
  sending: { type: Boolean, default: false },
  deleteMonotonicMessage: { type: Function, default: null },
  resendMonotonicMessage: { type: Function, default: null },
  stopExecution: { type: Function, default: null },
  emptyLogoSrc: { type: String, default: "" },
});

const listRef = ref(null);
const { translate } = useLocale();
const chatStore = useChatStore();
const presentedMessages = computed(() => {
  const messages = selectTurnPresentations({
    activeSession: props.activeSession,
    workflowRegistry: chatStore.workflowNodeStateRegistry,
    turnRuntimeRegistry: chatStore.turnRuntimeRegistry,
  });
  logWorkflowDiagnostics("frontend.workflowRender.turnPresentationsSelected", {
    sessionId: String(props.activeSession?.backendSessionId || props.activeSession?.id || ""),
    sourceMessageCount: Array.isArray(props.activeSession?.messages) ? props.activeSession.messages.length : 0,
    presentationMessageCount: messages.length,
    workflowPresentations: summarizeWorkflowMessages(messages),
  });
  return messages;
});
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

function getMessageAnchorId(messageItem = {}, messageIndex = 0) {
  return `chat-message-${getMessageRenderKey(messageItem, messageIndex)
    .replace(/[^a-zA-Z0-9_-]/g, "-")}`;
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

        <div
          v-if="!presentedMessages.length && !loadingSessionDetail"
          class="empty-state"
        >
          <div class="empty-icon">
            <img :src="emptyLogoSrc" alt="Noobot Logo" class="empty-logo" />
          </div>
          <p>{{ translate("common.emptyChatHint") }}</p>
        </div>

        <template
          v-for="(messageItem, messageIndex) in presentedMessages"
          :key="getMessageRenderKey(messageItem, messageIndex)"
        >
          <div
            v-if="shouldRenderMessageInChat(messageItem)"
            :id="getMessageAnchorId(messageItem, messageIndex)"
            class="chat-message-anchor"
            :data-chat-message-anchor="getMessageAnchorId(messageItem, messageIndex)"
          >
            <ChatMessageItem
              v-bind="messageItemSharedProps"
              :message-item="messageItem"
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
