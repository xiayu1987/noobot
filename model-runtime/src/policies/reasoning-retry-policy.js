/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { extractReasoningText, extractResponseText } from "../normalization/response-normalizer.js";

export function classifyReasoningOnly(response) {
  return !extractResponseText(response) && Boolean(extractReasoningText(response));
}

export function createReasoningRetryState(policy = {}) {
  return { attempts: 0, maxAttempts: Math.max(0, Number(policy.maxAttempts) || 0) };
}

export function shouldRetryReasoningOnly(state) {
  return state.attempts < state.maxAttempts;
}
