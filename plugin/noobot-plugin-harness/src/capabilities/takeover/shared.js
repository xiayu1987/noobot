/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isHarnessPromptMessage } from "../handlers/shared/message/injected-message-utils.js";

export function isMessageInjected(messages = [], id = "", content = "") {
  if (!Array.isArray(messages) || !messages.length) return false;
  if (id) return messages.some((msg) => isHarnessPromptMessage(msg, id));
  return messages.some((msg) => String(msg?.content || "") === content);
}
