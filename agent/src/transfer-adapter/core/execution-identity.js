/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTransferIdentity } from "@noobot/semantic-transfer-protocol";
import { currentAssistantMessageId } from "../../events/message-event-stream.js";
import { isPlainObject, safeStr } from "../../shared/utils/shared-utils.js";

export function resolveRuntimeTransferIdentity({
  runtime = {},
  agentContext = null,
  sessionId = "",
  producer = null,
  direction = "output",
  strategy = "semantic_transfer",
  transferKey = "",
} = {}) {
  if (!isPlainObject(producer)) throw new Error("semantic_transfer_producer_required");
  const producerType = safeStr(producer.type);
  const producerId = safeStr(producer.id || producer.name);
  const runConfig = isPlainObject(runtime?.runConfig) ? runtime.runConfig : {};
  const contextIdentity = isPlainObject(agentContext?.context?.identity)
    ? agentContext.context.identity
    : {};
  const messageId = safeStr(
    runConfig.messageId ||
      runtime?.systemRuntime?.messageId ||
      contextIdentity.messageId ||
      currentAssistantMessageId(runtime),
  );
  const resolvedSessionId = safeStr(
    sessionId || runConfig.sessionId || runtime?.systemRuntime?.sessionId || runtime?.sessionId || contextIdentity.sessionId,
  );
  const turnScopeId = safeStr(runConfig.turnScopeId || runtime?.systemRuntime?.turnScopeId || contextIdentity.turnScopeId);
  const runId = safeStr(runConfig.executionId || runtime?.systemRuntime?.executionId || contextIdentity.runId);
  if (!messageId || !resolvedSessionId || !turnScopeId || !runId || !producerType || !producerId) {
    throw new Error("semantic_transfer_execution_identity_incomplete");
  }
  const normalizedDirection = safeStr(direction);
  const normalizedStrategy = safeStr(strategy);
  const normalizedTransferKey = safeStr(transferKey);
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
