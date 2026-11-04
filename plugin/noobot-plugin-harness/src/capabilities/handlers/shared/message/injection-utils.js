/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isHarnessAgentTurnEnded } from "../runtime/lifecycle-utils.js";
import {
  persistHarnessRecordToCurrentTurn,
  buildHarnessInjectedRecord,
} from "./injected-message-utils.js";
import { projectSessionRecordToContextMessage } from "@noobot/context-protocol/message/session-projection";
import { isSystemLikeMessageRole } from "@noobot/context-protocol/policy/message";
import {
  resolveContextToolCallDeclarationId,
  resolveContextToolResultCallId,
} from "@noobot/context-protocol/message/codec";
import {
  appendMessage,
  replaceMessages,
  resolveModelMessageBlocks,
  resolveModelMessages,
} from "../../../../core/message-store.js";
import { text } from "@noobot/shared/value";

function hasPendingToolCallPair(messages = []) {
  const index = messages.findLastIndex(
    (message) => text(message?.role).toLowerCase() === "assistant",
  );
  if (index < 0) return false;
  const calls = messages[index].tool_calls;
  if (!Array.isArray(calls) || !calls.length) return false;
  const pendingIds = new Set(calls.map(resolveContextToolCallDeclarationId).filter(Boolean));
  for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
    const next = messages[cursor];
    if (text(next?.role).toLowerCase() !== "tool") continue;
    pendingIds.delete(resolveContextToolResultCallId(next));
  }
  return pendingIds.size > 0;
}

function dedupeExists(messages = [], target = {}) {
  const role = text(target?.role);
  const content = text(target?.content);
  if (!Array.isArray(messages) || !role || !content) return false;
  return messages.some((item = {}) => {
    const itemRole = text(item?.role);
    const itemContent = text(item?.content);
    return itemRole === role && itemContent === content;
  });
}

function resolveHarnessMainFlowRole({ role = "system" } = {}) {
  const requestedRole = (text(role) || "system").toLowerCase();
  if (requestedRole === "user") return "user";
  return requestedRole || "system";
}

export function injectMessageWithPolicy(
  ctx = {},
  {
    role = "system",
    content = "",
    attachments = null,
    transferEnvelopes = [],
    injectAt = "append",
    dedupe = false,
    injectedMessageType = "",
    relayCorrelationId = "",
    avoidBreakToolCallContinuity = true,
    persistToCurrentTurn = true,
  } = {},
) {
  const messages = resolveModelMessages(ctx);
  const normalizedContent = text(content);
  if (!normalizedContent) return { injected: false, target: "none" };
  if (isHarnessAgentTurnEnded(ctx)) {
    return { injected: false, target: "none", blockedByTurnEnded: true };
  }
  const resolvedRole = resolveHarnessMainFlowRole({ role });
  const record = buildHarnessInjectedRecord(normalizedContent, {
    role: resolvedRole,
    attachments: Array.isArray(attachments) ? attachments : [],
    transferEnvelopes,
    injectedMessageType,
    relayCorrelationId,
  });
  const message = projectSessionRecordToContextMessage(record);

  if (dedupe && dedupeExists(messages, message)) {
    return { injected: false, target: "ctx_messages", deduped: true };
  }

  const normalizedInjectAt = (text(injectAt) || "append").toLowerCase();
  const shouldProtectContinuity =
    avoidBreakToolCallContinuity === true &&
    isSystemLikeMessageRole(resolvedRole) &&
    normalizedInjectAt === "append" &&
    hasPendingToolCallPair(messages);
  const target = shouldProtectContinuity ? "agent_system" : "ctx_messages";
  if (
    shouldProtectContinuity &&
    dedupe &&
    dedupeExists(resolveModelMessageBlocks(ctx).system, message)
  ) {
    return { injected: false, target, deduped: true };
  }

  if (normalizedInjectAt === "prepend") {
    replaceMessages(ctx, [message, ...messages]);
  } else {
    appendMessage(ctx, message, {
      block: isSystemLikeMessageRole(resolvedRole) ? "system" : "incremental",
    });
  }
  persistHarnessRecordToCurrentTurn(ctx, record, persistToCurrentTurn);
  return { injected: true, target };
}
