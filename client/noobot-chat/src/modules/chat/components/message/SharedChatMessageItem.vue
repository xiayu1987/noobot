<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { Paperclip } from "@element-plus/icons-vue";
import { useMessagePreview } from "../../composables/message/useMessagePreview.js";
import { useMessageFiles } from "../../composables/message/useMessageFiles.js";
import {
  resolveAttachmentDisplayKey,
  resolveParsedResultAccessMeta,
} from "../../../../infrastructure/api/attachments/attachmentAccess.js";
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
import ExtensionOutlet from "../../../../extensions/components/ExtensionOutlet.vue";
import { resolveExtensionPoint } from "../../../../extensions/extension-registry.js";
import {
  logWorkflowDiagnostics,
  summarizeWorkflowMessage,
} from "../../../debug/loggers/workflowDiagnosticsLogger.js";
import { chatMessageItemProps } from "../../model/messageItemProps.js";
import FileMutationPreview from "../thinking/FileMutationPreview.vue";
import { selectCompletedToolArtifacts } from "../../runtime/engine/toolTimeline.js";
import { fileMutationPreviewService } from "../../../../infrastructure/api/fileMutation/fileMutationPreviewService.js";

const emit = defineEmits(["open-thinking-details"]);

function getAttachmentRenderKey(attachmentItem = {}) {
  return resolveAttachmentDisplayKey(attachmentItem);
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

const postMessageCardRenderers = computed(() =>
  resolveExtensionPoint(EXTENSION_POINTS.MESSAGE_CARD_POST, { messageItem: props.messageItem }),
);
const suppressDefaultAssets = computed(() =>
  postMessageCardRenderers.value.some((renderer = {}) => renderer?.suppressDefaultAssets === true),
);
const { displayedAttachments } = useMessageFiles({
  getMessageItem: () => props.messageItem,
  getAllMessages: () => props.allMessages,
  getSessionDocs: () => props.sessionDocs,
  getUserId: () => props.userId,
});
const completedToolArtifacts = computed(() => selectCompletedToolArtifacts(props.messageItem));
const writeMutations = computed(() => completedToolArtifacts.value.writeMutations);
const patchMutations = computed(() => completedToolArtifacts.value.patchMutations);
const artifactAttachments = computed(() =>
  suppressDefaultAssets.value ? [] : displayedAttachments.value,
);
const hasMessageArtifacts = computed(() =>
  (artifactAttachments.value.length > 0 || writeMutations.value.length > 0 || patchMutations.value.length > 0),
);
const artifactTab = ref("attachments");
watch(
  [() => artifactAttachments.value.length, () => writeMutations.value.length, () => patchMutations.value.length],
  () => {
    const availableTab = artifactAttachments.value.length
      ? "attachments"
      : writeMutations.value.length
        ? "write-files"
        : patchMutations.value.length
          ? "patch-files"
          : "attachments";
    const activeTabAvailable =
      (artifactTab.value === "attachments" && artifactAttachments.value.length > 0) ||
      (artifactTab.value === "write-files" && writeMutations.value.length > 0) ||
      (artifactTab.value === "patch-files" && patchMutations.value.length > 0);
    if (!activeTabAvailable) {
      artifactTab.value = availableTab;
    }
  },
  { immediate: true },
);
const mutationPreviewVisible = ref(false);
const mutationPreviewLoading = ref(false);
const mutationPreviewError = ref("");
const mutationPreviewMutation = ref(null);
const mutationPreviewKind = ref("file");
const mutationPreviewContent = ref("");
const mutationPreviewDiff = ref(null);
let mutationPreviewGeneration = 0;
const mutationPreviewDiffRows = computed(() => (mutationPreviewDiff.value?.lines || []).map((line) => ({
  old: line.type === "added" ? null : line,
  next: line.type === "removed" ? null : line,
})));
async function openMutationPreview({ mutation, kind } = {}) {
  const generation = ++mutationPreviewGeneration;
  const requestedMutation = mutation || null;
  const requestedKind = kind || "file";
  const requestedSessionId = getMessageSessionId(props.messageItem);
  mutationPreviewMutation.value = mutation || null;
  mutationPreviewKind.value = requestedKind;
  mutationPreviewVisible.value = true;
  mutationPreviewLoading.value = true;
  mutationPreviewError.value = "";
  mutationPreviewContent.value = "";
  mutationPreviewDiff.value = null;
  try {
    const payload = requestedKind === "diff"
      ? await fileMutationPreviewService.getDiff({ userId: props.userId, sessionId: requestedSessionId, sessionScope: requestedMutation?.sessionScope, mutationId: requestedMutation?.id })
      : await fileMutationPreviewService.getFile({ userId: props.userId, sessionId: requestedSessionId, sessionScope: requestedMutation?.sessionScope, mutationId: requestedMutation?.id });
    if (generation !== mutationPreviewGeneration) return;
    if (requestedKind === "diff") mutationPreviewDiff.value = payload.diff || payload;
    else mutationPreviewContent.value = String(payload.content || "");
  } catch (error) {
    if (generation !== mutationPreviewGeneration) return;
    mutationPreviewError.value = String(error?.message || error || translate("message.mutationLoadFailed"));
  } finally {
    if (generation === mutationPreviewGeneration) mutationPreviewLoading.value = false;
  }
}
async function downloadMutation(mutation = {}) {
  try {
    await fileMutationPreviewService.downloadFile({
      userId: props.userId,
      sessionId: getMessageSessionId(props.messageItem),
      sessionScope: mutation?.sessionScope,
      mutationId: mutation?.id,
      fileName: mutation?.path,
    });
  } catch (error) {
    ElMessage.error(String(error?.message || error || translate("message.downloadFailed")));
  }
}

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

    <el-tabs v-if="hasMessageArtifacts" v-model="artifactTab" class="message-artifact-tabs">
      <el-tab-pane v-if="artifactAttachments.length" :label="translate('message.artifactAttachments')" name="attachments">
        <BaseFileCardList>
          <BaseAttachmentFileCard
            v-for="attachmentItem in artifactAttachments"
            :key="`attachment:${getAttachmentRenderKey(attachmentItem)}`"
            :attachment-item="attachmentItem"
            :user-id="userId"
            :thumbnail-url="attachmentItem.thumbnailUrl || attachmentItem.previewUrl || ''"
            :is-image-mime="isImageMime"
            :can-preview-attachment="canPreviewAttachment"
            :can-preview-parsed-result="canPreviewParsedResult"
            :format-file-size="formatFileSize"
            :translate="translate"
            :preview-icon="Paperclip"
            show-parsed-result
            @preview="openAttachmentPreview"
            @download="onDownloadAttachment"
            @preview-parsed-result="openParsedResultPreview"
            @download-parsed-result="onDownloadParsedResult"
          />
        </BaseFileCardList>
      </el-tab-pane>
      <el-tab-pane v-if="writeMutations.length" :label="translate('message.artifactWriteFiles')" name="write-files">
        <FileMutationPreview
          v-if="writeMutations.length"
          :user-id="userId"
          :session-id="getMessageSessionId(messageItem)"
          :mutations="writeMutations"
          :service="fileMutationPreviewService"
          :translate="translate"
          compact
          preview-kind="file"
          @preview="openMutationPreview"
          @download="downloadMutation"
        />
      </el-tab-pane>
      <el-tab-pane v-if="patchMutations.length" :label="translate('message.artifactPatchFiles')" name="patch-files">
        <FileMutationPreview
          v-if="patchMutations.length"
          :user-id="userId"
          :session-id="getMessageSessionId(messageItem)"
          :mutations="patchMutations"
          :service="fileMutationPreviewService"
          :translate="translate"
          compact
          preview-kind="diff"
          @preview="openMutationPreview"
          @download="downloadMutation"
        />
      </el-tab-pane>
    </el-tabs>

    <ExtensionOutlet
      :point="EXTENSION_POINTS.MESSAGE_CARD_POST"
      :context="extensionRendererContext"
      :extra-listeners="{ openThinkingDetails: handleOpenThinkingDetails }"
    />
  </BaseMessageShell>

  <Teleport to="body">
    <el-dialog
      v-if="mutationPreviewVisible"
      v-model="mutationPreviewVisible"
      :title="translate('message.mutationPreviewTitle', { name: mutationPreviewMutation?.path || '' })"
      :teleported="false"
      modal-class="noobot-file-preview-overlay"
      class="generated-file-preview-dialog"
      destroy-on-close
    >
      <el-skeleton v-if="mutationPreviewLoading" :rows="5" animated />
      <el-alert v-else-if="mutationPreviewError" :title="mutationPreviewError" type="error" :closable="false" />
      <div v-else-if="mutationPreviewKind === 'diff' && mutationPreviewDiff" class="mutation-diff-split" role="table">
        <div class="mutation-diff-pane"><div class="mutation-diff-heading">{{ translate('message.mutationPreviewBefore') }}</div><div v-for="(row, index) in mutationPreviewDiffRows" :key="`modal-old-${index}`" class="mutation-diff-line" :class="row.old ? `is-${row.old.type}` : 'is-empty'"><span class="mutation-line-number">{{ row.old?.oldLine || "" }}</span><span class="mutation-line-sign">{{ row.old?.type === "removed" ? "-" : "" }}</span><code>{{ row.old?.text || "" }}</code></div></div>
        <div class="mutation-diff-pane"><div class="mutation-diff-heading">{{ translate('message.mutationPreviewAfter') }}</div><div v-for="(row, index) in mutationPreviewDiffRows" :key="`modal-new-${index}`" class="mutation-diff-line" :class="row.next ? `is-${row.next.type}` : 'is-empty'"><span class="mutation-line-number">{{ row.next?.newLine || "" }}</span><span class="mutation-line-sign">{{ row.next?.type === "added" ? "+" : "" }}</span><code>{{ row.next?.text || "" }}</code></div></div>
      </div>
      <pre v-else class="mutation-file-content">{{ mutationPreviewContent }}</pre>
    </el-dialog>

    <el-dialog
      v-model="attachmentPreviewVisible"
      :title="translate('message.attachmentPreviewTitle', { name: attachmentPreviewName || '' })"
      :teleported="false"
      modal-class="noobot-file-preview-overlay"
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
      :teleported="false"
      modal-class="noobot-file-preview-overlay"
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
  </Teleport>
</template>

<style src="../../../../shared/ui/file-mutation-preview-common.css"></style>

<style scoped>
.message-runtime-panels {
  box-sizing: border-box;
  width: 100%;
  border-radius: var(--noobot-radius-xs);
  background: transparent;
}
.message-artifact-tabs {
  margin-top: var(--noobot-space-md);
  padding: var(--noobot-space-xs);
  border: 1px solid var(--noobot-msg-file-card-border);
  border-radius: var(--noobot-radius-md);
  background: var(--noobot-msg-file-card-bg);
}
.message-artifact-tabs :deep(.el-tabs__header) { margin-bottom: var(--noobot-space-md); }
.message-artifact-tabs :deep(.el-tabs__nav-wrap) { padding-inline: var(--noobot-space-xs); }
.message-artifact-tabs :deep(.el-tabs__item) {
  box-sizing: border-box;
  height: 36px;
  line-height: 36px;
}
.message-artifact-tabs :deep(.el-tabs__content) {
  padding: var(--noobot-space-xs);
  background: var(--noobot-msg-file-card-bg);
}
.message-artifact-tabs :deep(.base-file-card-list) { margin-top: 0; }

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
