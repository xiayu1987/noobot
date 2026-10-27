/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AGENT_COMMAND } from "@noobot/agent-transport-protocol";
import { isCanonicalText } from "@noobot/shared/value";
import {
  createPresentationMessageId,
  createUserMessageId,
} from "@noobot/session-protocol/message-identity";
import { createTurnScopeId } from "./sendFlowSupport.js";

function requireCanonicalText(field, value) {
  if (!isCanonicalText(value)) throw new TypeError(`invalid_send_request_${field}`);
  return value;
}

function resolveTurnMessageText(authoredText, translate) {
  return {
    authoredText,
    messageText: authoredText.length > 0 ? authoredText : translate("chat.uploadHint"),
  };
}

function resolveComposerRequest(request, { input, uploadFiles, translate }) {
  const authoredText = input.value.trim();
  const attachmentFiles = [...uploadFiles.value];
  const base = {
    commandType: request.commandType,
    userMessageId: createUserMessageId(),
    presentationMessageId: createPresentationMessageId(),
    ...resolveTurnMessageText(authoredText, translate),
    attachmentFiles,
  };
  if (request.commandType === AGENT_COMMAND.SEND) {
    if (!authoredText && attachmentFiles.length === 0) return null;
    return { ...base, turnScopeId: createTurnScopeId() };
  }
  return {
    ...base,
    turnScopeId: requireCanonicalText("turn_scope_id", request.turnScopeId),
    continuation: {
      dialogProcessId: requireCanonicalText(
        "continuation_dialog_process_id",
        request.continuation.dialogProcessId,
      ),
      turnScopeId: requireCanonicalText(
        "continuation_turn_scope_id",
        request.continuation.turnScopeId,
      ),
    },
  };
}

function resolveResendRequest(request, { activeSession, translate }) {
  const userMessageId = requireCanonicalText("user_message_id", request.userMessageId);
  if (typeof request.messageText !== "string")
    throw new TypeError("invalid_send_request_message_text");
  if (!Array.isArray(request.attachments)) throw new TypeError("invalid_send_request_attachments");
  const existingUserMessage = activeSession.value.messages.find(
    (message) => message.userMessageId === userMessageId,
  );
  if (!existingUserMessage) return null;
  return {
    commandType: AGENT_COMMAND.RESEND,
    turnScopeId: requireCanonicalText("turn_scope_id", request.turnScopeId),
    userMessageId,
    presentationMessageId: createPresentationMessageId(),
    dialogProcessId: requireCanonicalText("dialog_process_id", request.dialogProcessId),
    ...resolveTurnMessageText(request.messageText.trim(), translate),
    attachments: request.attachments,
  };
}

const SEND_REQUEST_RESOLVERS = Object.freeze({
  [AGENT_COMMAND.SEND]: resolveComposerRequest,
  [AGENT_COMMAND.CONTINUE]: resolveComposerRequest,
  [AGENT_COMMAND.RESEND]: resolveResendRequest,
});

export function resolveSendRequest(request, deps) {
  const resolveRequest = SEND_REQUEST_RESOLVERS[request.commandType];
  if (!resolveRequest) throw new TypeError("invalid_send_request_command_type");
  if (!deps.ensureConnected()) return null;
  if (!deps.activeSession.value) return null;
  const resolved = resolveRequest(request, deps);
  return resolved ? { ...resolved, sessionId: deps.activeSession.value.sessionId } : null;
}
