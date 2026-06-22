<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch } from "vue";
import ChatMessageItem from "../modules/message/ChatMessageItem.vue";
import { useLocale } from "../shared/i18n/useLocale";
import { resolveSessionRunStateForMessage } from "../composables/chat/sessionRunStateMachine";

defineEmits(["open-thinking-details"]);

const props = defineProps({
  loadingSessionDetail: { type: Boolean, default: false },
  activeSession: { type: Object, default: () => ({}) },
  shouldRenderMessageInChat: { type: Function, required: true },
  userId: { type: String, default: "" },
  authFetch: { type: Function, default: null },
  renderMarkdown: { type: Function, required: true },
  formatTime: { type: Function, required: true },
  formatFileSize: { type: Function, required: true },
  isImageMime: { type: Function, required: true },
  sending: { type: Boolean, default: false },
  deleteMonotonicMessage: { type: Function, default: null },
  resendMonotonicMessage: { type: Function, default: null },
  runStateSnapshot: { type: Object, default: () => ({}) },
  emptyLogoSrc: { type: String, default: "" },
});

const listRef = ref(null);
const { translate } = useLocale();
const messageItemSharedProps = computed(() => ({
  allMessages: props.activeSession?.rawMessages || props.activeSession?.messages || [],
  sessionDocs: props.activeSession?.sessionDocs || [],
  userId: props.userId,
  authFetch: props.authFetch,
  renderMarkdown: props.renderMarkdown,
  formatTime: props.formatTime,
  formatFileSize: props.formatFileSize,
  isImageMime: props.isImageMime,
  sending: props.sending,
  deleteMonotonicMessage: props.deleteMonotonicMessage,
  resendMonotonicMessage: props.resendMonotonicMessage,
}));

const pendingAssistantRenderKeys = new Map();

function setScrollTop(top = 0) {
  listRef.value?.setScrollTop?.(Number(top || 0));
}

function getWrapRef() {
  return listRef.value?.wrapRef || null;
}

function getMessageRenderKey(messageItem = {}, messageIndex = 0) {
  const stableIndex = Number.isFinite(Number(messageIndex)) ? Number(messageIndex) : 0;
  const role = String(messageItem?.role || "").trim();
  const dialogProcessId = String(messageItem?.dialogProcessId || "").trim();
  const taskId = String(messageItem?.taskId || "").trim();
  const toolCallId = String(messageItem?.tool_call_id || "").trim();
  // Do not include content or ts in the key: both can change when backend
  // snapshots/replay patch an existing message. If the key changes Vue remounts
  // the message component, which looks like the AI message flashes and can also
  // make the previous message blink when a DONE snapshot is folded back.
  let stablePrimaryId = dialogProcessId || taskId || toolCallId || String(stableIndex);
  if (role === "assistant" && !taskId && !toolCallId) {
    const pendingKey = [role, stableIndex, stableIndex]
      .map((item) => String(item ?? "").replaceAll("|", "/"))
      .join("|");
    if (!dialogProcessId) {
      pendingAssistantRenderKeys.set(stableIndex, pendingKey);
      stablePrimaryId = String(stableIndex);
    } else {
      const sameSlotPlaceholderKey = pendingAssistantRenderKeys.get(stableIndex);
      if (sameSlotPlaceholderKey) return sameSlotPlaceholderKey;
    }
  }
  return [role, stablePrimaryId, stableIndex]
    .map((item) => String(item ?? "").replaceAll("|", "/"))
    .join("|");
}

