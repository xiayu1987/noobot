/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dedupeAttachmentsByIdentity } from "@noobot/attachment-protocol";
import { normalizeMessageEntity } from "./message-entity.js";

export function createTurnReplacementMessage(anchor, command, identity, committedAt) {
  const message = { ...anchor };
  for (const key of [
    "turnId",
    "messageUid",
    "userMessageId",
    "channelState",
    "error",
    "status",
    "terminalOutcome",
    "state",
    "__noobotRuntimeRunStateKey",
  ])
    delete message[key];
  return normalizeMessageEntity({
    ...message,
    ...identity,
    role: "user",
    type: "message",
    content: command.newContent,
    turnScopeId: command.turnScopeId,
    pending: false,
    done: true,
    ts: committedAt,
    attachments: dedupeAttachmentsByIdentity(command.attachments),
  });
}
