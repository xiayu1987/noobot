<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import SharedChatMessageItem from "../message/SharedChatMessageItem.vue";
import { BaseEmptyHint } from "../../../../shared/public-api/ui.js";
import { sharedMessageRenderProps } from "../../model/messageItemProps.js";
import { resolveMessageViewKey } from "@noobot/event-protocol/message-event";

const props = defineProps({
  executionId: { type: String, required: true },
  channelContext: { type: String, default: "primary" },
  messages: { type: Array, required: true },
  ...sharedMessageRenderProps,
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

function messageRenderKey(messageItem) {
  const key = resolveMessageViewKey(messageItem);
  if (!key) throw new TypeError("execution message requires a canonical view identity");
  return key;
}

function isCurrentAssistantMessage(messageItem = {}, messageIndex = 0) {
  if (messageItem.role !== "assistant") return false;
  for (let index = props.messages.length - 1; index >= 0; index -= 1) {
    if (props.messages[index].role === "assistant") {
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
        :all-messages="messages"
        :session-docs="sessionDocs"
        :user-id="userId"
        :render-markdown="renderMarkdown"
        :format-time="formatTime"
        :format-file-size="formatFileSize"
        :is-image-mime="isImageMime"
        :sending="sending"
        :delete-monotonic-message="deleteMonotonicMessage"
        :resend-monotonic-message="resendMonotonicMessage"
        :stop-execution="stopExecution"
        :fetch-execution-report="fetchExecutionReport"
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
  margin-bottom: var(--noobot-space-md);
}
.agent-execution-view__message:last-child {
  margin-bottom: 0;
}
</style>
