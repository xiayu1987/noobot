/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_SNAPSHOT_WIRE_EVENT, validateTurnLifecycleSnapshot } from "@noobot/session-protocol";
import { createTurnSnapshotEnvelope } from "@noobot/event-protocol/turn-snapshot";
import { createExecutionQueryEnvelope } from "@noobot/event-protocol/execution-query";
import {
  EXECUTION_QUERY_COMMAND,
  EXECUTION_QUERY_CONTRACT,
} from "@noobot/session-protocol/execution-lifecycle";
import { sendFailedCommandReceipt } from "./command-receipt.js";
import { findPendingInteraction } from "./pending-interaction-registry.js";
import { text } from "@noobot/shared/value";

const EXECUTION_QUERY_READERS = Object.freeze({
  [EXECUTION_QUERY_COMMAND.SNAPSHOT_GET]: Object.freeze({
    method: "getExecution",
    payload: ({ execution }) => ({ execution }),
  }),
  [EXECUTION_QUERY_COMMAND.CHILDREN_GET]: Object.freeze({
    method: "getExecutionChildren",
    payload: ({ execution, children }) => ({ execution, children }),
  }),
  [EXECUTION_QUERY_COMMAND.TREE_GET]: Object.freeze({
    method: "getExecutionTree",
    payload: ({ rootExecutionId, tree }) => ({ rootExecutionId, tree }),
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

function resolveTurnCommandIdentity(userId, command) {
  return {
    identity: {
      userId,
      sessionId: command.identity.sessionId,
      parentSessionId: command.identity.parentSessionId,
    },
    commandId: command.commandId,
    terminalLimit: command.options.terminalLimit,
  };
}

export function createMessageQueryHandlers({
  state,
  sendEvent,
  translateText,
  resolveBot,
  canonicalRunOwnerId,
  turnRecovery,
}) {
  const sendMissingOwnerReceipt = (command, code) =>
    sendFailedCommandReceipt(sendEvent, command, {
      code,
      message: translateText("ws.unauthorized", state.currentLocale),
    });
  const sendReadFailureReceipt = (command, reason) =>
    sendFailedCommandReceipt(sendEvent, command, {
      code: reason,
      message: translateText("ws.commandReadFailed", state.currentLocale),
    });

  const handleInteractionResponse = (command) => {
    const requestId = text(command.interaction?.requestId);
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
    if (!canonicalRunOwnerId) {
      sendMissingOwnerReceipt(command, "invalid_snapshot_request");
      return;
    }
    const { identity, commandId, terminalLimit } = resolveTurnCommandIdentity(
      canonicalRunOwnerId,
      command,
    );
    const result = await turnRecovery.readSnapshot({
      ...identity,
      commandId,
      knownSequence: command.options.knownSequence,
      terminalLimit,
    });
    if (!result.found) {
      sendReadFailureReceipt(command, result.reason);
      return;
    }
    sendAuthoritativeTurnSnapshot(sendEvent, command, result.snapshot);
  };

  const handleExecutionQuery = async (command, commandType) => {
    const userId = canonicalRunOwnerId;
    const { executionId, rootExecutionId } = command.query;
    const { commandId } = command;
    const contract = EXECUTION_QUERY_CONTRACT[commandType];
    const readerSpec = EXECUTION_QUERY_READERS[commandType];
    if (!userId) {
      sendMissingOwnerReceipt(command, "invalid_execution_query");
      return;
    }
    const { session } = resolveBot();
    const result = await session[readerSpec.method]({ userId, executionId, rootExecutionId });
    if (!result.found) {
      sendReadFailureReceipt(command, result.reason);
      return;
    }
    let envelope;
    try {
      envelope = createExecutionQueryEnvelope({
        wireEvent: contract.wireEvent,
        commandId,
        executionId: result.execution?.executionId,
        payload: readerSpec.payload(result),
        occurredAt: result.generatedAt,
      });
    } catch (error) {
      sendFailedCommandReceipt(sendEvent, command, {
        code: "invalid_authoritative_execution",
        message: error.message,
      });
      return;
    }
    sendEvent(contract.wireEvent, envelope);
  };

  const handleFinalize = async (command) => {
    if (!canonicalRunOwnerId) {
      sendMissingOwnerReceipt(command, "invalid_finalize_request");
      return;
    }
    const { identity, commandId, terminalLimit } = resolveTurnCommandIdentity(
      canonicalRunOwnerId,
      command,
    );
    const result = await turnRecovery.finalize({ ...identity, commandId, terminalLimit });
    if (!result.snapshot) {
      sendReadFailureReceipt(command, result.reason);
      return;
    }
    sendAuthoritativeTurnSnapshot(sendEvent, command, result.snapshot);
  };

  return { handleInteractionResponse, handleSnapshotGet, handleExecutionQuery, handleFinalize };
}
