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
// Steps before the active ordinal are finished, the active one is in process, the rest wait.
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

.message-status-steps__list {
  display: flex;
  margin: 0;
  padding: 0;
  list-style: none;
}

.message-status-steps__item {
  position: relative;
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  text-align: center;
}

/* Connector from this step's dot to the next step's dot. */
.message-status-steps__item:not(:last-child)::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 50%;
  right: -50%;
  height: 1px;
  background-color: var(--noobot-divider);
}

.message-status-steps__dot {
  position: relative;
  z-index: 1;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--noobot-panel-border);
  transition: background-color var(--noobot-duration-slow) ease;
}

.message-status-steps__title {
  max-width: 100%;
  margin-top: var(--noobot-space-xs);
  font-size: 11px;
  line-height: var(--noobot-line-height-none);
  font-weight: var(--noobot-font-weight-regular);
  color: var(--noobot-thinking-muted);
  letter-spacing: var(--noobot-letter-spacing-caps);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-status-steps__item.is-success .message-status-steps__dot {
  background-color: var(--noobot-text-muted);
}
.message-status-steps__item.is-success .message-status-steps__title {
  color: var(--noobot-text-secondary);
}

.message-status-steps__item.is-process .message-status-steps__dot {
  background-color: var(--noobot-status-running);
  transform: scale(1.2);
}
.message-status-steps.is-running .message-status-steps__item.is-process .message-status-steps__dot {
  top: -1px;
  width: 8px;
  height: 8px;
  animation: dot-pulse 1.25s ease-in-out infinite alternate;
}
.message-status-steps__item.is-process .message-status-steps__title {
  color: var(--noobot-status-running);
  font-weight: var(--noobot-font-weight-semibold);
}
.message-status-steps.is-running .message-status-steps__item.is-process .message-status-steps__title {
  letter-spacing: var(--noobot-letter-spacing-caps-wide);
}

.message-status-steps__item.is-error .message-status-steps__dot {
  background-color: var(--noobot-status-error);
}
.message-status-steps__item.is-error .message-status-steps__title {
  color: var(--noobot-status-error);
}

.message-status-steps__item.is-warning .message-status-steps__dot {
  background-color: var(--noobot-status-warning);
}
.message-status-steps__item.is-warning .message-status-steps__title {
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


@media (max-width: 640px) {
  .message-status-steps {
    padding: var(--noobot-space-sm) var(--noobot-space-md) var(--noobot-space-xs);
  }
  .message-status-steps__title {
    font-size: 10px;
  }
}
</style>
