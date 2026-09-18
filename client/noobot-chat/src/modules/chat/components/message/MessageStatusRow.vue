<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { useLocale } from "../../../../shared/i18n/useLocale.js";
import { computed } from "vue";
import {
  isTerminalStatusStepState,
  resolveStatusStepLabelKey,
  resolveStatusStepStageOrdinal,
  STATUS_STEP_STAGE_SEQUENCE,
  STATUS_STEP_TERMINAL,
} from "../../runtime/sessionRunStateMachine.js";

const ANTICIPATED_TERMINAL_STEP = STATUS_STEP_TERMINAL.COMPLETED;
const TERMINAL_FINISH_STATUS = Object.freeze({
  [STATUS_STEP_TERMINAL.COMPLETED]: "success",
  [STATUS_STEP_TERMINAL.STOPPED]: "warning",
  [STATUS_STEP_TERMINAL.ERROR]: "error",
});

const props = defineProps({
  statusStepState: { type: String, default: "" },
});
const { translate } = useLocale();
const isRunning = computed(() => !isTerminalStatusStepState(props.statusStepState));
const stepView = computed(() => {
  const terminal = isTerminalStatusStepState(props.statusStepState)
    ? props.statusStepState
    : ANTICIPATED_TERMINAL_STEP;
  const steps = [...STATUS_STEP_STAGE_SEQUENCE, terminal].map((stepState) => ({
    key: stepState,
    title: translate(resolveStatusStepLabelKey(stepState)),
  }));
  return {
    steps,
    active: resolveStatusStepStageOrdinal(props.statusStepState),
    finishStatus: TERMINAL_FINISH_STATUS[terminal],
  };
});
</script>

<template>
  <div
    v-if="statusStepState"
    class="message-status-steps"
    :class="[
      `is-${stepView.finishStatus}`,
      { 'is-running': isRunning },
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
  padding: var(--noobot-space-md) var(--noobot-space-md) var(--noobot-space-sm);
  border: none;
  border-radius: var(--noobot-radius-xs);
  color: var(--noobot-text-secondary);
  background: transparent;
  overflow: hidden;
  transition: border-color var(--noobot-duration-normal) ease;
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
  transition: background-color var(--noobot-duration-slow) ease;
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
  margin-top: var(--noobot-space-xs) !important;
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
  background-color: var(--noobot-status-running);
  transform: scale(1.2);
}
.message-status-steps.is-running :deep(.el-step__head.is-process .el-step__icon) {
  width: 8px !important;
  height: 8px !important;
  animation: dot-pulse 1.25s ease-in-out infinite alternate;
}
.message-status-steps :deep(.el-step__title.is-process) {
  color: var(--noobot-status-running);
  font-weight: 600 !important;
}
.message-status-steps.is-running :deep(.el-step__title.is-process) {
  letter-spacing: 0.65px;
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

@keyframes dot-pulse {
  0% {
    transform: scale(1.15);
  }
  100% {
    transform: scale(1.42);
  }
}

@media (max-width: 560px) {
  .message-status-steps {
    padding: var(--noobot-space-sm) var(--noobot-space-md) var(--noobot-space-xs);
  }
  .message-status-steps :deep(.el-step__title) {
    font-size: 10px !important;
    transform: scale(0.9);
  }
}
</style>
