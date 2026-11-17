/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

export function normalizeAnchorValue(value = "") {
  return text(value);
}

function resolveTurnScopeId(message = {}) {
  return normalizeAnchorValue(message?.turnScopeId || "");
}

export function createMessageAnchorMatcher(anchor = {}) {
  const turnScopeId = normalizeAnchorValue(anchor?.turnScopeId);
  if (turnScopeId) {
    return (messageItem) => resolveTurnScopeId(messageItem) === turnScopeId;
  }
  return null;
}
