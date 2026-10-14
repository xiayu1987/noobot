/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { extractReasoningText, extractResponseText } from "../normalization/response-normalizer.js";

export function classifyReasoningOnly(response) {
  return !extractResponseText(response) && Boolean(extractReasoningText(response));
}
