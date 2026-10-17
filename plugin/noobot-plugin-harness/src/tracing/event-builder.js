/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildContextSnapshot, buildEvent, buildPromptRecord } from "../data/record-builders.js";

export function buildTraceEvent({ point, ctx, options }) {
  return buildEvent({ point, ctx, options });
}

export function buildTracePromptRecord({ promptId, point, content, maxPreviewChars }) {
  return buildPromptRecord({ promptId, point, content, maxPreviewChars });
}

export function buildTraceContextSnapshot({ ctx, pluginName, pluginVersion }) {
  return buildContextSnapshot({ ctx, pluginName, pluginVersion });
}
