<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { useLocale } from "../../../../client/noobot-chat/src/shared/i18n/useLocale";
import { useMessageFiles } from "../../../../client/noobot-chat/src/composables/message/useMessageFiles";
import { useMessageMeta } from "../../../../client/noobot-chat/src/composables/message/useMessageMeta";
import { useMessagePreview } from "../../../../client/noobot-chat/src/composables/message/useMessagePreview";
import {
  BaseMarkdownContent,
  BaseMessageErrorAlert,
  BaseMessageShell,
  BaseMessageTypeTag,
  BasePreviewContent,
} from "../../../../client/noobot-chat/src/shared/ui";
import {
  resolveMessageActionProps,
  resolveMessageActionRenderers,
  resolveMessageCardListeners,
  resolveMessageCardProps,
  resolveMessageCardRenderers,
} from "../../../../client/noobot-chat/src/plugins/frontend-plugin-registry";

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

const messageMarkdownRef = ref(null);
const { translate } = useLocale();

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
  onCopyMessageMarkdownRich,
  onCopyMessageMarkdownText,
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

const preMessageCardRenderers = computed(() =>
  resolveMessageCardRenderers(props.messageItem, { slot: "pre" }),
);
const postMessageCardRenderers = computed(() =>
  resolveMessageCardRenderers(props.messageItem, { slot: "post" }),
);
const messageActionRenderers = computed(() =>
  resolveMessageActionRenderers(props.messageItem),
);

function resolveRendererContext() {
  return {
    messageItem: props.messageItem,
    allMessages: props.allMessages,
    userId: props.userId,
    authFetch: props.authFetch,
    renderMarkdown: props.renderMarkdown,
    formatTime: props.formatTime,
    formatFileSize: props.formatFileSize,
    isImageMime: props.isImageMime,
    onCopyMessageRich: handleCopyAssistantMessageRich,
    onCopyMessageText: handleCopyAssistantMessageText,
    translate,
    showSubTaskActivity: showSubTaskActivity.value,
    subTaskStatusText: subTaskStatusText.value,
    writtenFiles: writtenFiles.value,
    displayedAttachmentMetas: displayedAttachmentMetas.value,
    canPreviewAttachment,
    onOpenFilePreview: openFilePreview,
    onDownloadFile,
    onOpenAttachmentPreview: openAttachmentPreview,
    onDownloadAttachment,
  };
}

function resolveRendererProps(renderer = {}) {
  return resolveMessageCardProps(renderer, resolveRendererContext());
}

function resolveRendererListeners(renderer = {}) {
  return resolveMessageCardListeners(renderer, resolveRendererContext());
}

function resolveActionRendererProps(renderer = {}) {
  return resolveMessageActionProps(renderer, resolveRendererContext());
}

async function handleCopyAssistantMessageRich() {
  await onCopyMessageMarkdownRich({
    textContent: props.messageItem.content,
    renderedPreviewHtml: String(messageMarkdownRef.value?.getHtml?.() || ""),
  });
}

async function handleCopyAssistantMessageText() {
  await onCopyMessageMarkdownText(props.messageItem.content);
}

</script>

<template>
  <BaseMessageShell
    :role="messageItem.role"
    :ts="messageItem.ts"
    :format-time="formatTime"
    :model-label="messageModelLabel"
  >
    <BaseMessageTypeTag :type="messageItem.type" />

    <component
      :is="renderer.component"
      v-for="renderer in preMessageCardRenderers"
      :key="renderer.id"
      v-bind="resolveRendererProps(renderer)"
      v-on="resolveRendererListeners(renderer)"
    />

    <BaseMessageErrorAlert :error="messageItem.error" />

    <component
      :is="renderer.component"
      v-for="renderer in messageActionRenderers"
      :key="renderer.id"
      v-bind="resolveActionRendererProps(renderer)"
    />

    <BaseMarkdownContent
      ref="messageMarkdownRef"
      :content="messageItem.content"
      :render-markdown="renderMarkdown"
    />

    <component
      :is="renderer.component"
      v-for="renderer in postMessageCardRenderers"
      :key="renderer.id"
      v-bind="resolveRendererProps(renderer)"
      v-on="resolveRendererListeners(renderer)"
    />
  </BaseMessageShell>

  <el-dialog
    v-model="attachmentPreviewVisible"
    :title="translate('message.attachmentPreviewTitle', { name: attachmentPreviewName || '' })"
    width="72%"
    top="6vh"
    class="workflow-session-preview-dialog"
    destroy-on-close
    @closed="closeAttachmentPreview"
  >
    <BasePreviewContent
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
    :title="translate('message.filePreviewTitle', { name: previewFileName || '' })"
    width="72%"
    top="6vh"
    class="workflow-session-preview-dialog"
    destroy-on-close
    @closed="closePreviewDialog"
  >
    <BasePreviewContent
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
