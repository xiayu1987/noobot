<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, watch } from "vue";
import { getActivePinia } from "pinia";
import { useChatStore } from "../shared/stores/useChatStore";
import { logWorkflowDiagnostics } from "../composables/chat/debug/workflowDiagnosticsLogger";
import {
  resolveMessageCardListeners,
  resolveMessageCardProps,
  resolveMessageCardRenderers,
} from "../plugins/frontend-plugin-registry";

const props = defineProps({
  activeSession: { type: Object, default: () => ({}) },
  shouldRenderMessageInChat: { type: Function, default: () => true },
  messageItemSharedProps: { type: Object, default: () => ({}) },
  anchorMessage: { type: Object, default: null },
});

// ThinkingPanel is also mounted in isolated contexts (unit tests, previews and
// plugin hosts) where the application Pinia may not exist. In that case there
// cannot be any live workflow state to project, so render an empty projection
// instead of making the entire thinking panel depend on Pinia.
const activePinia = getActivePinia();
const chatStore = activePinia ? useChatStore(activePinia) : null;

function workflowRunIdFromMessage(messageItem = {}) {
  // A turn-scoped assistant placeholder is persisted while the agent is still
  // thinking. It is not an acknowledgement of the workflow card. Only an
  // actual workflow entity may retire the live planning projection.
  if (messageItem?.type !== "workflow") return "";
  return String(
    messageItem?.pluginMeta?.payload?.workflowRunId ||
    messageItem?.pluginMeta?.payload?.execution?.workflowRunId ||
    messageItem?.pluginMeta?.payload?.execution?.instanceId ||
    messageItem?.workflowRunId ||
    messageItem?.turnScopeId ||
    "",
  ).trim();
}

// A persisted workflow card acknowledges the live projection synchronously.
// Derive this from the current prop instead of copying it through a watcher:
// the latter requires a second render tick after activeSession is replaced and
// can briefly leave both the live and persisted cards visible.
const persistedWorkflowRunIds = computed(() => new Set(
  Array.isArray(props.activeSession?.messages)
    ? props.activeSession.messages.map(workflowRunIdFromMessage).filter(Boolean)
    : [],
));

const liveWorkflowMessages = computed(() => {
  const activeSessionId = String(
    props.activeSession?.backendSessionId || props.activeSession?.id || "",
  ).trim();
  const anchorTurnScopeId = String(props.anchorMessage?.turnScopeId || "").trim();
  const anchorDialogProcessId = String(props.anchorMessage?.dialogProcessId || "").trim();

  const workflows = Object.values(chatStore?.workflowNodeStateRegistry?.workflows || {})
    .filter((workflow = {}) => {
      const workflowRunId = String(workflow?.workflowRunId || "").trim();
      const workflowSessionId = String(workflow?.sessionId || "").trim();
      return Boolean(
        workflowRunId &&
        !persistedWorkflowRunIds.value.has(workflowRunId) &&
        (!workflowSessionId || !activeSessionId || workflowSessionId === activeSessionId) &&
        (!anchorTurnScopeId || String(workflow?.turnScopeId || "").trim() === anchorTurnScopeId) &&
        (!anchorDialogProcessId || String(workflow?.dialogProcessId || "").trim() === anchorDialogProcessId),
      );
    })
    .map((workflow = {}) => ({
      id: `workflow-live:${workflow.workflowRunId}`,
      role: "assistant",
      type: "workflow",
      pluginMessage: true,
      dialogProcessId: workflow.dialogProcessId || "",
      turnScopeId: workflow.turnScopeId || "",
      // Use the same WORKFLOW_DSL/1 source as the persisted card.  The
      // workflow renderer will parse this through useWorkflowMeta, so the
      // planning projection and the persisted graph cannot drift apart.
      content: workflow.semanticText || "",
      __workflowLiveProjection: true,
      pluginMeta: {
        source: "workflow-plugin",
        kind: "workflow",
        phase: "planning",
        payload: {
          workflowRunId: workflow.workflowRunId,
          nodeSessions: Object.values(workflow.nodes || {}),
          planningDialog: {
            sessionId: workflow.sessionId || activeSessionId,
            dialogProcessId: workflow.dialogProcessId || "",
          },
          execution: {
            instanceId: workflow.workflowRunId,
            workflowRunId: workflow.workflowRunId,
            started: false,
          },
        },
      },
    }));

  // One thinking turn owns one planning surface. If planning is replaced in
  // the same turn, show the newest registry entry instead of stacking graphs.
  return workflows.slice(-1);
});

