/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { createTransferIdentity } from "@noobot/semantic-transfer-protocol";
import { safeStr } from "../../shared/utils/shared-utils.js";

export function resolveRuntimeTransferIdentity({
  runtime,
  producer = null,
  direction = "output",
  strategy = "semantic_transfer",
  transferKey = "",
} = {}) {
  if (!isPlainObject(producer)) throw new Error("semantic_transfer_producer_required");
  const producerType = safeStr(producer.type);
  const producerId = safeStr(producer.id);
  const { runConfig, systemRuntime } = runtime;
  const presentationMessageId = safeStr(runConfig.presentationMessageId);
  const resolvedSessionId = safeStr(systemRuntime.sessionId);
  const turnScopeId = safeStr(systemRuntime.turnScopeId);
  const runId = safeStr(runConfig.executionId);
  if (
    !presentationMessageId ||
    !resolvedSessionId ||
    !turnScopeId ||
    !runId ||
    !producerType ||
    !producerId
  ) {
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
      presentationMessageId,
      producerType,
      producerId,
      normalizedDirection,
      normalizedStrategy,
      normalizedTransferKey,
    ]
      .filter(Boolean)
      .join(":"),
    presentationMessageId,
    sessionId: identity.sessionId,
    turnScopeId: identity.turnScopeId,
    runId: identity.runId,
    producer: identity.producer,
  });
}
