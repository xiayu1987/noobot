<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import ChatMessageItem from "../../../../client/noobot-chat/src/modules/message/ChatMessageItem.vue";

defineProps({
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
</script>

<template>
  <ChatMessageItem
    v-bind="$props"
    attachment-preview-dialog-class="workflow-session-preview-dialog"
    file-preview-dialog-class="workflow-session-preview-dialog"
  />
</template>
