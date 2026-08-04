/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";

export const ENGINE_I18N_KEY_MAP = {
  toolLoopLimitReached: "agent.toolLoopLimitReached",
  toolConsecutiveFailureHelpPrompt:
    "agent.toolConsecutiveFailureHelpPrompt",
  helpToolLoopPrompt: "agent.helpToolLoopPrompt",
  toolChoiceRequiredRetryPrompt: "agent.toolChoiceRequiredRetryPrompt",
  taskSummarySingleToolPrompt: "agent.taskSummarySingleToolPrompt",
  fetchGeneratedMediaFailed: "agent.fetchGeneratedMediaFailed",
  fetchRemoteMediaArtifactFailed: "agent.fetchRemoteMediaArtifactFailed",
  abortError: "agent.abortError",
  phaseSummaryPrompt: "agent.phaseSummaryPrompt",
};

export const DEFAULT_TOOL_FAILURE_HELP_COUNT =
  TURN_THRESHOLDS.agent.toolFailureHelpCount;

export const DEFAULT_MAX_TOOL_LOOP_TURNS =
  TURN_THRESHOLDS.agent.maxToolLoopTurns;

export const DEFAULT_TOOL_LOOP_LIMIT_BUFFER_TURNS =
  TURN_THRESHOLDS.agent.toolLoopLimitBufferTurns;

export const DEFAULT_PHASE_SUMMARY_LOOP_TURNS =
  TURN_THRESHOLDS.agent.phaseSummaryLoopTurns;

export const DEFAULT_PHASE_SUMMARY_MESSAGE_CHARS_THRESHOLD =
  LENGTH_THRESHOLDS.context.phaseSummaryMessageChars;
export const PHASE_SUMMARY_OVERFLOW_POLICY = Object.freeze({
  ENFORCE_NO_TOOLS_WHEN_STILL_OVERFLOW: true,
});

export const DEFAULT_HELP_PROMPT_LOOP_TURNS =
  TURN_THRESHOLDS.agent.helpPromptLoopTurns;

export const PHASE_SUMMARY_PROMPT_MARKER = "noobot.phase_summary_prompt";
export const HELP_TOOL_LOOP_PROMPT_MARKER = "noobot.help_tool_loop_prompt";
export const HELP_TOOL_FAILURE_PROMPT_MARKER = "noobot.help_tool_failure_prompt";

export const TASK_SUMMARY_TOOL_NAME = "task_summary";
