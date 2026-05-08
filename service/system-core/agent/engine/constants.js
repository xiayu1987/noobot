/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const ENGINE_I18N_KEY_MAP = {
  toolLoopLimitReached: "agent.toolLoopLimitReached",
  toolConsecutiveFailureLimitReached:
    "agent.toolConsecutiveFailureLimitReached",
  fetchGeneratedMediaFailed: "agent.fetchGeneratedMediaFailed",
  fetchRemoteMediaArtifactFailed: "agent.fetchRemoteMediaArtifactFailed",
};

export const TOOL_CONSECUTIVE_FAILURE_LIMIT = 3;

// Re-export for backward compatibility
export { getMimeExtensionMap as MIME_EXTENSION_MAP } from "./utils/mime-utils.js";
