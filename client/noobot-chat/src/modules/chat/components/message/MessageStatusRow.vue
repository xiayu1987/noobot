<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { useLocale } from "../../../../shared/i18n/useLocale.js";
import { computed } from "vue";

const props = defineProps({
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
  <div
    v-if="statusStepState"
    class="message-status-steps"
    :class="[
      `is-${stepView.finishStatus}`,
      { 'is-running': !['completed', 'stopped', 'error'].includes(statusStepState) },
    ]"
    role="status"
    aria-live="polite"
  >
    <el-steps :active="stepView.active" :finish-status="stepView.finishStatus" align-center>
      <el-step v-for="step in stepView.steps" :key="step.key" :title="step.title" />
    </el-steps>
  </div>
</template>

<style scoped>
.message-status-steps {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: 12px var(--noobot-space-md) 10px;
  border: none;
  border-radius: var(--noobot-radius-xs);
  color: var(--noobot-text-secondary);
  background: transparent;
  overflow: hidden;
  transition: border-color 0.2s ease;
}

.message-status-steps.is-running {
  background: transparent;
}
.message-status-steps.is-error {
  background: transparent;
}
.message-status-steps.is-warning {
  background: transparent;
}

.message-status-steps :deep(.el-step__icon) {
  width: 6px !important;
  height: 6px !important;
  border: none !important;
  border-radius: 50%;
  background-color: var(--noobot-panel-border);
  transition: background-color 0.3s ease;
}

.message-status-steps :deep(.el-step__icon-inner) {
  display: none !important;
}

.message-status-steps :deep(.el-step__line) {
  top: 3px !important;
  height: 1px !important;
  background-color: var(--noobot-divider);
  left: 50% !important;
  right: -50% !important;
}
.message-status-steps :deep(.el-step__line-inner) {
  border-width: 0 !important;
}

.message-status-steps :deep(.el-step__title) {
  font-size: 11px !important;
  line-height: 1 !important;
  margin-top: 8px !important;
  font-weight: 400 !important;
  color: var(--noobot-thinking-muted);
  letter-spacing: 0.5px;
}


.message-status-steps :deep(.el-step__head.is-success .el-step__icon),
.message-status-steps :deep(.el-step__head.is-finish .el-step__icon) {
  background-color: var(--noobot-text-muted);
}
.message-status-steps :deep(.el-step__title.is-success),
.message-status-steps :deep(.el-step__title.is-finish) {
  color: var(--noobot-text-secondary);
}

.message-status-steps :deep(.el-step__head.is-process .el-step__icon) {
  background-color: var(--el-color-primary);
  box-shadow: 0 0 8px 1px color-mix(in srgb, var(--el-color-primary) 60%, transparent);
  transform: scale(1.2);
}
.message-status-steps.is-running :deep(.el-step__head.is-process .el-step__icon) {
  width: 8px !important;
  height: 8px !important;
  animation: dot-glow 1.25s ease-in-out infinite alternate;
}
.message-status-steps :deep(.el-step__title.is-process) {
  color: var(--el-color-primary);
  font-weight: 600 !important;
}
.message-status-steps.is-running :deep(.el-step__title.is-process) {
  letter-spacing: 0.65px;
  text-shadow: 0 0 12px color-mix(in srgb, var(--el-color-primary) 36%, transparent);
}

.message-status-steps.is-error :deep(.el-step__head.is-error .el-step__icon) {
  background-color: var(--noobot-status-error);
}
.message-status-steps.is-error :deep(.el-step__title.is-error) {
  color: var(--noobot-status-error);
}

.message-status-steps.is-warning :deep(.el-step__head.is-warning .el-step__icon) {
  background-color: var(--noobot-status-warning);
}
.message-status-steps.is-warning :deep(.el-step__title.is-warning) {
  color: var(--noobot-status-warning);
}

@keyframes dot-glow {
  0% {
    box-shadow: 0 0 3px 0 color-mix(in srgb, var(--el-color-primary) 50%, transparent);
    transform: scale(1.15);
  }
  100% {
    box-shadow: 0 0 12px 4px color-mix(in srgb, var(--el-color-primary) 80%, transparent);
    transform: scale(1.42);
  }
}

@media (max-width: 560px) {
  .message-status-steps {
    padding: 10px var(--noobot-space-md) 8px;
  }
  .message-status-steps :deep(.el-step__title) {
    font-size: 10px !important;
    transform: scale(0.9);
  }
}
</style>
