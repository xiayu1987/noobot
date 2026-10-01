/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_SNAPSHOT_WIRE_EVENT, validateTurnLifecycleSnapshot } from "@noobot/session-protocol";
import { createTurnSnapshotEnvelope } from "@noobot/event-protocol/turn-snapshot";
import {
  EXECUTION_QUERY_COMMAND,
  EXECUTION_QUERY_CONTRACT,
  isExecutionQueryTargetValid,
  validateExecutionIdentity,
} from "@noobot/session-protocol/execution-lifecycle";
import { sendFailedCommandReceipt } from "./command-receipt.js";
import { findPendingInteraction } from "./pending-interaction-registry.js";

const EXECUTION_QUERY_READERS = Object.freeze({
  [EXECUTION_QUERY_COMMAND.SNAPSHOT_GET]: Object.freeze({
    method: "getExecution",
    candidates: (result) => [result.execution],
  }),
  [EXECUTION_QUERY_COMMAND.CHILDREN_GET]: Object.freeze({
    method: "getExecutionChildren",
    candidates: (result) => [result.execution, ...(result.children || [])],
  }),
  [EXECUTION_QUERY_COMMAND.TREE_GET]: Object.freeze({
    method: "getExecutionTree",
    candidates: (result) => Object.values(result.tree?.executions || {}),
  }),
});

function sendAuthoritativeTurnSnapshot(sendEvent, command, snapshot) {
  const validation = validateTurnLifecycleSnapshot(snapshot);
  if (!validation.valid) {
    sendFailedCommandReceipt(sendEvent, command, {
      code: "invalid_authoritative_snapshot",
      message: validation.errors.join(","),
    });
    return;
  }
  sendEvent(TURN_SNAPSHOT_WIRE_EVENT, createTurnSnapshotEnvelope(snapshot));
}

export function createMessageQueryHandlers({
  state,
  authInfo,
  sendEvent,
  translateText,
  resolveBot,
  canonicalRunOwnerId,
  recoverTurnFinalize,
  recoverSnapshotOrphan,
}) {
  const handleInteractionResponse = (command) => {
    const requestId = String(command.interaction?.requestId || "").trim();
    const requestItem = findPendingInteraction({ requestId, ownerUserId: canonicalRunOwnerId });
    if (!requestItem) {
      sendFailedCommandReceipt(sendEvent, command, {
        code: "interaction_not_found",
        message: translateText("ws.interactionNotFound", state.currentLocale),
      });
      return;
    }
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
    if (
      !recovered?.recovered &&
      recovered?.reason &&
      recovered.reason !== "no_recoverable_finalize"
    ) {
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
      userId,
      sessionId,
      parentSessionId: String(command.identity?.parentSessionId || "").trim(),
      commandId,
      knownSequence: command.options?.knownSequence,
      terminalLimit: command.options?.terminalLimit,
    });
    if (!result?.found) {
      sendFailedCommandReceipt(sendEvent, command, {
        code: result?.reason || "snapshot_not_found",
      });
      return;
    }
    sendAuthoritativeTurnSnapshot(sendEvent, command, result.snapshot);
  };

  const handleExecutionQuery = async (command, commandType) => {
    const userId = String(authInfo?.userId || "").trim();
    const executionId = String(command.query?.executionId || "").trim();
    const rootExecutionId = String(command.query?.rootExecutionId || "").trim();
    const commandId = String(command.commandId || "").trim();
    const contract = EXECUTION_QUERY_CONTRACT[commandType];
    const readerSpec = EXECUTION_QUERY_READERS[commandType];
    if (
      !userId ||
      !commandId ||
      !readerSpec ||
      !isExecutionQueryTargetValid(commandType, { executionId, rootExecutionId })
    ) {
      sendFailedCommandReceipt(sendEvent, command, { code: "invalid_execution_query" });
      return;
    }
    const bot = resolveBot();
    const reader = bot?.[readerSpec.method];
    if (typeof reader !== "function") {
      sendFailedCommandReceipt(sendEvent, command, { code: "execution_query_unavailable" });
      return;
    }
    const result = await reader.call(bot, { userId, executionId, rootExecutionId });
    if (!result?.found) {
      sendFailedCommandReceipt(sendEvent, command, {
        code: result?.reason || "execution_not_found",
      });
      return;
    }
    const candidates = readerSpec.candidates(result);
    const invalid = candidates.find((item) => !validateExecutionIdentity(item).valid);
    if (invalid) {
      sendFailedCommandReceipt(sendEvent, command, { code: "invalid_authoritative_execution" });
      return;
    }
    sendEvent(contract.wireEvent, { ...result, commandId });
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
    sendAuthoritativeTurnSnapshot(sendEvent, command, result?.result?.snapshot);
  };

  return { handleInteractionResponse, handleSnapshotGet, handleExecutionQuery, handleFinalize };
}
