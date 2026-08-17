/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { validateTurnLifecycleSnapshot } from "@noobot/session-protocol";
import { createTurnSnapshotEnvelope } from "@noobot/event-protocol/turn-snapshot";
import {
  EXECUTION_QUERY_COMMAND,
  EXECUTION_CHILDREN_WIRE_EVENT,
  EXECUTION_SNAPSHOT_WIRE_EVENT,
  EXECUTION_TREE_WIRE_EVENT,
  validateExecutionIdentity,
} from "@noobot/session-protocol/execution-lifecycle";
import { sendFailedCommandReceipt } from "./command-receipt.js";

export function createMessageQueryHandlers({
  state, authInfo, sendEvent, translateText, resolveBot,
  pendingInteractionRequests, recoverTurnFinalize, recoverSnapshotOrphan,
}) {
  const handleInteractionResponse = (command) => {
    const requestId = String(command.interaction?.requestId || "").trim();
    const requestItem = pendingInteractionRequests.get(requestId);
    if (!requestItem) {
      sendFailedCommandReceipt(sendEvent, command, {
        code: "interaction_not_found",
        message: translateText("ws.interactionNotFound", state.currentLocale),
      });
      return;
    }
    pendingInteractionRequests.delete(requestId);
    clearTimeout(requestItem.timer);
    requestItem.resolve(command.interaction?.response ?? {});
  };

  const handleSnapshotGet = async (command) => {
    const userId = String(authInfo?.userId || "").trim();
    const sessionId = String(command.identity?.sessionId || "").trim();
    const commandId = String(command.commandId || "").trim();
    if (!userId || !sessionId || !commandId) {
      sendFailedCommandReceipt(sendEvent, command, { code: "invalid_snapshot_request" });
      return;
    }
    const recovered = await recoverTurnFinalize?.({
      userId,
      sessionId,
      parentSessionId: String(command.identity?.parentSessionId || "").trim(),
      commandId: `${commandId}:recovery`,
      terminalLimit: command.options?.terminalLimit,
    });
    if (!recovered?.recovered && recovered?.reason && recovered.reason !== "no_recoverable_finalize") {
      sendFailedCommandReceipt(sendEvent, command, { code: recovered.reason });
      return;
    }
    await recoverSnapshotOrphan?.({
      userId,
      sessionId,
      parentSessionId: String(command.identity?.parentSessionId || "").trim(),
      commandId: `${commandId}:orphan-recovery`,
      terminalLimit: command.options?.terminalLimit,
    });
    const bot = resolveBot();
    const reader = bot?.getTurnLifecycleSnapshot;
    if (typeof reader !== "function") {
      sendFailedCommandReceipt(sendEvent, command, { code: "lifecycle_snapshot_unavailable" });
      return;
    }
    const result = await reader.call(bot, {
      userId, sessionId, parentSessionId: String(command.identity?.parentSessionId || "").trim(),
      commandId, knownSequence: command.options?.knownSequence, terminalLimit: command.options?.terminalLimit,
    });
    if (!result?.found) {
      sendFailedCommandReceipt(sendEvent, command, { code: result?.reason || "snapshot_not_found" });
      return;
    }
    const validation = validateTurnLifecycleSnapshot(result.snapshot);
    if (!validation.valid) {
      sendFailedCommandReceipt(sendEvent, command, {
        code: "invalid_authoritative_snapshot",
        message: validation.errors.join(","),
      });
      return;
    }
    sendEvent("turn_snapshot", createTurnSnapshotEnvelope(result.snapshot));
  };

  const handleExecutionQuery = async (command, commandType) => {
    const userId = String(authInfo?.userId || "").trim();
    const executionId = String(command.query?.executionId || "").trim();
    const rootExecutionId = String(command.query?.rootExecutionId || "").trim();
    const commandId = String(command.commandId || "").trim();
    const query = commandType === EXECUTION_QUERY_COMMAND.SNAPSHOT_GET
      ? { method: "getExecution", event: EXECUTION_SNAPSHOT_WIRE_EVENT, requiresExecutionId: true }
      : commandType === EXECUTION_QUERY_COMMAND.CHILDREN_GET
        ? { method: "getExecutionChildren", event: EXECUTION_CHILDREN_WIRE_EVENT, requiresExecutionId: true }
        : { method: "getExecutionTree", event: EXECUTION_TREE_WIRE_EVENT, requiresExecutionId: false };
    if (!userId || !commandId || (query.requiresExecutionId ? !executionId : (!executionId && !rootExecutionId))) {
      sendFailedCommandReceipt(sendEvent, command, { code: "invalid_execution_query" });
      return;
    }
    const bot = resolveBot();
    const reader = bot?.[query.method];
    if (typeof reader !== "function") {
      sendFailedCommandReceipt(sendEvent, command, { code: "execution_query_unavailable" });
      return;
    }
    const result = await reader.call(bot, { userId, executionId, rootExecutionId });
    if (!result?.found) {
      sendFailedCommandReceipt(sendEvent, command, { code: result?.reason || "execution_not_found" });
      return;
    }
    const candidates = query.method === "getExecution"
      ? [result.execution]
      : query.method === "getExecutionChildren"
        ? [result.execution, ...(result.children || [])]
        : Object.values(result.tree?.executions || {});
    const invalid = candidates.find((item) => !validateExecutionIdentity(item).valid);
    if (invalid) {
      sendFailedCommandReceipt(sendEvent, command, { code: "invalid_authoritative_execution" });
      return;
    }
    sendEvent(query.event, { ...result, commandId });
  };

  const handleFinalize = async (command) => {
    const userId = String(authInfo?.userId || "").trim();
    const sessionId = String(command.identity?.sessionId || "").trim();
    const commandId = String(command.commandId || "").trim();
    if (!userId || !sessionId || !commandId) {
      sendFailedCommandReceipt(sendEvent, command, { code: "invalid_finalize_request" });
      return;
    }
    const result = await recoverTurnFinalize?.({
      userId,
      sessionId,
      parentSessionId: String(command.identity?.parentSessionId || "").trim(),
      commandId,
      terminalLimit: command.options?.terminalLimit,
    });
    if (!result?.recovered && result?.reason !== "no_recoverable_finalize") {
      sendFailedCommandReceipt(sendEvent, command, {
        code: result?.reason || "finalize_recovery_failed",
      });
      return;
    }
    const snapshot = result?.result?.snapshot;
    const validation = validateTurnLifecycleSnapshot(snapshot);
    if (!validation.valid) {
      sendFailedCommandReceipt(sendEvent, command, {
        code: "invalid_authoritative_snapshot",
        message: validation.errors.join(","),
      });
      return;
    }
    sendEvent("turn_snapshot", createTurnSnapshotEnvelope(snapshot));
  };

  return { handleInteractionResponse, handleSnapshotGet, handleExecutionQuery, handleFinalize };
}
