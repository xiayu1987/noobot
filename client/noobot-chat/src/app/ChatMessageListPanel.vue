<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { ref } from "vue";
import ChatMessageItem from "../modules/message/ChatMessageItem.vue";
import { useLocale } from "../shared/i18n/useLocale";

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
  emptyLogoSrc: { type: String, default: "" },
});

const listRef = ref(null);
const { t } = useLocale();

function setScrollTop(top = 0) {
  listRef.value?.setScrollTop?.(Number(top || 0));
}

function getWrapRef() {
  return listRef.value?.wrapRef || null;
}

defineExpose({
  setScrollTop,
  getWrapRef,
});
</script>

<template>
  <div class="message-container">
    <el-scrollbar ref="listRef" class="msg-list">
      <div class="msg-list-inner">
        <el-skeleton
          v-if="loadingSessionDetail"
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
          <p>{{ t("common.emptyChatHint") }}</p>
        </div>

        <template
          v-for="(messageItem, messageIndex) in activeSession?.messages || []"
          :key="messageIndex"
        >
          <ChatMessageItem
            v-if="shouldRenderMessageInChat(messageItem)"
            :message-item="messageItem"
            :all-messages="activeSession?.rawMessages || activeSession?.messages || []"
            :session-docs="activeSession?.sessionDocs || []"
            :user-id="userId"
            :auth-fetch="authFetch"
            :render-markdown="renderMarkdown"
            :format-time="formatTime"
            :format-file-size="formatFileSize"
            :is-image-mime="isImageMime"
          />
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
