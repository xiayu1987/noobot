/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const ENGINE_I18N_KEY_MAP = {
  toolLoopLimitReached: "agent.toolLoopLimitReached",
  toolConsecutiveFailureHelpPrompt: "agent.toolConsecutiveFailureHelpPrompt",
  helpToolLoopPrompt: "agent.helpToolLoopPrompt",
  taskSummarySingleToolPrompt: "agent.taskSummarySingleToolPrompt",
  taskCheckSingleToolPrompt: "agent.taskCheckSingleToolPrompt",
  noFinalResponseRetryPrompt: "agent.noFinalResponseRetryPrompt",
  fetchGeneratedMediaFailed: "agent.fetchGeneratedMediaFailed",
  fetchRemoteMediaArtifactFailed: "agent.fetchRemoteMediaArtifactFailed",
  phaseSummaryPrompt: "agent.phaseSummaryPrompt",
  taskCheckPrompt: "agent.taskCheckPrompt",
};

export const PHASE_SUMMARY_OVERFLOW_POLICY = Object.freeze({
  ENFORCE_NO_TOOLS_WHEN_STILL_OVERFLOW: true,
});
