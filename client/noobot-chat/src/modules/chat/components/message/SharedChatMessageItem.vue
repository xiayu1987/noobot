<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { useMessagePreview } from "../../composables/message/useMessagePreview.js";
import { useMessageFiles } from "../../composables/message/useMessageFiles.js";
import { useMessageMeta } from "../../composables/message/useMessageMeta.js";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageSessionId,
  getMessageTurnScopeId,
} from "../../model/messageIdentity.js";
import { selectTurnMessageRuntime } from "../../runtime/run-state-machine/turnRuntimeRegistry.js";
import { useLocale } from "../../../../shared/i18n/useLocale.js";
import { useChatStore } from "../../stores/useChatStore.js";
import MonotonicMessageActions from "./actions/MonotonicMessageActions.vue";
import AssistantCopyActions from "./AssistantCopyActions.vue";
import MessageStatusRow from "./MessageStatusRow.vue";
import { resolveMonotonicMessageActionProps } from "../../model/message-actions/monotonicMessageActionRules.js";
import {
  BaseMarkdownContent,
  BaseAttachmentFileCard,
  BaseFileCardList,
  BaseMessageErrorAlert,
  BaseMessageShell,
  BaseMessageTypeTag,
  BasePreviewContent,
} from "../../../../shared/public-api/ui.js";
import { EXTENSION_POINTS } from "../../../../extensions/extension-point-ids.js";
import ExtensionOutlet from "../../../../extensions/components/ExtensionOutlet.vue";
import { resolveExtensionPoint } from "../../../../extensions/extension-registry.js";
import {
  logWorkflowDiagnostics,
  summarizeWorkflowMessage,
} from "../../../debug/loggers/workflowDiagnosticsLogger.js";

const emit = defineEmits(["open-thinking-details"]);

