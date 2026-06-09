<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { useWorkflowLocale } from "../../i18n";

const props = defineProps({
  status: { type: String, default: "pending" },
});
const { translate } = useWorkflowLocale();

const normalizedStatus = computed(() => String(props.status || "").trim().toLowerCase());

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
  --workflow-success-rgb: 31, 143, 74;
  --workflow-failed-rgb: 199, 59, 59;
  --workflow-running-rgb: 122, 75, 244;
  --workflow-pending-rgb: 127, 127, 127;
  border-radius: 999px;
  padding: 2px 6px;
  font-size: 10px;
  border: 1px solid transparent;
  flex-shrink: 0;
  white-space: nowrap;
  line-height: 1.2;
}

.workflow-node-status.success {
  color: rgb(var(--workflow-success-rgb));
  background: rgba(var(--workflow-success-rgb), 0.12);
  border-color: rgba(var(--workflow-success-rgb), 0.28);
}

.workflow-node-status.failed {
  color: rgb(var(--workflow-failed-rgb));
  background: rgba(var(--workflow-failed-rgb), 0.12);
  border-color: rgba(var(--workflow-failed-rgb), 0.28);
}

.workflow-node-status.running {
  color: rgb(var(--workflow-running-rgb));
  background: rgba(var(--workflow-running-rgb), 0.12);
  border-color: rgba(var(--workflow-running-rgb), 0.28);
}

.workflow-node-status.pending {
  color: var(--noobot-text-secondary);
  background: rgba(var(--workflow-pending-rgb), 0.1);
  border-color: rgba(var(--workflow-pending-rgb), 0.2);
}
</style>
