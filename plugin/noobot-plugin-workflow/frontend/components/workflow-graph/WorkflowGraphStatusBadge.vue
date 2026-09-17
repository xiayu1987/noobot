<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { useWorkflowLocale } from "../../i18n/index.js";

const props = defineProps({
  status: { type: String, default: "pending" },
});
const { translate } = useWorkflowLocale();

const normalizedStatus = computed(() =>
  String(props.status || "")
    .trim()
    .toLowerCase(),
);

const statusLabel = computed(() => {
  if (normalizedStatus.value === "success") return translate("workflow.statusSuccess");
  if (normalizedStatus.value === "failed" || normalizedStatus.value === "error") {
    return translate("workflow.statusFailed");
  }
  if (normalizedStatus.value === "running") return translate("workflow.statusRunning");
  return translate("workflow.statusPending");
});

const statusClass = computed(() => {
  if (normalizedStatus.value === "success") return "success";
  if (normalizedStatus.value === "failed" || normalizedStatus.value === "error") return "failed";
  if (normalizedStatus.value === "running") return "running";
  return "pending";
});
</script>

<template>
  <div class="workflow-node-status" :class="statusClass">
    {{ statusLabel }}
  </div>
</template>

<style scoped>
.workflow-node-status {
  border-radius: var(--noobot-radius-pill);
  padding: 2px 6px;
  font-size: 10px;
  border: 1px solid transparent;
  flex-shrink: 0;
  white-space: nowrap;
  line-height: 1.2;
}

.workflow-node-status.success {
  color: var(--noobot-status-success);
  background: color-mix(in srgb, var(--noobot-status-success) 12%, transparent);
  border-color: color-mix(in srgb, var(--noobot-status-success) 28%, transparent);
}

.workflow-node-status.failed {
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
