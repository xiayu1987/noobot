<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { useMessagePreview } from "../../composables/message/useMessagePreview";
import { useMessageFiles } from "../../composables/message/useMessageFiles";
import { useMessageMeta } from "../../composables/message/useMessageMeta";
import { getMessageRole } from "../../composables/infra/messageIdentity";
import { useLocale } from "../i18n/useLocale";
import {
  BaseMarkdownContent,
  BaseMessageErrorAlert,
  BaseMessageShell,
  BaseMessageTypeTag,
  BasePreviewContent,
} from "../ui";
import {
  resolveMessageCardRenderers,
  resolveMessageCardListeners,
  resolveMessageCardProps,
  resolveMessageActionProps,
  resolveMessageActionRenderers,
} from "../../plugins/frontend-plugin-registry";

const emit = defineEmits(["open-thinking-details"]);

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
  sending: { type: Boolean, default: false },
  deleteMonotonicMessage: { type: Function, default: null },
  resendMonotonicMessage: { type: Function, default: null },
  attachmentPreviewDialogClass: {
    type: String,
    default: "attachment-preview-dialog",
  },
  filePreviewDialogClass: {
    type: String,
    default: "generated-file-preview-dialog",
  },
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

const messageMarkdownRef = ref(null);
const { translate } = useLocale();

const preMessageCardRenderers = computed(() =>
  resolveMessageCardRenderers(props.messageItem, { slot: "pre" }),
);
const postMessageCardRenderers = computed(() =>
  resolveMessageCardRenderers(props.messageItem, { slot: "post" }),
);
const preContentMessageActionRenderers = computed(() =>
  resolveMessageActionRenderers(props.messageItem, { placement: "after-pre-cards" }),
);
const postContentMessageActionRenderers = computed(() =>
  resolveMessageActionRenderers(props.messageItem, { placement: "post-content" }),
);
const hideMessageMarkdownForInlineEditor = computed(() =>
  getMessageRole(props.messageItem) === "user" && props.messageItem?.__monotonicEditing === true,
);

function resolveRendererProps(renderer = {}) {
  return resolveMessageCardProps(renderer, resolveRendererContext());
}

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
    sending: props.sending,
    deleteMonotonicMessage: props.deleteMonotonicMessage,
    resendMonotonicMessage: props.resendMonotonicMessage,
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
    onOpenThinkingDetails: handleOpenThinkingDetails,
  };
}

function resolveRendererListeners(renderer = {}) {
  return resolveMessageCardListeners(renderer, resolveRendererContext());
}

function resolveActionRendererProps(renderer = {}) {
  return resolveMessageActionProps(renderer, resolveRendererContext());
}

function handleOpenThinkingDetails(payload = {}) {
  emit("open-thinking-details", {
    messageItem: props.messageItem,
    allMessages: props.allMessages,
    sessionDocs: props.sessionDocs,
    ...(payload && typeof payload === "object" ? payload : {}),
  });
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
    :role="getMessageRole(messageItem)"
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
      @open-thinking-details="handleOpenThinkingDetails"
    />

    <BaseMessageErrorAlert :error="messageItem.error" />

    <component
      :is="renderer.component"
      v-for="renderer in preContentMessageActionRenderers"
      :key="renderer.id"
      v-bind="resolveActionRendererProps(renderer)"
    />

    <BaseMarkdownContent
      v-if="!hideMessageMarkdownForInlineEditor"
      ref="messageMarkdownRef"
      :content="messageItem.content"
      :render-markdown="renderMarkdown"
    />

    <component
      :is="renderer.component"
      v-for="renderer in postContentMessageActionRenderers"
      :key="renderer.id"
      v-bind="resolveActionRendererProps(renderer)"
    />

    <component
      :is="renderer.component"
      v-for="renderer in postMessageCardRenderers"
      :key="renderer.id"
      v-bind="resolveRendererProps(renderer)"
      v-on="resolveRendererListeners(renderer)"
      @open-thinking-details="handleOpenThinkingDetails"
    />
  </BaseMessageShell>

  <el-dialog
    v-model="attachmentPreviewVisible"
    :title="translate('message.attachmentPreviewTitle', { name: attachmentPreviewName || '' })"
    width="72%"
    top="6vh"
    :class="attachmentPreviewDialogClass"
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
    :class="filePreviewDialogClass"
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
