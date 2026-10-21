/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { deriveAgentExecutionId, EXECUTION_KIND } from "@noobot/session-protocol";
import { MESSAGE_FIELD_SCHEMA } from "@noobot/session-protocol/message-identity-schema";
import { text } from "@noobot/shared/value";

export function createAcceptedRunIdentity(turnScopeId, overrides = {}) {
  const scopeId = text(turnScopeId);
  if (!scopeId) throw new TypeError("accepted run identity requires turnScopeId");
  const executionId = deriveAgentExecutionId({ turnScopeId: scopeId });
  const presentationMessageId =
    overrides.presentationMessageId ??
    `${MESSAGE_FIELD_SCHEMA.presentationMessageId.prefix}${scopeId}`;
  return {
    presentationMessageId,
    userMessageId: `${MESSAGE_FIELD_SCHEMA.userMessageId.prefix}${scopeId}`,
    commandId: `cmd_${scopeId}`,
    executionId,
    executionKind: EXECUTION_KIND.AGENT,
    rootExecutionId: executionId,
    ...overrides,
  };
}

export function createAcceptedAgentExecution(turnScopeId, sessionId) {
  const executionId = deriveAgentExecutionId({ turnScopeId });
  return {
    sessionId,
    executionId,
    executionKind: EXECUTION_KIND.AGENT,
    rootExecutionId: executionId,
  };
}
