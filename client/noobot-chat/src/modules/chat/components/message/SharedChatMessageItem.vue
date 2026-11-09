<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, useId, watch, onBeforeUnmount } from "vue";
import { ElMessage } from "element-plus";
import { Paperclip } from "@element-plus/icons-vue";
import { useMessagePreview } from "../../composables/message/useMessagePreview.js";
import {
  collectSessionAttachments,
  collectSessionLinkSnapshots,
  sessionMessageIndex,
  useMessageFiles,
} from "../../composables/message/useMessageFiles.js";
import {
  resolveAttachmentDisplayKey,
  resolveParsedResultRelation,
} from "../../../../infrastructure/api/attachments/attachmentAccess.js";
import { buildAttachmentRefIndex } from "../../composables/message/attachmentInlineRefPlugin.js";
import { outOfSessionRenderContext } from "../../composables/message/useMarkdownRenderer.js";
import { useMessageMeta } from "../../composables/message/useMessageMeta.js";
import { resolveMessageViewKey } from "@noobot/event-protocol/message-event";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageSessionId,
  getMessageTurnScopeId,
} from "../../model/messageIdentity.js";
import { selectTurnMessageRuntime } from "../../runtime/run-state-machine/turnRuntimeRegistry.js";
import { resolveTurnRuntimeView } from "../../runtime/run-state-machine/messageRuntime.js";
import { isTerminalStatusStepState } from "../../runtime/sessionRunStateMachine.js";
import {
  getTurnUiState,
  setTurnAssistantContentExpanded,
} from "../../runtime/engine/turnUiStore.js";
import { useLocale } from "../../../../shared/i18n/useLocale.js";
import BaseFilePreviewDrawer from "../../../../shared/ui/BaseFilePreviewDrawer.vue";
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
import {
  EXTENSION_POINTS,
  requireMessageCardHostCapabilities,
} from "@noobot/plugin-protocol/frontend";
import ExtensionOutlet from "../../../../extensions/components/ExtensionOutlet.vue";
import { resolveExtensionPoint } from "../../../../extensions/extension-registry.js";
import {
  logWorkflowDiagnostics,
  summarizeWorkflowMessage,
} from "../../../debug/loggers/workflowDiagnosticsLogger.js";
import { chatMessageItemProps } from "../../model/messageItemProps.js";
import { isWorkflowNodeTurnScopeId } from "@noobot/session-protocol/turn-scope-identity";
import FileMutationPreview from "../thinking/FileMutationPreview.vue";
import ThinkingPanel from "../thinking/ThinkingPanel.vue";
import MutationDiffSplit from "../thinking/MutationDiffSplit.vue";
import MutationFileContent from "../thinking/MutationFileContent.vue";
import { selectCompletedToolArtifacts } from "../../runtime/engine/toolTimeline.js";
import { fileMutationPreviewService } from "../../../../infrastructure/api/fileMutation/fileMutationPreviewService.js";
import { text } from "@noobot/shared/value";
import "../../../../shared/ui/file-mutation-preview-common.css";

const emit = defineEmits(["open-thinking-details"]);

function getAttachmentRenderKey(attachmentItem = {}) {
  return resolveAttachmentDisplayKey(attachmentItem);
}

const props = defineProps(chatMessageItemProps);

const {
  attachmentPreviewVisible,
  attachmentPreviewDescriptor,
  attachmentPreviewUrl,
  attachmentPreviewName,
  attachmentPreviewLoading,
  attachmentPreviewError,
  attachmentPreviewTextContent,
  canPreviewAttachment,
  canPreviewParsedResult,
  openAttachmentPreview,
  openParsedResultPreview,
  openResolvedAttachmentPreview,
  closeAttachmentPreview,
  onDownloadAttachment,
  onDownloadParsedResult,
  onCopyAttachmentMarkdownRich,
  onCopyAttachmentMarkdownText,
  onCopyMessageMarkdownRich,
  onCopyMessageMarkdownText,
} = useMessagePreview({
  userId: props.userId,
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
});
const completedToolArtifacts = computed(() => selectCompletedToolArtifacts(props.messageItem));
const writeMutations = computed(() => completedToolArtifacts.value.writeMutations);
const patchMutations = computed(() => completedToolArtifacts.value.patchMutations);
const artifactAttachments = computed(() =>
  suppressDefaultAssets.value ? [] : displayedAttachments.value,
);

