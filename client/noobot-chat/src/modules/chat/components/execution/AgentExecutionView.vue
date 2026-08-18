<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import SharedChatMessageItem from "../message/SharedChatMessageItem.vue";
import { BaseEmptyHint } from "../../../../shared/public-api/ui.js";
import { getMessageTurnScopeId, normalizeTurnScopeIdKey } from "../../model/messageIdentity.js";
import { sharedMessageRenderProps } from "../../model/messageItemProps.js";

const props = defineProps({
  executionId: { type: String, required: true },
  channelContext: { type: String, default: "primary" },
  messages: { type: Array, default: () => [] },
  ...sharedMessageRenderProps,
  turnTimingsByTurnScopeId: { type: Object, default: () => ({}) },
  emptyText: { type: String, default: "" },
});

const emit = defineEmits(["open-thinking-details"]);

function openThinkingDetails(payload = {}, messageItem = {}) {
  emit("open-thinking-details", {
    ...(payload && typeof payload === "object" ? payload : {}),
    executionId: props.executionId,
    channelContext: props.channelContext,
    messageItem: payload?.messageItem || messageItem,
  });
}

function messageRenderKey(messageItem = {}, messageIndex = 0) {
  const explicitId = String(
    messageItem?.id || messageItem?.messageId || messageItem?.uuid || "",
  ).trim();
  if (explicitId) return `${props.executionId}-message-${explicitId}`;
  const turnScopeKey = normalizeTurnScopeIdKey(getMessageTurnScopeId(messageItem));
  const role = String(messageItem?.role || "message").trim();
  return `${props.executionId}-${turnScopeKey || "unscoped"}-${role}-${messageIndex}`;
}

function isCurrentAssistantMessage(messageItem = {}, messageIndex = 0) {
  if (String(messageItem?.role || "").trim() !== "assistant") return false;
  for (let index = props.messages.length - 1; index >= 0; index -= 1) {
    if (String(props.messages[index]?.role || "").trim() === "assistant") {
      return index === messageIndex;
    }
  }
  return false;
}
</script>

<template>
  <div
    class="agent-execution-view"
    :data-execution-id="executionId"
    :data-channel-context="channelContext"
  >
    <div
      v-for="(messageItem, messageIndex) in messages"
      :key="messageRenderKey(messageItem, messageIndex)"
      class="agent-execution-view__message"
    >
      <SharedChatMessageItem
        :message-item="messageItem"
        :current-turn="isCurrentAssistantMessage(messageItem, messageIndex)"
        :all-messages="allMessages"
        :session-docs="sessionDocs"
        :turn-timings-by-turn-scope-id="turnTimingsByTurnScopeId"
        :user-id="userId"
        :render-markdown="renderMarkdown"
        :format-time="formatTime"
        :format-file-size="formatFileSize"
        :is-image-mime="isImageMime"
        :sending="sending"
        :delete-monotonic-message="deleteMonotonicMessage"
        :resend-monotonic-message="resendMonotonicMessage"
        :stop-execution="stopExecution"
        :attachment-preview-dialog-class="attachmentPreviewDialogClass"
        :file-preview-dialog-class="filePreviewDialogClass"
        @open-thinking-details="openThinkingDetails($event, messageItem)"
      />
    </div>
    <BaseEmptyHint
      v-if="!messages.length && emptyText"
      class="agent-execution-view__empty"
      :text="emptyText"
    />
  </div>
</template>

<style scoped>
.agent-execution-view__message {
  margin-bottom: 12px;
}
.agent-execution-view__message:last-child {
  margin-bottom: 0;
}
</style>