function normalizeStateTime(stateItem = {}) {
  const rawCreatedAtMs = Number(stateItem?.createdAtMs || 0);
  const rawUpdatedAtMs = Number(
    stateItem?.updatedAtMs ||
      stateItem?.timestamp ||
      (typeof stateItem?.updatedAt === "number" ? stateItem.updatedAt : 0) ||
      rawCreatedAtMs ||
      0,
  );
  const createdAtMs = rawCreatedAtMs;
  const updatedAtMs = rawUpdatedAtMs;
  const createdAt = String(
    stateItem?.createdAt ||
      stateItem?.createdAtIso ||
      (createdAtMs > 0 ? new Date(createdAtMs).toISOString() : ""),
  ).trim();
  const updatedAt = String(
    (typeof stateItem?.updatedAt === "string" ? stateItem.updatedAt : "") ||
      stateItem?.updatedAtIso ||
      (updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : ""),
  ).trim();
  return { createdAtMs, updatedAtMs, createdAt, updatedAt };
}

function getLatestInFlightConversationStateForMessage(messageItem = {}) {
  return resolveSessionRunStateForMessage({
    stateSnapshot: props.runStateSnapshot,
    messageItem,
    activeSession: props.activeSession,
  });
}

function applyConversationStateRuntimeToMessage(messageItem = {}) {
  const stateItem = getLatestInFlightConversationStateForMessage(messageItem);
  if (!stateItem) return messageItem;
  const timing = normalizeStateTime(stateItem);
  const channelState =
    messageItem.channelState &&
    typeof messageItem.channelState === "object" &&
    !Array.isArray(messageItem.channelState)
      ? messageItem.channelState
      : {};
  messageItem.channelState = {
    ...channelState,
    state: String(stateItem?.state || "").trim(),
    sessionId: String(stateItem?.sessionId || "").trim(),
    dialogProcessId: String(stateItem?.dialogProcessId || "").trim(),
    clientTurnId: String(stateItem?.clientTurnId || "").trim(),
    sourceEvent: String(stateItem?.sourceEvent || "").trim(),
    seq: Number(stateItem?.seq || 0),
    createdAtMs: timing.createdAtMs || Number(channelState?.createdAtMs || 0),
    updatedAtMs: timing.updatedAtMs || Number(channelState?.updatedAtMs || 0),
    createdAt: timing.createdAt || String(channelState?.createdAt || "").trim(),
    updatedAt: timing.updatedAt || String(channelState?.updatedAt || "").trim(),
  };
  const startedAt = messageItem.channelState.createdAt ||
    (messageItem.channelState.createdAtMs > 0 ? new Date(messageItem.channelState.createdAtMs).toISOString() : "");
  if (startedAt && !String(messageItem?.thinkingStartedAt || messageItem?.thinking_started_at || "").trim()) {
    messageItem.thinkingStartedAt = startedAt;
    messageItem.thinking_started_at = startedAt;
  }
  messageItem.pending = true;
  return messageItem;
}

function applyConversationStateRuntimeToMessages() {
  const messageList = Array.isArray(props.activeSession?.messages)
    ? props.activeSession.messages
    : [];
  messageList.forEach((messageItem) => applyConversationStateRuntimeToMessage(messageItem));
}

watch(
  () => [
    props.activeSession?.id,
    props.activeSession?.backendSessionId,
    Array.isArray(props.activeSession?.messages) ? props.activeSession.messages.length : 0,
    props.runStateSnapshot,
  ],
  () => applyConversationStateRuntimeToMessages(),
  { deep: true, immediate: true },
);

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
  setScrollTop,
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
          v-if="loadingSessionDetail && !activeSession?.messages?.length"
          :rows="6"
          animated
          class="skeleton-loading noobot-flat-card"
        />

        <div
          v-if="!activeSession?.messages?.length && !loadingSessionDetail"
          class="empty-state"
        >
          <div class="empty-icon">
            <img :src="emptyLogoSrc" alt="Noobot Logo" class="empty-logo" />
          </div>
          <p>{{ translate("common.emptyChatHint") }}</p>
        </div>

        <template
          v-for="(messageItem, messageIndex) in activeSession?.messages || []"
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
  background: var(--noobot-panel-bg);
  padding: 20px;
  border-radius: var(--noobot-radius-md);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 40vh;
  color: var(--noobot-text-secondary);
  font-size: 15px;
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
    gap: 16px;
  }
}
</style>
