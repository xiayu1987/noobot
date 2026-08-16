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
import { resolveParsedResultAccessMeta } from "../../../../infrastructure/api/attachments/attachmentAccess.js";
import { useMessageMeta } from "../../composables/message/useMessageMeta.js";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageSessionId,
  getMessageTurnScopeId,
} from "../../model/messageIdentity.js";
import { selectTurnMessageRuntime } from "../../runtime/run-state-machine/turnRuntimeRegistry.js";
import { resolveTurnRuntimeView } from "../../runtime/run-state-machine/messageRuntime.js";
import {
  getTurnUiState,
  setTurnAssistantContentExpanded,
} from "../../runtime/engine/turnUiStore.js";
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
import { EXTENSION_POINTS } from "@noobot/plugin-protocol/frontend";
import { attachmentIdentityKey, projectAttachmentIdentity } from "@noobot/attachment-protocol";
import ExtensionOutlet from "../../../../extensions/components/ExtensionOutlet.vue";
import { resolveExtensionPoint } from "../../../../extensions/extension-registry.js";
import {
  logWorkflowDiagnostics,
  summarizeWorkflowMessage,
} from "../../../debug/loggers/workflowDiagnosticsLogger.js";
import { chatMessageItemProps } from "../../model/messageItemProps.js";

const emit = defineEmits(["open-thinking-details"]);

function getAttachmentRenderKey(attachmentItem = {}) {
  const attachmentId = String(attachmentItem?.attachmentId || "").trim();
  const clientAttachmentId = String(
    attachmentItem?.clientAttachmentId || attachmentItem?.draftAttachmentId || "",
  ).trim();
  // A newly selected file is rendered before the turn commit returns its
  // canonical identity. Persisted attachments always use the protocol key.
  if (!attachmentId && clientAttachmentId) return `draft:${clientAttachmentId}`;
  return attachmentIdentityKey(projectAttachmentIdentity(attachmentItem));
}

const props = defineProps(chatMessageItemProps);

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

const { displayedAttachments } = useMessageFiles({
  getMessageItem: () => props.messageItem,
  getAllMessages: () => props.allMessages,
  getSessionDocs: () => props.sessionDocs,
  getUserId: () => props.userId,
});

watch(
  () =>
    displayedAttachments.value.map((attachment) => ({
      attachmentId: String(attachment?.attachmentId || "").trim(),
      parsedResultTargetIdentity:
        resolveParsedResultAccessMeta(attachment)?.relation?.targetIdentity || null,
    })),
  (attachments) => {
    logWorkflowDiagnostics("frontend.workflowRender.attachmentCardsProjected", {
      ...summarizeWorkflowMessage(props.messageItem),
      attachments,
    });
  },
  { immediate: true, deep: true },
);

const { messageModelLabel, showSubTaskActivity, subTaskStatusText, statusStepState } =
  useMessageMeta({
    getMessageItem: () => props.messageItem,
    getRuntimeView: () => messageRuntime.value,
  });

const messageMarkdownRef = ref(null);
const { translate } = useLocale();
const chatStore = useChatStore();
const messageRuntime = computed(() => {
  const realtimeRuntime = selectTurnMessageRuntime(chatStore.turnRuntimeRegistry, {
    sessionId: getMessageSessionId(props.messageItem),
    turnScopeId: getMessageTurnScopeId(props.messageItem),
    dialogProcessId: getMessageDialogProcessId(props.messageItem),
  });
  return resolveTurnRuntimeView({
    messageItem: props.messageItem,
    turnTiming: realtimeRuntime
      ? {
          thinkingStartedAt: realtimeRuntime.startedAt,
          thinkingFinishedAt: realtimeRuntime.finishedAt,
        }
      : null,
    turnStatus: realtimeRuntime?.state ? { status: realtimeRuntime.state } : null,
    realtimeState: realtimeRuntime,
  });
});
const assistantContentExpanded = computed(() => {
  if (getMessageRole(props.messageItem) !== "assistant") return true;
  const explicit = getTurnUiState(props.messageItem)?.assistantContentExpanded;
  return typeof explicit === "boolean" ? explicit : props.currentTurn;
});

