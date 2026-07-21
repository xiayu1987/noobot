<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import SharedChatMessageItem from "../message/SharedChatMessageItem.vue";
import { BaseEmptyHint } from "../ui";

const props = defineProps({
  executionId: { type: String, required: true },
  channelContext: { type: String, default: "primary" },
  messages: { type: Array, default: () => [] },
  allMessages: { type: Array, default: () => [] },
  sessionDocs: { type: Array, default: () => [] },
  userId: { type: String, default: "" },
  authFetch: { type: Function, default: null },
  renderMarkdown: { type: Function, required: true },
  formatTime: { type: Function, required: true },
  formatFileSize: { type: Function, required: true },
  isImageMime: { type: Function, required: true },
  sending: { type: Boolean, default: false },
  deleteMonotonicMessage: { type: Function, default: null },
  resendMonotonicMessage: { type: Function, default: null },
  stopExecution: { type: Function, default: null },
  emptyText: { type: String, default: "" },
  attachmentPreviewDialogClass: { type: String, default: "attachment-preview-dialog" },
  filePreviewDialogClass: { type: String, default: "generated-file-preview-dialog" },
});

const emit = defineEmits(["open-thinking-details"]);

function openThinkingDetails(payload = {}, messageItem = {}) {
  emit("open-thinking-details", {
    ...(payload && typeof payload === "object" ? payload : {}),
    executionId: props.executionId,
    channelContext: props.channelContext,
    messageItem: payload?.messageItem || messageItem,
    allMessages: Array.isArray(payload?.allMessages) ? payload.allMessages : props.allMessages,
    sessionDocs: props.sessionDocs,
    skipFetch: payload?.skipFetch === true,
  });
}
</script>

<template>
  <div class="agent-execution-view" :data-execution-id="executionId" :data-channel-context="channelContext">
    <div
      v-for="(messageItem, messageIndex) in messages"
      :key="`${executionId}-${String(messageItem?.ts || '')}-${messageIndex}`"
      class="agent-execution-view__message"
    >
      <SharedChatMessageItem
        :message-item="messageItem"
        :all-messages="allMessages"
        :session-docs="sessionDocs"
        :user-id="userId"
        :auth-fetch="authFetch"
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
    <BaseEmptyHint v-if="!messages.length && emptyText" class="agent-execution-view__empty" :text="emptyText" />
  </div>
</template>

<style scoped>
.agent-execution-view__message { margin-bottom: 12px; }
.agent-execution-view__message:last-child { margin-bottom: 0; }
</style>
