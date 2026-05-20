/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export async function toolTakeoverHandler(_ctx, directive, options = {}) {
  const toolName = directive?.toolName || directive?.name;
  if (!toolName) return { applied: false, reason: "No tool name specified" };
  const allowlist = options.capabilityToolAllowlist || [];
  if (allowlist.length > 0 && !allowlist.includes(toolName)) {
    return { applied: true, action: "block", toolName, reason: "Not in allowlist" };
  }
  return { applied: true, action: "allow", toolName };
}