const preMessageCardRenderers = computed(() =>
  resolveExtensionPoint(EXTENSION_POINTS.MESSAGE_CARD_PRE, { messageItem: props.messageItem }),
);
const postMessageCardRenderers = computed(() =>
  resolveExtensionPoint(EXTENSION_POINTS.MESSAGE_CARD_POST, { messageItem: props.messageItem }),
);
const thinkingPanelContributionIds = Object.freeze(["thinking-panel"]);
const hasThinkingPanelContribution = computed(() =>
  preMessageCardRenderers.value.some((renderer = {}) => renderer.id === "thinking-panel"),
);
const thinkingPanelVisible = ref(false);
const statusStepRunning = computed(() =>
  Boolean(
    statusStepState.value && !["completed", "stopped", "error"].includes(statusStepState.value),
  ),
);
const unifiedRuntimePanelsRunning = computed(
  () => statusStepRunning.value && thinkingPanelVisible.value,
);
const workflowChildRenderDiagnosticsSignature = computed(() => {
  const turnScopeId = getMessageTurnScopeId(props.messageItem);
  const parentSessionId = String(props.messageItem?.parentSessionId || "").trim();
  if (!parentSessionId && !turnScopeId.startsWith("workflow-node:")) return "";
  const runtime = messageRuntime.value || {};
  return JSON.stringify({
    sessionId: getMessageSessionId(props.messageItem),
    parentSessionId,
    dialogProcessId: getMessageDialogProcessId(props.messageItem),
    turnScopeId,
    messageId: String(props.messageItem?.messageId || props.messageItem?.id || ""),
    pending: props.messageItem?.pending === true,
    statusStepState: String(statusStepState.value || ""),
    statusStepRunning: statusStepRunning.value,
    thinkingPanelContribution: hasThinkingPanelContribution.value,
    thinkingPanelVisible: thinkingPanelVisible.value,
    breathing: unifiedRuntimePanelsRunning.value,
    runtimeState: String(runtime?.state || ""),
    runtimeStartedAt: String(runtime?.startedAt || runtime?.thinkingStartedAt || ""),
    runtimeFinishedAt: String(runtime?.finishedAt || runtime?.thinkingFinishedAt || ""),
  });
});
watch(
  workflowChildRenderDiagnosticsSignature,
  (signature) => {
    if (!signature) return;
    const state = JSON.parse(signature);
    logWorkflowDiagnostics("frontend.workflowRender.childMessageRuntimeCommitted", {
      ...state,
      sessionId: state.parentSessionId || state.sessionId,
      nodeSessionId: state.sessionId,
    });
  },
  { immediate: true, flush: "post" },
);
const showMessageTypeTag = computed(
  () =>
    !(
      getMessageRole(props.messageItem) === "assistant" &&
      String(props.messageItem?.type || "")
        .trim()
        .toLowerCase() === "message" &&
      !String(props.messageItem?.content || "").trim() &&
      Boolean(
        getMessageTurnScopeId(props.messageItem) || getMessageDialogProcessId(props.messageItem),
      )
    ),
);
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
      matched:
        preRendererIds.includes("workflow-card") || postRendererIds.includes("workflow-card"),
    });
  },
  { immediate: true },
);
const suppressDefaultAssets = computed(() =>
  postMessageCardRenderers.value.some((renderer = {}) => renderer?.suppressDefaultAssets === true),
);
const preContentMessageActionRenderers = computed(() =>
  resolveExtensionPoint(EXTENSION_POINTS.MESSAGE_ACTION_AFTER_PRE_CARDS, {
    messageItem: props.messageItem,
  }),
);
const postContentMessageActionRenderers = computed(() =>
  resolveExtensionPoint(EXTENSION_POINTS.MESSAGE_ACTION_POST_CONTENT, {
    messageItem: props.messageItem,
  }),
);
const hideMessageMarkdownForInlineEditor = computed(
  () =>
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
        sessionId: String(subSession?.sessionId || id).trim(),
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
  return resolveRendererContext();
});
const extensionContextDiagnosticsSignature = computed(() =>
  [
    String(props.messageItem?.sessionId || ""),
    String(props.messageItem?.dialogProcessId || ""),
    String(props.messageItem?.turnScopeId || ""),
    Number(chatStore.subSessionMessageRegistryVersion || 0),
  ].join("|"),
);
watch(
  extensionContextDiagnosticsSignature,
  () => {
    logWorkflowDiagnostics("frontend.workflowRender.extensionContextProjected", () => {
      const context = extensionRendererContext.value;
      const sessions = context.subSessionMessageRegistry?.sessions || {};
      return {
        sessionId: String(props.messageItem?.sessionId || ""),
        dialogProcessId: String(props.messageItem?.dialogProcessId || ""),
        turnScopeId: String(props.messageItem?.turnScopeId || ""),
        subSessionMessageRegistryVersion: Number(context.subSessionMessageRegistryVersion || 0),
        subSessions: Object.values(sessions).map((session = {}) => ({
          sessionId: String(session?.sessionId || ""),
          messages: (Array.isArray(session?.messages) ? session.messages : []).map(
            (message = {}) => ({
              id: String(message?.id || message?.messageId || ""),
              role: String(message?.role || ""),
              contentLength: String(message?.content || "").length,
            }),
          ),
        })),
      };
    });
  },
  { flush: "post" },
);

