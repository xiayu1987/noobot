/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  HARNESS_INJECTED_MESSAGE_BY_FIELD,
  HARNESS_INJECTED_MESSAGE_BY_VALUE,
  HARNESS_INJECTED_MESSAGE_FLAG_FIELD,
  HARNESS_INJECTED_MESSAGE_FLAG_VALUE,
  HARNESS_INJECTION_MESSAGE_ROLE,
} from "../capabilities/handlers/shared/constants.js";
import { appendMessage } from "../core/message-store.js";

export async function messageTakeoverHandler(ctx, directive) {
  const messages = Array.isArray(ctx.messages) ? ctx.messages : [];
  const content = directive?.content || directive?.text;
  if (!content) return { applied: false, reason: "No content specified" };
  appendMessage(ctx, {
    role: HARNESS_INJECTION_MESSAGE_ROLE,
    content,
    [HARNESS_INJECTED_MESSAGE_FLAG_FIELD]: HARNESS_INJECTED_MESSAGE_FLAG_VALUE,
    [HARNESS_INJECTED_MESSAGE_BY_FIELD]: HARNESS_INJECTED_MESSAGE_BY_VALUE,
  }, { block: "incremental" });
  return { applied: true, action: "inject", messageCount: messages.length };
}