const attachmentRefIndex = computed(() =>
  buildAttachmentRefIndex(
    collectSessionAttachments(props.allMessages, props.messageItem, displayedAttachments.value),
    { userId: props.userId },
  ),
);
const linkSnapshots = computed(() => collectSessionLinkSnapshots(props.allMessages));
const messageIndex = computed(() => sessionMessageIndex(props.allMessages, props.messageItem));

const workspaceRootDirectory = computed(() => props.messageItem.workspaceRootDirectory ?? null);

const renderPreviewMarkdown = (content) =>
  props.renderMarkdown(content, outOfSessionRenderContext(translate));

const artifactTabs = computed(() =>
  [
    {
      name: "attachments",
      labelKey: "message.artifactAttachments",
      count: artifactAttachments.value.length,
    },
    {
      name: "write-files",
      labelKey: "message.artifactWriteFiles",
      count: writeMutations.value.length,
    },
    {
      name: "patch-files",
      labelKey: "message.artifactPatchFiles",
      count: patchMutations.value.length,
    },
  ].filter((tab) => tab.count > 0),
);
const selectedArtifactTab = ref("");
const activeArtifactTab = computed(() =>
  artifactTabs.value.some((tab) => tab.name === selectedArtifactTab.value)
    ? selectedArtifactTab.value
    : artifactTabs.value[0]?.name,
);
const artifactTabsDomId = useId();
const ARTIFACT_TAB_KEY_STEP = Object.freeze({ ArrowRight: 1, ArrowLeft: -1 });
function onArtifactTabKeydown(event) {
  const step = ARTIFACT_TAB_KEY_STEP[event.key];
  if (!step) return;
  event.preventDefault();
  const tabs = artifactTabs.value;
  const currentIndex = tabs.findIndex((tab) => tab.name === activeArtifactTab.value);
  const nextTab = tabs[(currentIndex + step + tabs.length) % tabs.length];
  selectedArtifactTab.value = nextTab.name;
  event.currentTarget.parentElement.querySelector(`[data-tab-name="${nextTab.name}"]`).focus();
}
const mutationPreviewVisible = ref(false);
const mutationPreviewLoading = ref(false);
const mutationPreviewError = ref("");
const mutationPreviewMutation = ref(null);
const mutationPreviewKind = ref("file");
const mutationPreviewContent = ref("");
const mutationPreviewDiff = ref(null);
let mutationPreviewGeneration = 0;
let mutationPreviewController = null;
function cancelMutationPreview() {
  mutationPreviewGeneration += 1;
  mutationPreviewController?.abort();
  mutationPreviewController = null;
}
watch(
  mutationPreviewVisible,
  (visible) => {
    if (!visible) cancelMutationPreview();
  },
  { flush: "sync" },
);
onBeforeUnmount(cancelMutationPreview);
async function openMutationPreview({ mutation, kind } = {}) {
  cancelMutationPreview();
  const generation = mutationPreviewGeneration;
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
  if (requestedKind === "file") {
    mutationPreviewLoading.value = false;
    return;
  }
  const controller = new AbortController();
  mutationPreviewController = controller;
  try {
    const payload = await fileMutationPreviewService.getDiff({
      userId: props.userId,
      sessionId: requestedSessionId,
      sessionScope: requestedMutation?.sessionScope,
      mutationId: requestedMutation?.mutationId,
      signal: controller.signal,
    });
    if (generation !== mutationPreviewGeneration) return;

    mutationPreviewDiff.value = payload.diff;
    if (payload.diff === null)
      mutationPreviewContent.value = translate("message.mutationBinaryDiff");
  } catch (error) {
    if (generation !== mutationPreviewGeneration) return;
    mutationPreviewError.value = String(
      error?.message || error || translate("message.mutationLoadFailed"),
    );
  } finally {
    if (generation === mutationPreviewGeneration) mutationPreviewLoading.value = false;
  }
}
async function downloadMutation(mutationRef) {
  try {
    await fileMutationPreviewService.downloadFile({
      userId: props.userId,
      sessionId: getMessageSessionId(props.messageItem),
      mutationRef,
    });
  } catch (error) {
    ElMessage.error(String(error?.message || error || translate("message.downloadFailed")));
  }
}

