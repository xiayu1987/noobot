<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";

const props = defineProps({
  sending: { type: Boolean, default: false },
  interactionSubmitting: { type: Boolean, default: false },
  pendingInteractionRequest: { type: Object, default: null },
  conversationStateSnapshot: { type: Object, default: () => ({}) },
  conversationStateTimeline: { type: Array, default: () => [] },
});

const snapshotList = computed(() =>
  Object.values(props.conversationStateSnapshot || {}).sort(
    (left, right) => String(right?.updatedAt || "").localeCompare(String(left?.updatedAt || "")),
  ),
);
</script>

<template>
  <details class="conversation-state-debug">
    <summary>状态机调试面板</summary>
    <div class="state-row">
      <span>sending: {{ sending }}</span>
      <span>interactionSubmitting: {{ interactionSubmitting }}</span>
      <span>pendingRequestId: {{ pendingInteractionRequest?.requestId || "-" }}</span>
      <span>pendingDialogProcessId: {{ pendingInteractionRequest?.dialogProcessId || "-" }}</span>
    </div>
    <div class="state-block">
      <h4>State Snapshot</h4>
      <pre>{{ JSON.stringify(snapshotList, null, 2) }}</pre>
    </div>
    <div class="state-block">
      <h4>State Timeline (latest 80)</h4>
      <pre>{{ JSON.stringify(conversationStateTimeline || [], null, 2) }}</pre>
    </div>
  </details>
</template>

<style scoped>
.conversation-state-debug {
  border-top: 1px dashed var(--noobot-divider);
  padding: 8px 12px;
  background: var(--noobot-surface-sidebar);
}

.conversation-state-debug summary {
  cursor: pointer;
  font-size: var(--noobot-font-size-sm);
  color: var(--noobot-text-secondary);
}

.state-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
  font-size: var(--noobot-font-size-sm);
}

.state-block h4 {
  margin: 8px 0 4px;
  font-size: var(--noobot-font-size-sm);
}

.state-block pre {
  margin: 0;
  max-height: 160px;
  overflow: auto;
  font-size: var(--noobot-font-size-xs);
  background: var(--noobot-panel-bg);
  border: 1px solid var(--noobot-divider);
  border-radius: var(--noobot-radius-xs);
  padding: 6px;
}
</style>
