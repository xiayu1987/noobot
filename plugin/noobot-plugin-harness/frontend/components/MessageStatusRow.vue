<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { useLocale } from "../../../../client/noobot-chat/src/shared/i18n/useLocale";
import { computed } from "vue";

const props = defineProps({
  pending: { type: Boolean, default: false },
  statusLabel: { type: String, default: "" },
  showSubTask: { type: Boolean, default: false },
  subTaskStatusText: { type: String, default: "" },
  statusStepState: { type: String, default: "" },
});
const { translate } = useLocale();
const stepView = computed(() => {
  const terminal = ["completed", "stopped", "error"].includes(props.statusStepState)
    ? props.statusStepState
    : "completed";
  const steps = [
    { key: "requesting", title: translate("composer.requesting") },
    { key: "sending", title: translate("composer.sending") },
    { key: "completing", title: translate("composer.completing") },
    {
      key: terminal,
      title: terminal === "stopped"
        ? translate("composer.turnStopped")
        : terminal === "error"
          ? translate("composer.turnFailed")
          : translate("composer.turnCompleted"),
    },
  ];
  const activeByState = { requesting: 0, sending: 1, completing: 2, stopping: 2, completed: 4, stopped: 4, error: 4 };
  return {
    steps,
    active: activeByState[props.statusStepState] ?? 0,
    finishStatus: terminal === "error" ? "error" : terminal === "stopped" ? "warning" : "success",
  };
});
</script>

<template>
  <div v-if="statusStepState" class="message-status-steps">
    <el-steps :active="stepView.active" :finish-status="stepView.finishStatus" align-center>
      <el-step v-for="step in stepView.steps" :key="step.key" :title="step.title" />
    </el-steps>
  </div>
</template>

<style scoped>
.message-status-steps { width: min(100%, 560px); margin: 6px 0 10px; }
.message-status-steps :deep(.el-step__title) {
  font-size: 12px;
  white-space: nowrap;
  transition: color 0.2s ease, font-weight 0.2s ease;
}
.message-status-steps :deep(.el-step__head.is-success),
.message-status-steps :deep(.el-step__title.is-success) {
  color: var(--el-text-color-placeholder);
  border-color: var(--el-border-color-light);
  font-weight: 400;
}
.message-status-steps :deep(.el-step__line) {
  background-color: var(--el-border-color-lighter);
}
.message-status-steps :deep(.el-step__head.is-process) {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
}
.message-status-steps :deep(.el-step__title.is-process) {
  color: var(--el-color-primary);
  font-weight: 700;
}
.message-status-steps :deep(.el-step__head.is-process .el-step__icon) {
  background: var(--el-color-primary-light-9);
  box-shadow: 0 0 0 4px var(--el-color-primary-light-9);
}
</style>
