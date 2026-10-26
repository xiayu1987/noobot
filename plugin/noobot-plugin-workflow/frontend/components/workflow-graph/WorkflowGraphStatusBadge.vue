<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { useWorkflowLocale } from "../../i18n/index.js";
import {
  resolveWorkflowNodeStatus,
  resolveWorkflowNodeStatusLabelKey,
} from "../../runtime/workflowRuntimeStatus.js";

const props = defineProps({
  status: { type: String, required: true },
});
const { translate } = useWorkflowLocale();

const statusLabel = computed(() =>
  translate(resolveWorkflowNodeStatusLabelKey({ status: props.status })),
);

const statusClass = computed(() => resolveWorkflowNodeStatus({ status: props.status }));
</script>

<template>
  <div class="workflow-node-status" :class="statusClass">
    {{ statusLabel }}
  </div>
</template>

<style scoped>
.workflow-node-status {
  border-radius: var(--noobot-radius-pill);
  padding: var(--noobot-space-3xs) var(--noobot-space-xs);
  font-size: var(--noobot-font-size-xs);
  border: 1px solid transparent;
  flex-shrink: 0;
  white-space: nowrap;
  line-height: var(--noobot-line-height-compact);
}

.workflow-node-status.succeeded {
  color: var(--noobot-status-success);
  background: color-mix(in srgb, var(--noobot-status-success) 12%, transparent);
  border-color: color-mix(in srgb, var(--noobot-status-success) 28%, transparent);
}

.workflow-node-status.failed,
.workflow-node-status.stopped {
  color: var(--noobot-status-error);
  background: color-mix(in srgb, var(--noobot-status-error) 12%, transparent);
  border-color: color-mix(in srgb, var(--noobot-status-error) 28%, transparent);
}

.workflow-node-status.running {
  color: var(--noobot-status-running);
  background: color-mix(in srgb, var(--noobot-status-running) 12%, transparent);
  border-color: color-mix(in srgb, var(--noobot-status-running) 28%, transparent);
}

.workflow-node-status.pending {
  color: var(--noobot-text-secondary);
  background: color-mix(in srgb, var(--noobot-status-idle) 10%, transparent);
  border-color: color-mix(in srgb, var(--noobot-status-idle) 20%, transparent);
}
</style>
