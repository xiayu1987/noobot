<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { WarningFilled } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import ThinkingPanel from "./ThinkingPanel.vue";
import MessagePreviewContent from "./MessagePreviewContent.vue";
import MessageHeader from "./MessageHeader.vue";
import MessageStatusRow from "./MessageStatusRow.vue";
import MessageWrittenFiles from "./MessageWrittenFiles.vue";
import MessageAttachments from "./MessageAttachments.vue";
import { useMessagePreview } from "../../composables/message/useMessagePreview";
import { useMessageFiles } from "../../composables/message/useMessageFiles";
import { useMessageMeta } from "../../composables/message/useMessageMeta";
import { useMermaidRender } from "../../composables/message/useMermaidRender";
import { useLocale } from "../../shared/i18n/useLocale";

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

const {
  previewVisible,
  previewLoading,
  previewError,
  previewFileName,
  previewMode,
  previewTextContent,
  previewImageUrl,
  attachmentPreviewVisible,
  attachmentPreviewType,
  attachmentPreviewUrl,
  attachmentPreviewName,
  attachmentPreviewLoading,
  attachmentPreviewError,
  attachmentPreviewTextContent,
  canPreviewAttachment,
  openAttachmentPreview,
  closeAttachmentPreview,
  openFilePreview,
  closePreviewDialog,
  onDownloadFile,
  onDownloadAttachment,
  onCopyMarkdownRich,
  onCopyMarkdownText,
  onCopyAttachmentMarkdownRich,
  onCopyAttachmentMarkdownText,
} = useMessagePreview({
  userId: props.userId,
  authFetch: props.authFetch,
  isImageMime: props.isImageMime,
  renderMarkdown: props.renderMarkdown,
  notify: ({ type = "info", message = "" } = {}) => {
    if (!message) return;
    if (type === "success") ElMessage.success(message);
    else if (type === "warning") ElMessage.warning(message);
    else if (type === "error") ElMessage.error(message);
  },
});

const { writtenFiles, displayedAttachmentMetas } = useMessageFiles({
  getMessageItem: () => props.messageItem,
  getAllMessages: () => props.allMessages,
  getSessionDocs: () => props.sessionDocs,
  getUserId: () => props.userId,
});

const { messageModelLabel, showSubTaskActivity, subTaskStatusText } = useMessageMeta({
  getMessageItem: () => props.messageItem,
});

const { mermaidHostRef: messageMarkdownRef } = useMermaidRender();
const { t } = useLocale();

</script>

