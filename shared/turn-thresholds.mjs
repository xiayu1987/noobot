/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

export const TURN_THRESHOLDS = deepFreeze({
  agent: {
    maxToolLoopTurns: 2000,

    toolLoopLimitBufferTurns: 5,

    phaseSummaryLoopTurns: 20,

    taskCheckLoopTurns: 10,

    helpPromptLoopTurns: 50,

    toolFailureHelpCount: 3,

    transientLlmMaxAttempts: 3,

    streamingToolCallMismatchThreshold: 2,
  },

  session: {
    mainModelHistoryRoundLimit: 5,

    turnJournalSchemaVersion: 5,
  },

  subTasks: {
    processContentTaskMaxToolLoopTurns: 50,

    processConnectorToolMaxToolLoopTurns: 50,

    callMcpTaskMaxToolLoopTurns: 6,

    mcpTaskMaxTurns: 12,
  },

  capability: {
    miniRunnerMaxToolTurns: 5,
  },

  web: {
    browserRetryCount: 2,
  },

  harness: {
    miniRunnerMaxTurns: 5,

    pendingTtlHookTurns: 8,

    pendingWarnCooldownTurns: 3,

    modeThresholds: {
      full: {
        summaryTurns: 20,
        analysisTurns: 1,
        planUpdateTriggerTurns: 8,
        phaseAcceptanceTriggerTurns: 9,
      },
      programming: {
        summaryTurns: 50,
        analysisTurns: 1,
        planUpdateTriggerTurns: 20,
        phaseAcceptanceTriggerTurns: 30,
      },
      text: {
        summaryTurns: 20,
        analysisTurns: 1,
        planUpdateTriggerTurns: 8,
        phaseAcceptanceTriggerTurns: 14,
      },
    },

    planning: {
      planUpdateRevisionMaxAttempts: 20,
      planUpdateRefinementMaxAttempts: 20,
      planUpdateTriggerTurns: 4,
      captureMaxAttempts: 2,
    },

    jsonl: {
      flushMaxRetry: 5,
    },

    guidance: {
      summaryTurns: 8,
      analysisTurns: 10,
      failureConsecutive: 3,
      failureAccumulated: 10,
    },

    acceptance: {
      phaseTriggerTurns: 9,
    },
  },

  workflow: {
    miniRunnerMaxTurns: 3,

    retryMaxAttempts: 1,
  },

  transport: {
    turnLifecycleDeliveryMaxAttempts: 3,
  },

  web2img: {
    textStableRounds: 10,

    textStableThreshold: 3,
  },
});
