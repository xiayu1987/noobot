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
} from "./constants.js";

export function buildHarnessInjectedMessage(content = "", { attachmentMetas = [] } = {}) {
  const message = {
    role: HARNESS_INJECTION_MESSAGE_ROLE,
    content: String(content || ""),
    [HARNESS_INJECTED_MESSAGE_FLAG_FIELD]: HARNESS_INJECTED_MESSAGE_FLAG_VALUE,
    [HARNESS_INJECTED_MESSAGE_BY_FIELD]: HARNESS_INJECTED_MESSAGE_BY_VALUE,
  };
  if (Array.isArray(attachmentMetas) && attachmentMetas.length) {
    message.attachmentMetas = attachmentMetas;
  }
  return message;
}

export function resolveCurrentTurnMessagesStore(ctx = {}) {
  const runtime =
    ctx?.agentContext?.execution?.controllers?.runtime &&
    typeof ctx.agentContext.execution.controllers.runtime === "object"
      ? ctx.agentContext.execution.controllers.runtime
      : {};
  const store = runtime?.currentTurnMessages;
  return store && typeof store.push === "function" ? store : null;
}

export function persistHarnessMessageToCurrentTurn(
  ctx = {},
  message = {},
  enabled = false,
) {
  if (enabled !== true) return false;
  const currentTurnMessages = resolveCurrentTurnMessagesStore(ctx);
  if (!currentTurnMessages) return false;
  currentTurnMessages.push({
    ...message,
    type: "message",
    dialogProcessId: String(ctx?.dialogProcessId || "").trim(),
  });
  return true;
}