function onFileLinkError(error) {
  ElMessage.error(translate("message.fileLinkFailed", { reason: String(error?.message || error) }));
}

watch(
  () =>
    displayedAttachments.value.map((attachment) => ({
      attachmentId: text(attachment?.attachmentId),
      parsedResultTargetIdentity: resolveParsedResultRelation(attachment)?.targetIdentity || null,
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
    runtime: realtimeRuntime ?? undefined,
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
const isAssistantMessage = computed(() => getMessageRole(props.messageItem) === "assistant");
const thinkingPanelVisible = ref(false);
const statusStepRunning = computed(() =>
  Boolean(statusStepState.value && !isTerminalStatusStepState(statusStepState.value)),
);
const unifiedRuntimePanelsRunning = computed(
  () => statusStepRunning.value && thinkingPanelVisible.value,
);
const workflowChildRenderDiagnosticsSignature = computed(() => {
  const turnScopeId = getMessageTurnScopeId(props.messageItem);
  const parentSessionId = text(props.messageItem?.parentSessionId);
  if (!parentSessionId && !isWorkflowNodeTurnScopeId(turnScopeId)) return "";
  const runtime = messageRuntime.value || {};
  return JSON.stringify({
    sessionId: getMessageSessionId(props.messageItem),
    parentSessionId,
    dialogProcessId: getMessageDialogProcessId(props.messageItem),
    turnScopeId,
    messageViewKey: resolveMessageViewKey(props.messageItem),
    pending: props.messageItem?.pending === true,
    statusStepState: String(statusStepState.value || ""),
    statusStepRunning: statusStepRunning.value,
    thinkingPanelVisible: thinkingPanelVisible.value,
    breathing: unifiedRuntimePanelsRunning.value,
    runtimeState: String(runtime?.state || ""),
    runtimeStartedAt: String(runtime?.startedAt || ""),
    runtimeFinishedAt: String(runtime?.finishedAt || ""),
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

const hideMessageMarkdownForInlineEditor = computed(
  () =>
    getMessageRole(props.messageItem) === "user" && props.messageItem?.__monotonicEditing === true,
);
const defaultMonotonicMessageActionProps = computed(() =>
  resolveMonotonicMessageActionProps(resolveRendererContext()),
);

function resolveRendererContext() {
  const selectSessionMessages = (sessionId) => chatStore.selectSubSessionMessages(sessionId);
  return requireMessageCardHostCapabilities({
    messageItem: props.messageItem,
    allMessages: props.allMessages,
    messageRuntime: messageRuntime.value,
    workflowNodeStateRegistry: chatStore.workflowNodeStateRegistry,

    subSessionMessageRegistry: chatStore.subSessionMessageRegistry,
    subSessionMessageRegistryVersion: chatStore.subSessionMessageRegistryVersion,
    turnRuntimeRegistry: chatStore.turnRuntimeRegistry,
    selectExecutionDetail: chatStore.selectExecutionDetail,
    stopExecution: props.stopExecution,
    fetchExecutionReport: props.fetchExecutionReport,
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
    canPreviewAttachment,
    canPreviewParsedResult,
    onOpenAttachmentPreview: openAttachmentPreview,
    onOpenParsedResultPreview: openParsedResultPreview,
    onOpenResolvedAttachmentPreview: openResolvedAttachmentPreview,
    onDownloadAttachment,
    onOpenThinkingDetails: handleOpenThinkingDetails,
  });
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
              messageViewKey: resolveMessageViewKey(message),
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

function handleCopyAssistantMessageRich() {
  onCopyMessageMarkdownRich({
    textContent: props.messageItem.content,
    attachmentRefIndex: attachmentRefIndex.value,
    linkSnapshots: linkSnapshots.value,
    messageIndex: messageIndex.value,
    workspaceRootDirectory: workspaceRootDirectory.value,
  });
}

function handleCopyAssistantMessageText() {
  onCopyMessageMarkdownText(props.messageItem.content);
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
    <template #before-content>
      <BaseMessageTypeTag :type="messageItem.type" />
      <div
        v-if="isAssistantMessage"
        class="message-runtime-panels"
        :class="{
          'has-status-steps': Boolean(statusStepState),
          'has-thinking-panel': thinkingPanelVisible,
          'is-running': unifiedRuntimePanelsRunning,
        }"
      >
        <MessageStatusRow v-if="statusStepState" :status-step-state="statusStepState" />
        <ThinkingPanel
          :message-item="messageItem"
          :all-messages="allMessages"
          :runtime="messageRuntime"
          :user-id="userId"
          :fetch-execution-report="fetchExecutionReport"
          @open-thinking-details="handleOpenThinkingDetails"
          @panel-visibility-change="handleThinkingPanelVisibility"
        />
      </div>
    </template>
    <ExtensionOutlet
      :point="EXTENSION_POINTS.MESSAGE_CARD_PRE"
      :context="extensionRendererContext"
      :extra-listeners="{ openThinkingDetails: handleOpenThinkingDetails }"
    />

    <BaseMessageErrorAlert :error="messageItem.error" />
    <BaseMessageErrorAlert
      v-if="messageItem.toolArtifactConflict"
      :error="translate('message.toolArtifactConflict')"
    />

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
      :content="messageItem.content"
      :render-markdown="renderMarkdown"
      :attachment-ref-index="attachmentRefIndex"
      :link-snapshots="linkSnapshots"
      :message-index="messageIndex"
      :workspace-root-directory="workspaceRootDirectory"
      :translate="translate"
      @download-attachment="onDownloadAttachment"
      @download-mutation="downloadMutation"
      @link-error="onFileLinkError"
    />

    <ExtensionOutlet
      :point="EXTENSION_POINTS.MESSAGE_ACTION_POST_CONTENT"
      :context="extensionRendererContext"
    />

    <MonotonicMessageActions v-bind="defaultMonotonicMessageActionProps" />

    <template #after-content>
      <section v-if="artifactTabs.length" class="message-artifact-tabs">
        <div
          class="message-artifact-tabs__nav"
          role="tablist"
          :aria-label="translate('message.artifactTabs')"
        >
          <button
            v-for="tab in artifactTabs"
            :id="`${artifactTabsDomId}-tab-${tab.name}`"
            :key="tab.name"
            type="button"
            role="tab"
            class="message-artifact-tabs__tab"
            :class="{ 'is-active': tab.name === activeArtifactTab }"
            :data-tab-name="tab.name"
            :aria-selected="tab.name === activeArtifactTab ? 'true' : 'false'"
            :aria-controls="`${artifactTabsDomId}-panel`"
            :tabindex="tab.name === activeArtifactTab ? 0 : -1"
            @click="selectedArtifactTab = tab.name"
            @keydown="onArtifactTabKeydown"
          >
            {{ translate(tab.labelKey) }}
          </button>
        </div>
        <div
          :id="`${artifactTabsDomId}-panel`"
          class="message-artifact-tabs__panel"
          role="tabpanel"
          :aria-labelledby="`${artifactTabsDomId}-tab-${activeArtifactTab}`"
        >
          <BaseFileCardList v-if="activeArtifactTab === 'attachments'" embedded>
            <BaseAttachmentFileCard
              v-for="attachmentItem in artifactAttachments"
              :key="`attachment:${getAttachmentRenderKey(attachmentItem)}`"
              :attachment-item="attachmentItem"
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
          <FileMutationPreview
            v-else-if="activeArtifactTab === 'write-files'"
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
          <FileMutationPreview
            v-else
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
        </div>
      </section>

      <ExtensionOutlet
        :point="EXTENSION_POINTS.MESSAGE_CARD_POST"
        :context="extensionRendererContext"
        :extra-listeners="{ openThinkingDetails: handleOpenThinkingDetails }"
      />
    </template>
  </BaseMessageShell>

  <BaseFilePreviewDrawer
    v-model="mutationPreviewVisible"
    :title="translate('message.mutationPreviewTitle', { name: mutationPreviewMutation?.fileName })"
    class="generated-file-preview-drawer"
  >
    <MutationFileContent
      v-if="mutationPreviewVisible && mutationPreviewKind === 'file' && mutationPreviewMutation"
      :mutation="mutationPreviewMutation"
      :user-id="props.userId"
      :session-id="getMessageSessionId(props.messageItem)"
      :service="fileMutationPreviewService"
      :translate="translate"
    />
    <el-skeleton v-else-if="mutationPreviewLoading" :rows="5" animated />
    <el-alert
      v-else-if="mutationPreviewError"
      :title="mutationPreviewError"
      type="error"
      :closable="false"
    />
    <MutationDiffSplit
      v-else-if="mutationPreviewKind === 'diff' && mutationPreviewDiff"
      :diff="mutationPreviewDiff"
      :translate="translate"
      key-prefix="preview-"
    />
    <pre v-else class="mutation-file-content">{{ mutationPreviewContent }}</pre>
  </BaseFilePreviewDrawer>

  <BaseFilePreviewDrawer
    v-model="attachmentPreviewVisible"
    :title="translate('message.attachmentPreviewTitle', { name: attachmentPreviewName || '' })"
    @closed="closeAttachmentPreview"
  >
    <BasePreviewContent
      :active="attachmentPreviewVisible"
      :descriptor="attachmentPreviewDescriptor"
      :url="attachmentPreviewUrl"
      :loading="attachmentPreviewLoading"
      :error="attachmentPreviewError"
      :text-content="attachmentPreviewTextContent"
      :render-markdown="renderPreviewMarkdown"
      @copy-markdown-rich="onCopyAttachmentMarkdownRich"
      @copy-markdown-text="onCopyAttachmentMarkdownText"
    />
  </BaseFilePreviewDrawer>
</template>

<style scoped>
.message-runtime-panels {
  box-sizing: border-box;
  width: 100%;
  border-radius: var(--noobot-radius-xs);
  background: transparent;
  border: 1px solid transparent;
}
.message-artifact-tabs {
  margin-top: var(--noobot-space-md);
  padding: var(--noobot-space-xs);
  border: 1px solid var(--noobot-msg-file-card-border);
  border-radius: var(--noobot-radius-md);
  background: var(--noobot-msg-file-card-bg);
}
.message-artifact-tabs__nav {
  display: flex;
  margin-bottom: var(--noobot-space-md);
  padding-inline: var(--noobot-space-xs);
  overflow-x: auto;
  scrollbar-width: none;
}
.message-artifact-tabs__tab {
  box-sizing: border-box;
  flex: 0 0 auto;
  height: var(--noobot-control-height-md);
  padding: 0 var(--noobot-space-md);
  color: var(--noobot-text-secondary);
  font: inherit;
  font-size: var(--noobot-font-size-md);
  font-weight: var(--noobot-font-weight-medium);
  line-height: var(--noobot-control-height-md);
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition:
    color var(--noobot-duration-normal) var(--noobot-ease-standard),
    border-color var(--noobot-duration-normal) var(--noobot-ease-standard);
}
.message-artifact-tabs__tab:hover {
  color: var(--noobot-text-strong);
}
.message-artifact-tabs__tab.is-active {
  color: var(--noobot-text-strong);
  font-weight: var(--noobot-font-weight-semibold);
  border-bottom-color: var(--noobot-accent);
}
.message-artifact-tabs__tab:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--noobot-accent-border);
  border-radius: var(--noobot-radius-xs);
}
.message-artifact-tabs__panel {
  padding: var(--noobot-space-xs);
  background: var(--noobot-msg-file-card-bg);
}

.message-runtime-panels.is-running {
  animation: message-runtime-panels-glow var(--noobot-duration-breathe) var(--noobot-ease-in-out)
    infinite;
}

@keyframes message-runtime-panels-glow {
  0%,
  100% {
    border-color: var(--noobot-runtime-border);
    box-shadow: var(--noobot-runtime-glow);
  }
  50% {
    border-color: var(--noobot-runtime-border-peak);
    box-shadow: var(--noobot-runtime-glow-peak);
  }
}
</style>