function handleOpenThinkingDetails(payload = {}) {
  emit("open-thinking-details", {
    messageItem: props.messageItem,
    allMessages: props.allMessages,
    sessionDocs: props.sessionDocs,
    ...(payload && typeof payload === "object" ? payload : {}),
  });
}

function handleThinkingPanelVisibility(visible) {
  thinkingPanelVisible.value = visible === true;
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

function toggleAssistantContent() {
  setTurnAssistantContentExpanded(props.messageItem, !assistantContentExpanded.value);
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
    <div
      v-if="
        getMessageRole(messageItem) === 'assistant' &&
        (statusStepState || hasThinkingPanelContribution)
      "
      class="message-runtime-panels"
      :class="{
        'has-status-steps': Boolean(statusStepState),
        'has-thinking-panel': thinkingPanelVisible,
        'is-running': unifiedRuntimePanelsRunning,
      }"
    >
      <MessageStatusRow v-if="statusStepState" :status-step-state="statusStepState" />
      <ExtensionOutlet
        v-if="hasThinkingPanelContribution"
        :point="EXTENSION_POINTS.MESSAGE_CARD_PRE"
        :context="extensionRendererContext"
        :include-contribution-ids="thinkingPanelContributionIds"
        :extra-listeners="{
          openThinkingDetails: handleOpenThinkingDetails,
          panelVisibilityChange: handleThinkingPanelVisibility,
        }"
      />
    </div>
    <ExtensionOutlet
      :point="EXTENSION_POINTS.MESSAGE_CARD_PRE"
      :context="extensionRendererContext"
      :exclude-contribution-ids="thinkingPanelContributionIds"
      :extra-listeners="{ openThinkingDetails: handleOpenThinkingDetails }"
    />

    <BaseMessageErrorAlert :error="messageItem.error" />

    <AssistantCopyActions
      :visible="
        getMessageRole(messageItem) === 'assistant' &&
        Boolean(String(messageItem.content || '').trim())
      "
      :translate="translate"
      :on-copy-rich="handleCopyAssistantMessageRich"
      :on-copy-text="handleCopyAssistantMessageText"
      :content-expanded="assistantContentExpanded"
      :on-toggle-content="toggleAssistantContent"
    />

    <ExtensionOutlet
      :point="EXTENSION_POINTS.MESSAGE_ACTION_AFTER_PRE_CARDS"
      :context="extensionRendererContext"
    />

    <BaseMarkdownContent
      v-if="
        !hideMessageMarkdownForInlineEditor &&
        (getMessageRole(messageItem) !== 'assistant' || assistantContentExpanded)
      "
      ref="messageMarkdownRef"
      :content="messageItem.content"
      :render-markdown="renderMarkdown"
    />

    <ExtensionOutlet
      :point="EXTENSION_POINTS.MESSAGE_ACTION_POST_CONTENT"
      :context="extensionRendererContext"
    />

    <MonotonicMessageActions v-bind="defaultMonotonicMessageActionProps" />

    <BaseFileCardList v-if="!suppressDefaultAssets && displayedAttachments.length">
      <BaseAttachmentFileCard
        v-for="attachmentItem in displayedAttachments"
        :key="`attachment:${getAttachmentRenderKey(attachmentItem)}`"
        :attachment-item="attachmentItem"
        :user-id="userId"
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

<style scoped>
.message-runtime-panels {
  box-sizing: border-box;
  width: 100%;
  border-radius: var(--noobot-radius-xs);
  background: transparent;
}

.message-runtime-panels.is-running {
  animation: message-runtime-panels-glow 2.4s ease-in-out infinite;
}

@keyframes message-runtime-panels-glow {
  0%,
  100% {
    box-shadow:
      0 3px 12px color-mix(in srgb, var(--el-color-primary) 14%, transparent),
      0 0 6px color-mix(in srgb, var(--el-color-primary) 10%, transparent);
  }
  50% {
    box-shadow:
      0 4px 16px color-mix(in srgb, var(--el-color-primary) 22%, transparent),
      0 0 12px color-mix(in srgb, var(--el-color-primary) 18%, transparent);
  }
}
</style>