const props = defineProps({
  messageItem: { type: Object, required: true },
  allMessages: { type: Array, default: () => [] },
  sessionDocs: { type: Array, default: () => [] },
  userId: { type: String, default: "" },
  renderMarkdown: { type: Function, required: true },
  formatTime: { type: Function, required: true },
  formatFileSize: { type: Function, required: true },
  isImageMime: { type: Function, required: true },
  sending: { type: Boolean, default: false },
  deleteMonotonicMessage: { type: Function, default: null },
  resendMonotonicMessage: { type: Function, default: null },
  stopExecution: { type: Function, default: null },
  hideHeader: { type: Boolean, default: false },
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
  canPreviewParsedResult,
  canPreviewFile,
  openAttachmentPreview,
  openParsedResultPreview,
  openResolvedAttachmentPreview,
  closeAttachmentPreview,
  openFilePreview,
  closePreviewDialog,
  onDownloadFile,
  onDownloadAttachment,
  onDownloadParsedResult,
  onCopyMarkdownRich,
  onCopyMarkdownText,
  onCopyAttachmentMarkdownRich,
  onCopyAttachmentMarkdownText,
  onCopyMessageMarkdownRich,
  onCopyMessageMarkdownText,
} = useMessagePreview({
  userId: props.userId,
  isImageMime: props.isImageMime,
  renderMarkdown: props.renderMarkdown,
  notify: ({ type = "info", message = "" } = {}) => {
    if (!message) return;
    if (type === "success") ElMessage.success(message);
    else if (type === "warning") ElMessage.warning(message);
    else if (type === "error") ElMessage.error(message);
  },
});

const { writtenFiles, displayedAttachments } = useMessageFiles({
  getMessageItem: () => props.messageItem,
  getAllMessages: () => props.allMessages,
  getSessionDocs: () => props.sessionDocs,
  getUserId: () => props.userId,
});

const { messageModelLabel, showSubTaskActivity, subTaskStatusText, statusStepState } = useMessageMeta({
  getMessageItem: () => props.messageItem,
});

const messageMarkdownRef = ref(null);
const { translate } = useLocale();
const chatStore = useChatStore();
const messageRuntime = computed(() => selectTurnMessageRuntime(chatStore.turnRuntimeRegistry, {
  sessionId: getMessageSessionId(props.messageItem),
  turnScopeId: getMessageTurnScopeId(props.messageItem),
  dialogProcessId: getMessageDialogProcessId(props.messageItem),
}));

const preMessageCardRenderers = computed(() =>
  resolveExtensionPoint(EXTENSION_POINTS.MESSAGE_CARD_PRE, { messageItem: props.messageItem }),
);
const postMessageCardRenderers = computed(() =>
  resolveExtensionPoint(EXTENSION_POINTS.MESSAGE_CARD_POST, { messageItem: props.messageItem }),
);
const showMessageTypeTag = computed(() => !(
  getMessageRole(props.messageItem) === "assistant" &&
  String(props.messageItem?.type || "").trim().toLowerCase() === "message" &&
  !String(props.messageItem?.content || "").trim() &&
  Boolean(
    getMessageTurnScopeId(props.messageItem) ||
    getMessageDialogProcessId(props.messageItem),
  )
));
watch(
  () => [
    summarizeWorkflowMessage(props.messageItem),
    preMessageCardRenderers.value.map((renderer) => renderer.id),
    postMessageCardRenderers.value.map((renderer) => renderer.id),
  ],
  ([message, preRendererIds, postRendererIds]) => {
    if (message.type !== "workflow" && message.pluginSource !== "workflow-plugin") return;
    logWorkflowDiagnostics("frontend.workflowRender.cardMatchEvaluated", {
      sessionId: message.sessionId,
      dialogProcessId: message.dialogProcessId,
      turnScopeId: message.turnScopeId,
      workflowRunId: message.workflowRunId,
      message,
      preRendererIds,
      postRendererIds,
      matched: preRendererIds.includes("workflow-card") || postRendererIds.includes("workflow-card"),
    });
  },
  { immediate: true },
);
const suppressDefaultAssets = computed(() =>
  postMessageCardRenderers.value.some(
    (renderer = {}) => renderer?.suppressDefaultAssets === true,
  ),
);
const preContentMessageActionRenderers = computed(() =>
  resolveExtensionPoint(EXTENSION_POINTS.MESSAGE_ACTION_AFTER_PRE_CARDS, { messageItem: props.messageItem }),
);
const postContentMessageActionRenderers = computed(() =>
  resolveExtensionPoint(EXTENSION_POINTS.MESSAGE_ACTION_POST_CONTENT, { messageItem: props.messageItem }),
);
const hideMessageMarkdownForInlineEditor = computed(() =>
  getMessageRole(props.messageItem) === "user" && props.messageItem?.__monotonicEditing === true,
);
const defaultMonotonicMessageActionProps = computed(() =>
  resolveMonotonicMessageActionProps(resolveRendererContext()),
);

function resolveRendererContext() {
  const selectSessionMessages = (sessionId = "") => {
    const id = String(sessionId || "").trim();
    if (!id) return null;
    const workflowPayload = props.messageItem?.pluginMeta?.payload || {};
    const subSession = chatStore.selectSubSessionMessages?.(id);
    if (subSession) {
      return {
        ...subSession,
        sessionId: String(subSession?.sessionId || subSession?.id || id).trim(),
        messages: Array.isArray(subSession?.messages) ? subSession.messages : [],
      };
    }
    return null;
  };
  return {
    messageItem: props.messageItem,
    allMessages: props.allMessages,
    messageRuntime: messageRuntime.value,
    workflowNodeStateRegistry: chatStore.workflowNodeStateRegistry,
    // Pass the reactive registry itself, not only an opaque selector closure.
    // Plugin watchers must establish an explicit dependency on this fact source.
    subSessionMessageRegistry: chatStore.subSessionMessageRegistry,
    subSessionMessageRegistryVersion: chatStore.subSessionMessageRegistryVersion,
    turnRuntimeRegistry: chatStore.turnRuntimeRegistry,
    selectExecutionDetail: chatStore.selectExecutionDetail,
    stopExecution: props.stopExecution,
    selectSessionMessages,
    applyWorkflowRuntimeEvent: chatStore.applyWorkflowRuntimeEvent,
    logWorkflowDiagnostics,
    userId: props.userId,
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
    statusStepState: statusStepState.value,
    writtenFiles: writtenFiles.value,
    displayedAttachments: displayedAttachments.value,
    displayedAttachmentMetas: displayedAttachments.value,
    canPreviewAttachment,
    canPreviewParsedResult,
    onOpenFilePreview: openFilePreview,
    onDownloadFile,
    onOpenAttachmentPreview: openAttachmentPreview,
    onOpenParsedResultPreview: openParsedResultPreview,
    onOpenResolvedAttachmentPreview: openResolvedAttachmentPreview,
    onDownloadAttachment,
    onOpenThinkingDetails: handleOpenThinkingDetails,
  };
}

const extensionRendererContext = computed(() => {
  const context = resolveRendererContext();
  const sessions = context.subSessionMessageRegistry?.sessions || {};
  logWorkflowDiagnostics("frontend.workflowRender.extensionContextProjected", {
    sessionId: String(props.messageItem?.sessionId || ""),
    dialogProcessId: String(props.messageItem?.dialogProcessId || ""),
    turnScopeId: String(props.messageItem?.turnScopeId || ""),
    subSessionMessageRegistryVersion: Number(context.subSessionMessageRegistryVersion || 0),
    subSessions: Object.values(sessions).map((session = {}) => ({
      sessionId: String(session?.sessionId || session?.id || ""),
      messages: (Array.isArray(session?.messages) ? session.messages : []).map((message = {}) => ({
        id: String(message?.id || message?.messageId || ""),
        role: String(message?.role || ""),
        contentLength: String(message?.content || "").length,
      })),
    })),
  });
  return context;
});

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
    :hide-header="hideHeader"
  >
    <BaseMessageTypeTag v-if="showMessageTypeTag" :type="messageItem.type" />
    <MessageStatusRow
      v-if="getMessageRole(messageItem) === 'assistant' && statusStepState"
      :status-step-state="statusStepState"
    />
    <ExtensionOutlet
      :point="EXTENSION_POINTS.MESSAGE_CARD_PRE"
      :context="extensionRendererContext"
      :extra-listeners="{ openThinkingDetails: handleOpenThinkingDetails }"
    />

    <BaseMessageErrorAlert :error="messageItem.error" />

    <AssistantCopyActions
      :visible="getMessageRole(messageItem) === 'assistant' && Boolean(String(messageItem.content || '').trim())"
      :translate="translate"
      :on-copy-rich="handleCopyAssistantMessageRich"
      :on-copy-text="handleCopyAssistantMessageText"
    />

    <ExtensionOutlet
      :point="EXTENSION_POINTS.MESSAGE_ACTION_AFTER_PRE_CARDS"
      :context="extensionRendererContext"
    />

    <BaseMarkdownContent
      v-if="!hideMessageMarkdownForInlineEditor"
      ref="messageMarkdownRef"
      :content="messageItem.content"
      :render-markdown="renderMarkdown"
    />

    <ExtensionOutlet
      :point="EXTENSION_POINTS.MESSAGE_ACTION_POST_CONTENT"
      :context="extensionRendererContext"
    />

    <MonotonicMessageActions v-bind="defaultMonotonicMessageActionProps" />

    <BaseFileCardList v-if="!suppressDefaultAssets && (displayedAttachments.length || writtenFiles.length)">
      <BaseAttachmentFileCard
        v-for="attachmentItem in displayedAttachments"
        :key="`attachment:${attachmentItem.attachmentId || attachmentItem.name || ''}:${attachmentItem.size || 0}`"
        :attachment-item="attachmentItem"
        :thumbnail-url="attachmentItem.thumbnailUrl || attachmentItem.previewUrl || ''"
        :is-image-mime="isImageMime"
        :can-preview-attachment="canPreviewAttachment"
        :can-preview-parsed-result="canPreviewParsedResult"
        :format-file-size="formatFileSize"
        :translate="translate"
        show-parsed-result
        @preview="openAttachmentPreview"
        @download="onDownloadAttachment"
        @preview-parsed-result="openParsedResultPreview"
        @download-parsed-result="onDownloadParsedResult"
      />

      <BaseAttachmentFileCard
        v-for="fileItem in writtenFiles"
        :key="`written-file:${fileItem.relativePath || fileItem.resolvedPath || fileItem.fileName || ''}`"
        :attachment-item="fileItem"
        :is-image-mime="isImageMime"
        :can-preview-attachment="canPreviewFile"
        :format-file-size="formatFileSize"
        :translate="translate"
        :name-text="fileItem.fileName || fileItem.relativePath || fileItem.resolvedPath || ''"
        :title-text="fileItem.relativePath || fileItem.resolvedPath || fileItem.fileName || ''"
        :size-value="fileItem.size || 0"
        :show-size="false"
        :custom-badge-text="fileItem.recognized ? translate('message.recognizedFile') : translate('message.generatedFile')"
        :custom-badge-class="fileItem.recognized ? 'is-recognized' : 'is-agent'"
        @preview="openFilePreview"
        @download="onDownloadFile"
      />
    </BaseFileCardList>

    <ExtensionOutlet
      :point="EXTENSION_POINTS.MESSAGE_CARD_POST"
      :context="extensionRendererContext"
      :extra-listeners="{ openThinkingDetails: handleOpenThinkingDetails }"
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