<template>
  <div class="msg-wrapper" :class="messageItem.role">
    <MessageHeader
      :role="messageItem.role"
      :ts="messageItem.ts"
      :format-time="formatTime"
      :model-label="messageModelLabel"
    />

    <!-- 内容区域：气泡直接铺在下方 -->
    <div class="msg-content">
      <div class="bubble">
        <div class="msg-type-row" v-if="messageItem.type && messageItem.type !== 'tool_call'">
          <el-tag size="small" effect="dark" class="type-tag noobot-flat-chip">{{
            messageItem.type
          }}</el-tag>
        </div>
        <MessageStatusRow
          v-if="messageItem.role === 'assistant' && (messageItem.pending || messageItem.statusLabel)"
          :pending="messageItem.pending"
          :status-label="messageItem.statusLabel"
          :show-sub-task="showSubTaskActivity"
          :sub-task-status-text="subTaskStatusText"
        />

        <ThinkingPanel :message-item="messageItem" :all-messages="allMessages" />

        <div v-if="messageItem.error" class="error-alert">
          <el-icon class="error-icon"><WarningFilled /></el-icon>
          {{ messageItem.error }}
        </div>

        <div ref="messageMarkdownRef" class="md" v-html="renderMarkdown(messageItem.content)" />

        <MessageWrittenFiles
          v-if="messageItem.role === 'assistant'"
          :written-files="writtenFiles"
          @preview="openFilePreview"
          @download="onDownloadFile"
        />

        <MessageAttachments
          :attachments="displayedAttachmentMetas"
          :is-image-mime="isImageMime"
          :can-preview-attachment="canPreviewAttachment"
          :format-file-size="formatFileSize"
          @preview="openAttachmentPreview"
          @download="onDownloadAttachment"
        />
      </div>
    </div>
  </div>

  <!-- 弹窗部分保持不变 -->
  <el-dialog
    v-model="attachmentPreviewVisible"
    :title="t('message.attachmentPreviewTitle', { name: attachmentPreviewName || '' })"
    width="72%"
    top="6vh"
    class="attachment-preview-dialog"
    destroy-on-close
    @closed="closeAttachmentPreview"
  >
    <MessagePreviewContent
      content-type="attachment"
      :active="attachmentPreviewVisible"
      :attachment-preview-type="attachmentPreviewType"
      :attachment-preview-url="attachmentPreviewUrl"
      :attachment-preview-name="attachmentPreviewName"
      :attachment-preview-loading="attachmentPreviewLoading"
      :attachment-preview-error="attachmentPreviewError"
      :attachment-preview-text-content="attachmentPreviewTextContent"
      :render-markdown="renderMarkdown"
      @copy-markdown-rich="onCopyAttachmentMarkdownRich"
      @copy-markdown-text="onCopyAttachmentMarkdownText"
    />
  </el-dialog>

  <el-dialog
    v-model="previewVisible"
    :title="t('message.filePreviewTitle', { name: previewFileName || '' })"
    width="72%"
    top="6vh"
    class="generated-file-preview-dialog"
    destroy-on-close
    @closed="closePreviewDialog"
  >
    <MessagePreviewContent
      content-type="file"
      :active="previewVisible"
      :preview-loading="previewLoading"
      :preview-error="previewError"
      :preview-file-name="previewFileName"
      :preview-mode="previewMode"
      :preview-text-content="previewTextContent"
      :preview-image-url="previewImageUrl"
      :render-markdown="renderMarkdown"
      @copy-markdown-rich="onCopyMarkdownRich"
      @copy-markdown-text="onCopyMarkdownText"
    />
  </el-dialog>
</template>

<style scoped>
/* --- 布局核心重构：上下布局 --- */
.msg-wrapper {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-xs); /* 头像行和气泡行之间的间距 */
  margin-bottom: calc(var(--noobot-space-lg) + var(--noobot-space-md));
  width: 100%;
  position: relative;
}

/* AI 侧左对齐 */
.msg-wrapper.assistant {
  align-items: stretch;
}

/* 用户侧右对齐 */
.msg-wrapper.user {
  align-items: stretch;
}

/* --- 内容区域：气泡 --- */
.msg-content {
  display: flex;
  flex-direction: column;
  max-width: 100%; /* 限制最大宽度，避免太宽影响阅读体验 */
}

/* AI 侧气泡左对齐 */
.msg-wrapper.assistant .msg-content {
  align-items: flex-start;
}

/* 用户侧气泡右对齐 */
.msg-wrapper.user .msg-content {
  align-items: flex-end;
}

.bubble {
  padding: var(--noobot-msg-bubble-pad-y) var(--noobot-msg-bubble-pad-x);
  border-radius: var(--noobot-radius-lg);
  font-size: var(--noobot-msg-font-size);
  line-height: var(--noobot-msg-line-height);
  box-shadow: var(--noobot-msg-shadow-card);
  word-wrap: break-word;
  width: 100%;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
  position: relative;
  overflow: hidden;
}

.msg-wrapper.assistant .bubble {
  background: var(--noobot-msg-assistant-bg);
  border: 1px solid var(--noobot-msg-assistant-border);
  /* 上下布局时，为了呼应左上角的头像，左上角圆角可以稍微小一点 */
  border-top-left-radius: var(--noobot-msg-corner-accent-radius);
  color: var(--noobot-msg-assistant-text);
}

.msg-wrapper.user .bubble {
  background: var(--noobot-msg-user-bg);
  border: 1px solid var(--noobot-msg-user-border);
  /* 呼应右上角的头像 */
  border-top-right-radius: var(--noobot-msg-corner-accent-radius);
  color: var(--noobot-msg-user-text);
}

.msg-wrapper .bubble:hover {
  box-shadow: var(--noobot-msg-shadow-card-hover);
}

