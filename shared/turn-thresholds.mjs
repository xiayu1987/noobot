/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Central turn/count-related thresholds.
 *
 * Keep character/byte/string-size thresholds in length-thresholds.mjs. Keep
 * timeouts, file counts, pixel limits, and pagination limits out of this file.
 * This module is for loop turns, message windows, workflow trigger turns,
 * hook-turn TTLs, and retry/attempt counts that shape turn progression.
 *
 * Value tiers:
 * - 1-3: single-shot retry/failure/history-round guards.
 * - 4-8: short workflow trigger and pending TTL windows.
 * - 9-15: normal workflow phase, guidance, and summary cadence.
 * - 20-24: programming-mode long-task cadence.
 * - 50: subtask/help-prompt loop ceilings.
 * - 300: main-agent hard tool-loop ceiling.
 *
 * Retry/attempt counts live here because they shape turn progression. Plain
 * item/file/display counts live in quantity-thresholds.mjs.
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
    // Main tool-call loop maximum before loop-limit handling starts.
    maxToolLoopTurns: 300,

    // Extra turns allowed after maxToolLoopTurns for finalization/self-correction.
    toolLoopLimitBufferTurns: 5,

    // Tool-loop turns before the main agent asks for a phase summary.
    phaseSummaryLoopTurns: 15,

    // Summary rounds after char-triggered summary before pruning is allowed.
    phaseSummaryPruneAfterCharSummaryRounds: 1,

    // Tool-loop turns before the main agent injects a help prompt.
    helpPromptLoopTurns: 50,

    // Consecutive tool failures before help prompt guidance is injected.
    toolFailureHelpCount: 3,

    // Maximum attempts for transient LLM invocation retry.
    transientLlmMaxAttempts: 2,

    // Streaming retry fallback starts after this many repeated tool-call mismatches.
    streamingToolCallMismatchThreshold: 2,
  },

  session: {
    // Main-model history keeps this many previous dialog rounds.
    mainModelHistoryRoundLimit: 5,
  },

  subTasks: {
    // Detached content-processing tool loop ceiling.
    processContentTaskMaxToolLoopTurns: 50,

    // Detached connector-processing tool loop ceiling.
    processConnectorToolMaxToolLoopTurns: 50,

    // MCP task sub-loop ceiling.
    callMcpTaskMaxToolLoopTurns: 6,

    // Direct MCP tool runner max LLM/tool turns.
    mcpTaskMaxTurns: 12,
  },

  capability: {
    // Plugin capability mini-runner tool-call turns.
    miniRunnerMaxToolTurns: 5,
  },

  web: {
    // Browser simulation retries for web_to_data before falling back.
    browserRetryCount: 2,
  },

  harness: {
    // Default Harness capability mini-runner turns.
    miniRunnerMaxTurns: 5,

    // Hook-turn TTL for stale pending workflow/capture flags.
    pendingTtlHookTurns: 8,

    // Hook-turn cooldown between stale-pending warnings.
    pendingWarnCooldownTurns: 3,

    modeThresholds: {
      full: {
        summaryTurns: 15,
        analysisTurns: 1,
        planUpdateTriggerTurns: 8,
        phaseAcceptanceTriggerTurns: 9,
      },
      programming: {
        summaryTurns: 27,
        analysisTurns: 1,
        planUpdateTriggerTurns: 14,
        phaseAcceptanceTriggerTurns: 26,
      },
      text: {
        summaryTurns: 15,
        analysisTurns: 1,
        planUpdateTriggerTurns: 4,
        phaseAcceptanceTriggerTurns: 14,
      },
    },

    planning: {
      planUpdateRevisionMaxAttempts: 10,
      planUpdateRefinementMaxAttempts: 10,
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
    // Workflow semantic mini-runner default turns.
    miniRunnerMaxTurns: 3,

    // Workflow semantic retry policy is intentionally single-shot by default.
    retryMaxAttempts: 1,
  },

  web2img: {
    // Rounds used to wait for extracted page text to stabilize.
    textStableRounds: 10,

    // Consecutive stable samples needed before text is considered stable.
    textStableThreshold: 3,
  },
});
