<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";

const props = defineProps({
  status: { type: String, default: "pending" },
});

const normalizedStatus = computed(() => String(props.status || "").trim().toLowerCase());

const statusLabel = computed(() => {
  if (normalizedStatus.value === "success") return "成功";
  if (normalizedStatus.value === "failed" || normalizedStatus.value === "error") return "失败";
  if (normalizedStatus.value === "running") return "执行中";
  return "待执行";
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
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 12px;
  border: 1px solid transparent;
  flex-shrink: 0;
  white-space: nowrap;
  line-height: 1.2;
}

.workflow-node-status.success {
  color: #1f8f4a;
  background: rgba(31, 143, 74, 0.12);
  border-color: rgba(31, 143, 74, 0.28);
}

.workflow-node-status.failed {
  color: #c73b3b;
  background: rgba(199, 59, 59, 0.12);
  border-color: rgba(199, 59, 59, 0.28);
}

.workflow-node-status.running {
  color: #7a4bf4;
  background: rgba(122, 75, 244, 0.12);
  border-color: rgba(122, 75, 244, 0.28);
}

.workflow-node-status.pending {
  color: var(--noobot-text-secondary);
  background: rgba(127, 127, 127, 0.1);
  border-color: rgba(127, 127, 127, 0.2);
}
</style>
