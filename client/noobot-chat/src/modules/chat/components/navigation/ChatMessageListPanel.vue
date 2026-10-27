<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch } from "vue";
import ChatMessageItem from "../message/ChatMessageItem.vue";
import { useChatStore } from "../../stores/useChatStore.js";
import {
  isWorkflowDiagnosticsEnabled,
  logWorkflowDiagnostics,
  summarizeWorkflowMessages,
} from "../../../debug/loggers/workflowDiagnosticsLogger.js";
import {
  isStateMachineDebugEnabled,
  logStateMachineDebug,
  summarizeStateMachineMessage,
} from "../../../debug/loggers/stateMachineLogger.js";
import { useLocale } from "../../../../shared/i18n/useLocale.js";
import { getMessageRole, getMessageTurnScopeKey } from "../../model/messageIdentity.js";
import { getMessageAnchorId, getMessageRenderKey } from "../../model/messageAnchor.js";
import { sharedMessageRenderProps } from "../../model/messageItemProps.js";
import SessionArtifactPanel from "../artifacts/SessionArtifactPanel.vue";
import { isCanonicalText } from "@noobot/shared/value";
import {
  EMPTY_TURN_PRESENTATIONS,
  selectTurnPresentations,
} from "../../runtime/engine/turnPresentation.js";

defineEmits(["open-thinking-details"]);

const props = defineProps({
  loadingSessionDetail: { type: Boolean, default: false },
  activeSession: { type: [Object, null], required: true },
  shouldRenderMessageInChat: { type: Function, required: true },
  ...sharedMessageRenderProps,
  emptyLogoSrc: { type: String, default: "" },
});

const listRef = ref(null);
const { translate } = useLocale();
const chatStore = useChatStore();
const presentedMessages = computed(() =>
  props.activeSession === null
    ? EMPTY_TURN_PRESENTATIONS
    : selectTurnPresentations({
        activeSession: props.activeSession,
        workflowRegistry: chatStore.workflowNodeStateRegistry,
        turnRuntimeRegistry: chatStore.turnRuntimeRegistry,
      }),
);
function summarizeActiveSessionSource() {
  return props.activeSession === null
    ? { sessionId: "", sourceMessageCount: 0 }
    : {
        sessionId: props.activeSession.sessionId,
        sourceMessageCount: props.activeSession.messages.length,
      };
}
const presentationDiagnosticsSignature = computed(() =>
  !isWorkflowDiagnosticsEnabled()
    ? "disabled"
    : [
        ...Object.values(summarizeActiveSessionSource()),
        presentedMessages.value.length,
        Number(chatStore.workflowNodeStateRegistry?.version || 0),
        Number(chatStore.subSessionMessageRegistryVersion || 0),
      ].join("|"),
);
watch(
  presentationDiagnosticsSignature,
  () => {
    logWorkflowDiagnostics("frontend.workflowRender.turnPresentationsSelected", () => ({
      ...summarizeActiveSessionSource(),
      presentationMessageCount: presentedMessages.value.length,
      workflowPresentations: summarizeWorkflowMessages(presentedMessages.value),
    }));
  },
  { flush: "post" },
);
const messageItemSharedProps = computed(() => ({
  allMessages: presentedMessages.value,
  sessionDocs: props.activeSession === null ? [] : props.activeSession.sessionDocs,
  userId: props.userId,
  renderMarkdown: props.renderMarkdown,
  formatTime: props.formatTime,
  formatFileSize: props.formatFileSize,
  isImageMime: props.isImageMime,
  sending: props.sending,
  deleteMonotonicMessage: props.deleteMonotonicMessage,
  resendMonotonicMessage: props.resendMonotonicMessage,
  stopExecution: props.stopExecution,
  fetchExecutionReport: props.fetchExecutionReport,
}));
const currentAssistantMessage = computed(() => {
  for (let index = presentedMessages.value.length - 1; index >= 0; index -= 1) {
    const messageItem = presentedMessages.value[index];
    if (getMessageRole(messageItem) === "assistant") return messageItem;
  }
  return null;
});

