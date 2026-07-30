/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_PHASE, validateTurnLifecycleSnapshot } from "@noobot/authoritative-state/contracts";
import {
  EXECUTION_QUERY_COMMAND,
  EXECUTION_CHILDREN_WIRE_EVENT,
  EXECUTION_SNAPSHOT_WIRE_EVENT,
  EXECUTION_TREE_WIRE_EVENT,
  validateExecutionIdentity,
} from "@noobot/shared/execution-lifecycle-protocol";

export function createMessageQueryHandlers({
  state, authInfo, sendEvent, translateText, isForbiddenUserScope, resolveBot,
  pendingInteractionRequests, recoverTurnFinalize,
}) {
  const handleInteractionResponse = (payload) => {
    const requestId = String(payload?.requestId || "").trim();
    const requestItem = pendingInteractionRequests.get(requestId);
    if (!requestItem) {
      sendEvent("error", { error: translateText("ws.interactionNotFound", state.currentLocale) });
      return;
    }
    pendingInteractionRequests.delete(requestId);
    clearTimeout(requestItem.timer);
    requestItem.resolve(payload?.response ?? {});
  };

  const handleSnapshotGet = async (payload) => {
    const userId = String(payload?.userId || authInfo?.userId || "").trim();
    const sessionId = String(payload?.sessionId || "").trim();
    const commandId = String(payload?.commandId || "").trim();
    if (!userId || !sessionId || !commandId || isForbiddenUserScope(authInfo, userId)) {
      sendEvent("error", { errorCode: "invalid_snapshot_request", sessionId, commandId });
      return;
    }
    const bot = resolveBot();
    const reader = bot?.getTurnLifecycleSnapshot;
    if (typeof reader !== "function") {
      sendEvent("error", { errorCode: "lifecycle_snapshot_unavailable", sessionId, commandId });
      return;
    }
    const result = await reader.call(bot, {
      userId, sessionId, parentSessionId: String(payload?.parentSessionId || "").trim(),
      commandId, knownSequence: payload?.knownSequence, terminalLimit: payload?.terminalLimit,
    });
    if (!result?.found) {
      sendEvent("error", { errorCode: result?.reason || "snapshot_not_found", sessionId, commandId });
      return;
    }
    const validation = validateTurnLifecycleSnapshot(result.snapshot);
    if (!validation.valid) {
      sendEvent("error", { errorCode: "invalid_authoritative_snapshot", errors: validation.errors, sessionId, commandId });
      return;
    }
    sendEvent("turn_snapshot", result.snapshot);
  };

  const handleExecutionQuery = async (payload, commandType) => {
    const userId = String(payload?.userId || authInfo?.userId || "").trim();
    const executionId = String(payload?.executionId || "").trim();
    const rootExecutionId = String(payload?.rootExecutionId || "").trim();
    const commandId = String(payload?.commandId || "").trim();
    const query = commandType === EXECUTION_QUERY_COMMAND.SNAPSHOT_GET
      ? { method: "getExecution", event: EXECUTION_SNAPSHOT_WIRE_EVENT, requiresExecutionId: true }
      : commandType === EXECUTION_QUERY_COMMAND.CHILDREN_GET
        ? { method: "getExecutionChildren", event: EXECUTION_CHILDREN_WIRE_EVENT, requiresExecutionId: true }
        : { method: "getExecutionTree", event: EXECUTION_TREE_WIRE_EVENT, requiresExecutionId: false };
    if (!userId || !commandId || (query.requiresExecutionId ? !executionId : (!executionId && !rootExecutionId)) || isForbiddenUserScope(authInfo, userId)) {
      sendEvent("error", { errorCode: "invalid_execution_query", executionId, rootExecutionId, commandId });
      return;
    }
    const bot = resolveBot();
    const reader = bot?.[query.method];
    if (typeof reader !== "function") {
      sendEvent("error", { errorCode: "execution_query_unavailable", executionId, rootExecutionId, commandId });
      return;
    }
    const result = await reader.call(bot, { userId, executionId, rootExecutionId });
    if (!result?.found) {
      sendEvent("error", { errorCode: result?.reason || "execution_not_found", executionId, rootExecutionId, commandId });
      return;
    }
    const candidates = query.method === "getExecution"
      ? [result.execution]
      : query.method === "getExecutionChildren"
        ? [result.execution, ...(result.children || [])]
        : Object.values(result.tree?.executions || {});
    const invalid = candidates.find((item) => !validateExecutionIdentity(item).valid);
    if (invalid) {
      sendEvent("error", { errorCode: "invalid_authoritative_execution", executionId, rootExecutionId, commandId });
      return;
    }
    sendEvent(query.event, { ...result, commandId });
  };

  const handleFinalize = async (payload) => {
    const userId = String(payload?.userId || authInfo?.userId || "").trim();
    const sessionId = String(payload?.sessionId || "").trim();
    const commandId = String(payload?.commandId || "").trim();
    if (!userId || !sessionId || !commandId || isForbiddenUserScope(authInfo, userId)) {
      sendEvent("error", { errorCode: "invalid_finalize_request", sessionId, commandId });
      return;
    }
    const result = await recoverTurnFinalize?.({
      userId,
      sessionId,
      parentSessionId: String(payload?.parentSessionId || "").trim(),
      commandId,
      terminalLimit: payload?.terminalLimit,
    });
    if (!result?.recovered && result?.reason !== "no_recoverable_finalize") {
      sendEvent("error", {
        errorCode: result?.reason || "finalize_recovery_failed",
        failurePhase: TURN_PHASE.COMPLETION,
        sessionId,
        commandId,
      });
      return;
    }
    const snapshot = result?.result?.snapshot;
    const validation = validateTurnLifecycleSnapshot(snapshot);
    if (!validation.valid) {
      sendEvent("error", { errorCode: "invalid_authoritative_snapshot", errors: validation.errors, sessionId, commandId });
      return;
    }
    sendEvent("turn_snapshot", snapshot);
  };

  return { handleInteractionResponse, handleSnapshotGet, handleExecutionQuery, handleFinalize };
}
