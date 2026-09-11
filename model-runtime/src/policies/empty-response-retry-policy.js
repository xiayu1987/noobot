/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { hasUsableModelChatOutput } from "@noobot/model-protocol";

export function classifyEmptyResponse(output = {}) {
  return !hasUsableModelChatOutput(output) && !String(output?.reasoning || "").trim();
}
