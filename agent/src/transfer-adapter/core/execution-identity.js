/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTransferIdentity } from "@noobot/semantic-transfer-protocol";
import { currentAssistantMessageId } from "../../events/message-event-stream.js";

function text(value = "") {
  return String(value ?? "").trim();
}

function plain(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function resolveRuntimeTransferIdentity({
  runtime = {},
  agentContext = null,
  sessionId = "",
  producer = null,
  direction = "output",
  strategy = "semantic_transfer",
  transferKey = "",
} = {}) {
  if (!plain(producer)) throw new Error("semantic_transfer_producer_required");
  const producerType = text(producer.type);
  const producerId = text(producer.id || producer.name);
  const runConfig = plain(runtime?.runConfig) ? runtime.runConfig : {};
  const contextIdentity = plain(agentContext?.context?.identity)
    ? agentContext.context.identity
    : {};
  const messageId = text(
    runConfig.messageId ||
      runtime?.systemRuntime?.messageId ||
      contextIdentity.messageId ||
      currentAssistantMessageId(runtime),
  );
  const resolvedSessionId = text(
    sessionId || runConfig.sessionId || runtime?.systemRuntime?.sessionId || runtime?.sessionId || contextIdentity.sessionId,
  );
  const turnScopeId = text(runConfig.turnScopeId || runtime?.systemRuntime?.turnScopeId || contextIdentity.turnScopeId);
  const runId = text(runConfig.executionId || runtime?.systemRuntime?.executionId || contextIdentity.runId);
  if (!messageId || !resolvedSessionId || !turnScopeId || !runId || !producerType || !producerId) {
    throw new Error("semantic_transfer_execution_identity_incomplete");
  }
  const normalizedDirection = text(direction);
  const normalizedStrategy = text(strategy);
  const normalizedTransferKey = text(transferKey);
  const identity = createTransferIdentity({
    sessionId: resolvedSessionId,
    turnScopeId,
    runId,
    producer: { type: producerType, id: producerId },
  });
  return Object.freeze({
    transferId: [
      "transfer",
      messageId,
      producerType,
      producerId,
      normalizedDirection,
      normalizedStrategy,
      normalizedTransferKey,
    ].filter(Boolean).join(":"),
    messageId,
    sessionId: identity.sessionId,
    turnScopeId: identity.turnScopeId,
    runId: identity.runId,
    producer: identity.producer,
  });
}
