/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function toToolJsonResult(toolName, payload = {}, pretty = false) {
  return JSON.stringify(
    {
      toolName: String(toolName || "").trim(),
      ...payload,
    },
    null,
    pretty ? 2 : 0,
  );
}