function isCurrentTurnMessage(messageItem = {}) {
  const current = currentAssistantMessage.value;
  if (!current || getMessageRole(messageItem) !== "assistant") return false;
  const currentTurnKey = getMessageTurnScopeKey(current);
  const candidateTurnKey = getMessageTurnScopeKey(messageItem);
  return currentTurnKey && candidateTurnKey
    ? currentTurnKey === candidateTurnKey
    : current === messageItem;
}

function getWrapRef() {
  return listRef.value.wrapRef;
}

const renderedMessages = computed(() =>
  presentedMessages.value
    .map((messageItem, sourceIndex) => ({
      messageItem,
      sourceIndex,
      renderKey: getMessageRenderKey(messageItem, sourceIndex),
    }))
    .filter(({ messageItem }) => props.shouldRenderMessageInChat(messageItem)),
);
const renderDiagnosticsSignature = computed(() =>
  !isStateMachineDebugEnabled()
    ? "disabled"
    : JSON.stringify(
        renderedMessages.value.map((entry) => ({
          ...summarizeStateMachineMessage(entry.messageItem),
          sourceIndex: entry.sourceIndex,
          renderKey: entry.renderKey,
        })),
      ),
);
watch(
  renderDiagnosticsSignature,
  (signature) => {
    logStateMachineDebug("stateMachine.presentation.renderList.committed", () => ({
      ...summarizeActiveSessionSource(),
      presentationMessageCount: presentedMessages.value.length,
      renderedMessageCount: renderedMessages.value.length,
      messages: JSON.parse(signature),
    }));
  },
  { immediate: true, flush: "post" },
);

function scrollToMessageAnchor(anchorId) {
  if (!isCanonicalText(anchorId)) throw new TypeError("scrollToMessageAnchor requires anchorId");
  const wrapRef = getWrapRef();
  const target = wrapRef.querySelector(`#${CSS.escape(anchorId)}`);
  if (!target) return false;
  const offset = 16;
  const nextTop = target.offsetTop - offset;
  wrapRef.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
  return true;
}

defineExpose({
  getWrapRef,
  scrollToMessageAnchor,
});
</script>

<template>
  <div class="message-container">
    <el-scrollbar ref="listRef" class="msg-list">
      <div class="msg-list-inner">
        <el-skeleton
          v-if="loadingSessionDetail && !presentedMessages.length"
          :rows="6"
          animated
          class="skeleton-loading noobot-surface-card"
        />

        <div v-if="!presentedMessages.length && !loadingSessionDetail" class="empty-state">
          <div class="empty-icon">
            <img :src="emptyLogoSrc" alt="Noobot Logo" class="empty-logo" />
          </div>
          <p>{{ translate("common.emptyChatHint") }}</p>
        </div>

        <template
          v-for="{ messageItem, sourceIndex, renderKey } in renderedMessages"
          :key="renderKey"
        >
          <div
            :id="getMessageAnchorId(messageItem, sourceIndex)"
            class="chat-message-anchor"
            :data-chat-message-anchor="getMessageAnchorId(messageItem, sourceIndex)"
          >
            <ChatMessageItem
              v-bind="messageItemSharedProps"
              :message-item="messageItem"
              :current-turn="isCurrentTurnMessage(messageItem)"
              @open-thinking-details="$emit('open-thinking-details', $event)"
            />
          </div>
        </template>
      </div>
    </el-scrollbar>
    <SessionArtifactPanel v-if="activeSession !== null" :session-id="activeSession.sessionId" />
  </div>
</template>

<style scoped>
.message-container {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

.msg-list {
  height: 100%;
}

.msg-list-inner {
  padding: var(--noobot-space-2xl) max(var(--noobot-space-2xl), calc(50% - 400px));
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-2xl);
}

.chat-message-anchor {
  content-visibility: auto;
  contain-intrinsic-size: auto 180px;
}

.skeleton-loading {
  padding: var(--noobot-space-xl);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 40vh;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-lg);
}

.empty-icon {
  margin-bottom: var(--noobot-space-xl);
  opacity: 0.8;
}

.empty-logo {
  width: 52px;
  height: 52px;
  display: block;
}

@media (max-width: 768px) {
  .msg-list-inner {
    padding: var(--noobot-space-lg) max(var(--noobot-space-md), env(safe-area-inset-left))
      var(--noobot-space-lg) max(var(--noobot-space-md), env(safe-area-inset-right));
    gap: var(--noobot-space-xs);
  }
}
</style>
