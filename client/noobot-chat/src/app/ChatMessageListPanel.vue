<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch, watchEffect } from "vue";
import ChatMessageItem from "../modules/message/ChatMessageItem.vue";
import { useLocale } from "../shared/i18n/useLocale";
import {
  SESSION_RUN_MESSAGE_RUNTIME_ACTION,
  SESSION_RUN_MESSAGE_RUNTIME_MARK,
  resolveSessionRunMessageRuntimePatch,
} from "../composables/chat/sessionRunStateMachine";
import {
  getMessageSessionId,
  getMessageTurnScopeId,
  getMessageRole,
} from "../composables/infra/messageIdentity";

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
  emptyLogoSrc: { type: String, default: "" },
});

const listRef = ref(null);
const { translate } = useLocale();
const messageItemSharedProps = computed(() => ({
  allMessages: props.activeSession?.messages || [],
  sessionDocs: props.activeSession?.sessionDocs || [],
  turnTimingsByTurnScopeId: props.activeSession?.turnTimingsByTurnScopeId || {},
  turnStatuses: props.activeSession?.turnStatuses || [],
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
  // Do not include content or ts in the key: both can change when backend
  // snapshots/replay patch an existing message. If the key changes Vue remounts
  // the message component, which looks like the AI message flashes and can also
  // make the previous message blink when a DONE snapshot is folded back.
  const stablePrimaryId = turnScopeKey || taskId || toolCallId || String(stableIndex);
  return [role, stablePrimaryId, stableIndex]
    .map((item) => String(item ?? "").replaceAll("|", "/"))
    .join("|");
}

function applyMessageRuntimePatch(messageItem = {}, patch = {}) {
  if (!messageItem || !patch || typeof patch !== "object") return;
  if (patch.clearRuntimeMark) {
    delete messageItem[SESSION_RUN_MESSAGE_RUNTIME_MARK];
  }
  if (patch.runtimeMark !== undefined) {
    messageItem[SESSION_RUN_MESSAGE_RUNTIME_MARK] = String(patch.runtimeMark || "");
  }
  const channelState =
    messageItem.channelState &&
    typeof messageItem.channelState === "object" &&
    !Array.isArray(messageItem.channelState)
      ? messageItem.channelState
      : {};
  if (patch.channelState && typeof patch.channelState === "object" && !Array.isArray(patch.channelState)) {
    messageItem.channelState = {
      ...channelState,
      ...patch.channelState,
    };
  }
  if (Object.prototype.hasOwnProperty.call(patch, "pending")) {
    messageItem.pending = patch.pending === true;
  }
  const turnScopeId = getMessageTurnScopeId(messageItem);
  if (turnScopeId && (patch.thinkingStartedAt || patch.thinkingFinishedAt)) {
    const existingTiming = props.activeSession?.turnTimingsByTurnScopeId?.[turnScopeId] || {};
    props.activeSession.turnTimingsByTurnScopeId = {
      ...(props.activeSession.turnTimingsByTurnScopeId || {}),
      [turnScopeId]: {
        ...existingTiming,
        ...(patch.thinkingStartedAt && !existingTiming.thinkingStartedAt
          ? { thinkingStartedAt: patch.thinkingStartedAt }
          : {}),
        ...(patch.thinkingFinishedAt && !existingTiming.thinkingFinishedAt
          ? { thinkingFinishedAt: patch.thinkingFinishedAt }
          : {}),
      },
    };
  }
  if (
    patch.statusLabelKey &&
    (patch.statusLabelPolicy !== "if_empty" || !String(messageItem.statusLabel || "").trim())
  ) {
    messageItem.statusLabel = translate(patch.statusLabelKey);
  }
}

function applyConversationStateRuntimeToMessages() {
  const messageList = Array.isArray(props.activeSession?.messages)
    ? props.activeSession.messages
    : [];
  messageList.forEach((messageItem) => {
    const runtimeEffect = resolveSessionRunMessageRuntimePatch({
      messageItem,
      activeSession: props.activeSession,
    });
    if (runtimeEffect.action === SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE) {
      applyMessageRuntimePatch(messageItem, runtimeEffect.patch);
    }
  });
}

watchEffect(() => {
  props.activeSession?.id;
  props.activeSession?.backendSessionId;
  Array.isArray(props.activeSession?.messages) ? props.activeSession.messages.length : 0;
  props.activeSession?.turnStatuses;
  props.activeSession?.turnTimingsByTurnScopeId;
  applyConversationStateRuntimeToMessages();
});

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
          v-if="loadingSessionDetail && !activeSession?.messages?.length"
          :rows="6"
          animated
          class="skeleton-loading noobot-surface-card"
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
