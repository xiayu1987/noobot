/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";

export const ENGINE_I18N_KEY_MAP = {
  toolLoopLimitReached: "agent.toolLoopLimitReached",
  toolConsecutiveFailureHelpPrompt: "agent.toolConsecutiveFailureHelpPrompt",
  helpToolLoopPrompt: "agent.helpToolLoopPrompt",
  taskSummarySingleToolPrompt: "agent.taskSummarySingleToolPrompt",
  taskCheckSingleToolPrompt: "agent.taskCheckSingleToolPrompt",
  fetchGeneratedMediaFailed: "agent.fetchGeneratedMediaFailed",
  fetchRemoteMediaArtifactFailed: "agent.fetchRemoteMediaArtifactFailed",
  abortError: "agent.abortError",
  phaseSummaryPrompt: "agent.phaseSummaryPrompt",
  taskCheckPrompt: "agent.taskCheckPrompt",
};

export const DEFAULT_MAX_TOOL_LOOP_TURNS = TURN_THRESHOLDS.agent.maxToolLoopTurns;

export const DEFAULT_TOOL_LOOP_LIMIT_BUFFER_TURNS = TURN_THRESHOLDS.agent.toolLoopLimitBufferTurns;

export const PHASE_SUMMARY_OVERFLOW_POLICY = Object.freeze({
  ENFORCE_NO_TOOLS_WHEN_STILL_OVERFLOW: true,
});