const liveWorkflowCards = computed(() => liveWorkflowMessages.value.flatMap((messageItem) =>
  resolveMessageCardRenderers(messageItem, { slot: "pre" }).map((renderer) => ({
    key: `${messageItem.id}:${renderer.id}`,
    messageItem,
    renderer,
  })),
));

function selectSessionMessages(sessionId = "") {
  const id = String(sessionId || "").trim();
  if (!id) return null;
  const subSession = chatStore?.selectSubSessionMessages?.(id);
  if (!subSession) return null;
  return {
    ...subSession,
    sessionId: String(subSession?.sessionId || subSession?.id || id).trim(),
    messages: Array.isArray(subSession?.messages) ? subSession.messages : [],
  };
}

function resolveCardContext(card = {}) {
  const sharedProps = props.messageItemSharedProps || {};
  return {
    ...sharedProps,
    messageItem: card.messageItem || {},
    allMessages: [
      ...(Array.isArray(props.activeSession?.messages) ? props.activeSession.messages : []),
      ...liveWorkflowMessages.value,
    ],
    workflowNodeStateRegistry: chatStore?.workflowNodeStateRegistry || null,
    turnRuntimeRegistry: chatStore?.turnRuntimeRegistry || null,
    selectExecutionDetail: chatStore?.selectExecutionDetail,
    selectSessionMessages,
    mergeSubSessionSnapshot: chatStore?.mergeSubSessionSnapshot,
    logWorkflowDiagnostics,
  };
}

function resolveCardProps(card = {}) {
  return resolveMessageCardProps(card.renderer, resolveCardContext(card));
}

function resolveCardListeners(card = {}) {
  return resolveMessageCardListeners(card.renderer, resolveCardContext(card));
}

watch(
  () => JSON.stringify({
    sessionId: String(props.activeSession?.backendSessionId || props.activeSession?.id || ""),
    anchorTurnScopeId: String(props.anchorMessage?.turnScopeId || ""),
    anchorDialogProcessId: String(props.anchorMessage?.dialogProcessId || ""),
    persistedWorkflowRunIds: [...persistedWorkflowRunIds.value],
    registryWorkflows: Object.values(chatStore?.workflowNodeStateRegistry?.workflows || {}).map((item = {}) => ({
      workflowRunId: String(item?.workflowRunId || ""),
      sessionId: String(item?.sessionId || ""),
      dialogProcessId: String(item?.dialogProcessId || ""),
      turnScopeId: String(item?.turnScopeId || ""),
      nodeCount: Object.keys(item?.nodes || {}).length,
    })),
    projectedWorkflowRunIds: liveWorkflowMessages.value.map((item) => item.pluginMeta.payload.workflowRunId),
  }),
  (signature) => {
    const snapshot = JSON.parse(signature);
    logWorkflowDiagnostics("frontend.workflowRender.liveProjectionEvaluated", {
      sessionId: snapshot.sessionId,
      dialogProcessId: snapshot.anchorDialogProcessId,
      turnScopeId: snapshot.anchorTurnScopeId,
      ...snapshot,
    });
  },
  { immediate: true },
);

</script>

<template>
  <template v-for="card in liveWorkflowCards" :key="card.key">
    <div
      v-if="shouldRenderMessageInChat(card.messageItem)"
      :id="`workflow-live-${card.messageItem.pluginMeta.payload.workflowRunId}`"
      class="chat-message-anchor workflow-live-projection-anchor"
      :data-chat-message-anchor="`workflow-live-${card.messageItem.pluginMeta.payload.workflowRunId}`"
      :data-workflow-run-id="card.messageItem.pluginMeta.payload.workflowRunId"
    >
      <component
        :is="card.renderer.component"
        v-bind="resolveCardProps(card)"
        v-on="resolveCardListeners(card)"
      />
    </div>
  </template>
</template>
