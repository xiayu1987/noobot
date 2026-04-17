<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { Document, WarningFilled } from "@element-plus/icons-vue";
import ThinkingPanel from "./ThinkingPanel.vue";

defineProps({
  messageItem: { type: Object, required: true },
  renderMarkdown: { type: Function, required: true },
  formatTime: { type: Function, required: true },
  formatFileSize: { type: Function, required: true },
  isImageMime: { type: Function, required: true },
});
</script>

<template>
  <div class="msg-wrapper" :class="messageItem.role">
    <div class="avatar">
      {{ messageItem.role === "user" ? "我" : "AI" }}
    </div>

    <div class="msg-content">
      <div class="meta">
        <span class="time">{{ formatTime(messageItem.ts) }}</span>
      </div>

      <div class="bubble">
        <div class="msg-type-row" v-if="messageItem.type && messageItem.type !== 'tool_call'">
          <el-tag size="small" effect="dark" class="type-tag">{{
            messageItem.type
          }}</el-tag>
        </div>
        <div v-if="messageItem.role === 'assistant' && messageItem.pending" class="message-pending">
          <span class="pending-dot"></span> 生成中...
        </div>

        <div v-if="messageItem.attachments?.length" class="msg-attachments">
          <div
            v-for="(attachmentItem, attachmentIndex) in messageItem.attachments"
            :key="attachmentIndex"
            class="file-card"
          >
            <img
              v-if="isImageMime(attachmentItem.mimeType || '') && attachmentItem.previewUrl"
              :src="attachmentItem.previewUrl"
              :alt="attachmentItem.name"
              class="file-thumb"
            />
            <div v-else class="file-icon">
              <el-icon><Document /></el-icon>
            </div>
            <div class="file-meta">
              <div class="file-name">{{ attachmentItem.name }}</div>
              <div class="file-size">
                {{ formatFileSize(attachmentItem.size || 0) }}
              </div>
            </div>
          </div>
        </div>

        <ThinkingPanel :message-item="messageItem" />

        <div v-if="messageItem.error" class="error-alert">
          <el-icon class="error-icon"><WarningFilled /></el-icon>
          {{ messageItem.error }}
        </div>

        <div class="md" v-html="renderMarkdown(messageItem.content)" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.msg-wrapper {
  display: flex;
  gap: 16px;
  max-width: 100%;
}

.msg-wrapper.user {
  flex-direction: row-reverse;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
  color: #fff;
}

.msg-wrapper.assistant .avatar {
  background: var(--noobot-msg-assistant-avatar);
}

.msg-wrapper.user .avatar {
  background: var(--noobot-msg-user-avatar);
}

.msg-content {
  display: flex;
  flex-direction: column;
  max-width: calc(100% - 52px);
}

.msg-wrapper.assistant .msg-content {
  width: 760px;
  max-width: calc(100% - 52px);
}

.msg-wrapper.user .msg-content {
  align-items: flex-end;
}

.meta {
  font-size: 12px;
  color: var(--noobot-msg-meta);
  margin-bottom: 6px;
  padding: 0 4px;
}

.bubble {
  padding: 14px 18px;
  border-radius: 16px;
  font-size: 15px;
  line-height: 1.6;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.2);
  word-wrap: break-word;
}

.msg-wrapper.assistant .bubble {
  background: var(--noobot-msg-assistant-bg);
  border: 1px solid var(--noobot-msg-assistant-border);
  border-top-left-radius: 4px;
  color: var(--noobot-msg-assistant-text);
}

.msg-wrapper.user .bubble {
  background: var(--noobot-msg-user-bg);
  border: 1px solid var(--noobot-msg-user-border);
  border-top-right-radius: 4px;
  color: var(--noobot-msg-user-text);
}

.msg-type-row {
  margin-bottom: 8px;
}

.type-tag {
  border: none;
  background: var(--noobot-msg-tag-bg);
  color: var(--noobot-msg-tag-text);
}

.message-pending {
  font-size: 12px;
  color: var(--noobot-msg-pending-text);
  margin-bottom: 6px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.pending-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--noobot-msg-pending-dot);
  animation: pendingPulse 0.9s ease-in-out infinite;
}

@keyframes pendingPulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.9);
  }
  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}

.error-alert {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--noobot-msg-error-bg);
  border: 1px solid var(--noobot-msg-error-border);
  color: var(--noobot-msg-error-text);
  font-size: 13px;
}

.error-icon {
  font-size: 14px;
}

.msg-attachments {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.file-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--noobot-msg-file-card-bg);
  border: 1px solid var(--noobot-msg-file-card-border);
  border-radius: 10px;
  padding: 8px 10px;
}

.file-thumb {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  object-fit: cover;
}

.file-icon {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--noobot-msg-file-icon-bg);
}

.file-meta {
  min-width: 0;
}

.file-name {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--noobot-msg-file-name);
}

.file-size {
  font-size: 12px;
  color: var(--noobot-msg-file-size);
}

.md {
  width: 100%;
  overflow-x: auto;
}

.md :deep(p) {
  margin: 0 0 12px 0;
}

.md :deep(p:last-child) {
  margin-bottom: 0;
}

.md :deep(a) {
  color: var(--noobot-msg-link);
  text-decoration: none;
}

.md :deep(a:hover) {
  text-decoration: underline;
}

.md :deep(code) {
  background: var(--noobot-msg-inline-code-bg);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
  color: var(--noobot-msg-inline-code-text);
}

.md :deep(pre) {
  background: var(--noobot-msg-code-block-bg);
  color: var(--noobot-msg-code-block-text);
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 12px 0;
}

.md :deep(pre code) {
  background: transparent;
  padding: 0;
  color: inherit;
  font-size: 0.9em;
}
</style>
