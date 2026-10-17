/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";

function requireSource(value, code) {
  const source = text(value);
  if (!source) throw new TypeError(code);
  return source;
}

export function deriveTurnCommandId(turnScopeId) {
  return requireSource(turnScopeId, "turn_command_id_requires_turn_scope_id");
}

export function deriveStopCommandId(turnScopeId) {
  return `stop:${requireSource(turnScopeId, "stop_command_id_requires_turn_scope_id")}`;
}

export function deriveInteractionCommandId(requestId) {
  return `interaction:${requireSource(requestId, "interaction_command_id_requires_request_id")}`;
}

export function deriveAttachmentBindCommandId(turnScopeId) {
  return `${requireSource(turnScopeId, "attachment_bind_command_id_requires_turn_scope_id")}:attachments.bind`;
}
