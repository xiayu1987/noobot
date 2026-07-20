<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { getActivePinia } from "pinia";
import { useChatStore } from "../shared/stores/useChatStore";
import ChatMessageItem from "../modules/message/ChatMessageItem.vue";

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
  return String(
    messageItem?.pluginMeta?.payload?.workflowRunId ||
    messageItem?.pluginMeta?.payload?.execution?.workflowRunId ||
    messageItem?.pluginMeta?.payload?.execution?.instanceId ||
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

</script>

<template>
  <template v-for="messageItem in liveWorkflowMessages" :key="messageItem.id">
    <div
      v-if="shouldRenderMessageInChat(messageItem)"
      :id="`workflow-live-${messageItem.pluginMeta.payload.workflowRunId}`"
      class="chat-message-anchor workflow-live-projection-anchor"
      :data-chat-message-anchor="`workflow-live-${messageItem.pluginMeta.payload.workflowRunId}`"
    >
      <ChatMessageItem
        v-bind="messageItemSharedProps"
        :all-messages="[...(activeSession?.messages || []), ...liveWorkflowMessages]"
        :message-item="messageItem"
      />
    </div>
  </template>
</template>
