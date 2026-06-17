<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import SharedChatMessageItem from "../../shared/message/SharedChatMessageItem.vue";

defineEmits(["open-thinking-details"]);

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
  attachmentPreviewDialogClass: {
    type: String,
    default: "attachment-preview-dialog",
  },
  filePreviewDialogClass: {
    type: String,
    default: "generated-file-preview-dialog",
  },
});
</script>

<template>
  <SharedChatMessageItem v-bind="props" @open-thinking-details="$emit('open-thinking-details', $event)" />
</template>
