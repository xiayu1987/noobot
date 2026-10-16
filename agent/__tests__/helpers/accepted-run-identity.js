/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createAssistantMessageEventId } from "@noobot/session-protocol";
import { text } from "@noobot/shared/value";

export function createAcceptedRunIdentity(turnScopeId, overrides = {}) {
  const scopeId = text(turnScopeId);
  if (!scopeId) throw new TypeError("accepted run identity requires turnScopeId");
  const executionId = `agent:${scopeId}`;
  const presentationMessageId = overrides.presentationMessageId ?? `msg_assistant_${scopeId}`;
  return {
    presentationMessageId,
    messageId: createAssistantMessageEventId(presentationMessageId),
    userMessageId: `msg_user_${scopeId}`,
    commandId: `cmd_${scopeId}`,
    executionId,
    rootExecutionId: executionId,
    ...overrides,
  };
}
