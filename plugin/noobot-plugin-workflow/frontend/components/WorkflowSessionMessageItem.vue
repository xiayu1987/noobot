<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import SharedChatMessageItem from "../../../../client/noobot-chat/src/shared/message/SharedChatMessageItem.vue";

const props = defineProps({
  messageItem: { type: Object, required: true },
  allMessages: { type: Array, default: () => [] },
  sessionDocs: { type: Array, default: () => [] },
  userId: { type: String, default: "" },
  authFetch: { type: Function, default: null },
  renderMarkdown: { type: Function, required: true },
  formatTime: { type: Function, required: true },
  formatFileSize: { type: Function, required: true },
  isImageMime: { type: Function, required: true },
});

const emit = defineEmits(["open-thinking-details"]);

function handleOpenThinkingDetails(payload = {}) {
  emit("open-thinking-details", payload);
}
</script>

<template>
  <SharedChatMessageItem
    v-bind="props"
    attachment-preview-dialog-class="workflow-session-preview-dialog"
    file-preview-dialog-class="workflow-session-preview-dialog"
    @open-thinking-details="handleOpenThinkingDetails"
  />
</template>
