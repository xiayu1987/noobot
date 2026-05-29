/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function isMessageInjected(messages = [], id = "", content = "") {
  if (!Array.isArray(messages) || !messages.length) return false;
  if (id) {
    return messages.some((msg) => String(msg?.content || "").includes(`<!-- ${id} -->`));
  }
  return messages.some((msg) => String(msg?.content || "") === content);
}