/* --- 以下为原有内部样式（保持不变或微调） --- */
.msg-type-row {
  margin-bottom: var(--noobot-space-xs);
}

.type-tag {
  border: none;
  color: var(--noobot-msg-tag-text);
}

.error-alert {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-xs);
  margin-bottom: var(--noobot-space-md);
  padding: var(--noobot-space-sm) var(--noobot-space-lg);
  border-radius: var(--noobot-radius-sm);
  background: var(--noobot-msg-error-bg);
  border: 1px solid var(--noobot-msg-error-border);
  color: var(--noobot-msg-error-text);
  font-size: var(--noobot-msg-caption-font-size);
  box-shadow: none;
}

.error-icon {
  font-size: 14px;
}

.md {
  width: 100%;
  overflow-x: auto;
}

/* --- Markdown 内部样式 --- */
.md :deep(p) {
  margin: 0 0 var(--noobot-space-md) 0;
}

.md :deep(p:last-child) {
  margin-bottom: 0;
}

.md :deep(a) {
  color: var(--noobot-msg-link);
  text-decoration: none;
  text-underline-offset: 2px;
}

.md :deep(a:hover) {
  text-decoration: underline;
}

.md :deep(code) {
  background: var(--noobot-msg-inline-code-bg);
  padding: 2px 6px;
  border-radius: var(--noobot-radius-xs);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
  color: var(--noobot-msg-inline-code-text);
}

.md :deep(pre) {
  background: var(--noobot-msg-code-block-bg);
  color: var(--noobot-msg-code-block-text);
  padding: var(--noobot-msg-markdown-pre-padding);
  border-radius: var(--noobot-radius-md);
  border: 1px solid var(--noobot-panel-border);
  box-shadow: none;
  overflow-x: auto;
  margin: var(--noobot-space-md) 0;
}

.md :deep(pre code) {
  background: transparent;
  padding: 0;
  color: inherit;
  font-size: 0.9em;
}

.md :deep(ul),
.md :deep(ol) {
  margin: var(--noobot-space-xs) 0 var(--noobot-space-md) 20px;
  padding-left: 16px;
}

.md :deep(li) {
  margin: 4px 0;
  line-height: 1.7;
}

.md :deep(ul li::marker) {
  color: var(--noobot-text-accent);
}

.md :deep(ol li::marker) {
  color: color-mix(in srgb, var(--noobot-text-accent) 70%, var(--noobot-text-main));
  font-weight: 600;
}

.md :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: var(--noobot-space-md) 0;
  font-size: var(--noobot-msg-caption-font-size);
  border: 1px solid var(--noobot-msg-assistant-border);
  border-radius: var(--noobot-radius-sm);
  overflow: hidden;
}

.md :deep(th),
.md :deep(td) {
  border: 1px solid var(--noobot-msg-assistant-border);
  padding: var(--noobot-msg-table-cell-padding-y) var(--noobot-msg-table-cell-padding-x);
  text-align: left;
  vertical-align: top;
}

.md :deep(th) {
  background: var(--noobot-panel-muted);
  font-weight: 600;
}

.md :deep(tr:nth-child(even) td) {
  background: color-mix(in srgb, var(--noobot-panel-muted) 62%, transparent);
}

.md :deep(.mermaid) {
  margin: var(--noobot-space-md) 0;
  padding: var(--noobot-space-sm);
  border: 1px solid var(--noobot-panel-border);
  border-radius: var(--noobot-radius-md);
  background: var(--noobot-panel-bg);
  overflow-x: auto;
}

.md :deep(blockquote) {
  margin: var(--noobot-space-md) 0;
  padding: var(--noobot-space-xs) var(--noobot-space-md);
  border-left: 3px solid color-mix(in srgb, var(--noobot-text-accent) 90%, transparent);
  background: var(--noobot-accent-soft);
  border-radius: var(--noobot-radius-xs);
}

.md :deep(h1),
.md :deep(h2),
.md :deep(h3),
.md :deep(h4) {
  margin: var(--noobot-space-md) 0 var(--noobot-space-sm);
  line-height: 1.35;
}

.md :deep(.mermaid svg) {
  max-width: 100%;
  height: auto;
  display: block;
}

</style>
