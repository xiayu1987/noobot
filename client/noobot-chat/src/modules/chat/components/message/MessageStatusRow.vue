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

function resolveStepStatus(stepIndex, activeOrdinal, finishStatus) {
  if (stepIndex < activeOrdinal) return finishStatus;
  if (stepIndex === activeOrdinal) return "process";
  return "wait";
}

const props = defineProps({
  statusStepState: { type: String, default: "" },
});
const { translate } = useLocale();
const isRunning = computed(() => !isTerminalStatusStepState(props.statusStepState));
const stepView = computed(() => {
  const terminal = isTerminalStatusStepState(props.statusStepState)
    ? props.statusStepState
    : ANTICIPATED_TERMINAL_STEP;
  const finishStatus = TERMINAL_FINISH_STATUS[terminal];
  const activeOrdinal = resolveStatusStepStageOrdinal(props.statusStepState);
  const steps = [...STATUS_STEP_STAGE_SEQUENCE, terminal].map((stepState, stepIndex) => ({
    key: stepState,
    title: translate(resolveStatusStepLabelKey(stepState)),
    status: resolveStepStatus(stepIndex, activeOrdinal, finishStatus),
  }));
  return { steps, finishStatus };
});
</script>

<template>
  <div
    v-if="statusStepState"
    class="message-status-steps"
    :class="[`is-${stepView.finishStatus}`, { 'is-running': isRunning }]"
    role="status"
    aria-live="polite"
  >
    <ol class="message-status-steps__list">
      <li
        v-for="step in stepView.steps"
        :key="step.key"
        class="message-status-steps__item"
        :class="`is-${step.status}`"
        :aria-current="step.status === 'process' ? 'step' : undefined"
      >
        <span class="message-status-steps__dot" aria-hidden="true" />
        <span class="message-status-steps__title">{{ step.title }}</span>
      </li>
    </ol>
  </div>
</template>
