/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import {
  createPresentationMessageId,
  createUserMessageId,
} from "@noobot/session-protocol/message-identity";
import {
  AGENT_COMMAND,
  ROOT_PARENT_SESSION_ID,
  createInteractionResponseCommand,
  createTurnRunCommand,
  createTurnStopCommand,
} from "@noobot/agent-transport-protocol";
import { CLI_ACTION } from "./cli-args.js";
import { createTurnTracker, readCliTurnEvent, readInteractionRequest } from "./turn-events.js";
import { classifyInteractionRequest } from "./interaction-prompt.js";

export const CLI_EXIT_CODE = Object.freeze({
  DONE: 0,
  FAILED: 1,
  USAGE: 2,
  INTERACTION_UNAVAILABLE: 3,
  STOPPED: 130,
});

export const TURN_STATUS_REJECTED_REASON = "turn_status_persistence_failed";

export const CLIENT_CLOSE_REASON = Object.freeze({
  INTERRUPTED: "client_interrupted",
  INTERACTION_UNAVAILABLE: "client_interaction_unavailable",
  INTERACTION_FAILED: "client_interaction_failed",
  PROTOCOL_EVENT_REJECTED: "client_protocol_event_rejected",
});

export function createCliTurnIdentity({ sessionId }) {
  if (typeof sessionId !== "string" || !sessionId) throw new TypeError("cli_session_id_required");
  return {
    sessionId,
    turnScopeId: `cli-turn:${randomUUID()}`,
    userMessageId: createUserMessageId(),
    presentationMessageId: createPresentationMessageId(),
  };
}

export function buildRunCommand({
  invocation,
  identity,
  attachments,
  aggregateVersion,
  createSession,
}) {
  const isContinue = invocation.action === CLI_ACTION.RESUME_TURN;
  return createTurnRunCommand({
    commandType: isContinue ? AGENT_COMMAND.CONTINUE : AGENT_COMMAND.SEND,
    identity: {
      sessionId: identity.sessionId,
      parentSessionId: ROOT_PARENT_SESSION_ID,
      turnScopeId: identity.turnScopeId,
    },
    input: { message: invocation.message, attachments },
    preferences: invocation.preferences,
    presentation: {
      userMessageId: identity.userMessageId,
      presentationMessageId: identity.presentationMessageId,
    },
    concurrency: { expectedTurnRevision: 0, expectedAggregateVersion: aggregateVersion },
    session: {
      createIfAbsent: createSession,
      selectedConnectorIds: createSession ? invocation.selectedConnectorIds : [],
    },
    ...(isContinue
      ? {
          continuation: {
            dialogProcessId: invocation.dialogProcessId,
            turnScopeId: invocation.turnScopeId,
          },
        }
      : {}),
  });
}

export async function runCliTurn({
  transport,
  authInfo,
  command,
  identity,
  renderer,
  allowInteraction = false,
  askInteraction,
  signalSource = process,
}) {
  const tracker = createTurnTracker(identity);
  let interactionFailure = "";
  let interrupted = false;
  let stopRequested = false;
  let connection = null;

  function requestStop() {
    if (stopRequested || tracker.state.revision < 1 || !connection.isOpen()) return false;
    stopRequested = true;
    connection.send(
      createTurnStopCommand({
        identity: {
          sessionId: identity.sessionId,
          parentSessionId: ROOT_PARENT_SESSION_ID,
          turnScopeId: identity.turnScopeId,
        },
        concurrency: { expectedTurnRevision: tracker.state.revision },
        stop: { executionId: tracker.state.executionId },
      }),
    );
    return true;
  }

  async function answerInteraction(request) {
    const decision = classifyInteractionRequest(request, { allowInteraction });
    if (decision.kind === "ignore") return;
    if (decision.kind === "unavailable") {
      interactionFailure = decision.reason;
      renderer.notice(`interaction unavailable: ${decision.reason}`);
      if (!requestStop()) connection.close(CLIENT_CLOSE_REASON.INTERACTION_UNAVAILABLE);
      return;
    }
    const response = await askInteraction(request);
    if (!connection.isOpen()) return;
    connection.send(
      createInteractionResponseCommand({
        identity: {
          sessionId: identity.sessionId,
          turnScopeId: identity.turnScopeId,
          dialogProcessId: request.dialogProcessId,
        },
        interaction: { requestId: request.requestId, response },
      }),
    );
  }

  function onEvent(packet) {
    const turnEvent = readCliTurnEvent(packet);
    if (turnEvent && !turnEvent.valid) {
      renderer.notice(`protocol event rejected: ${turnEvent.event} ${turnEvent.errors.join(",")}`);
      connection.close(CLIENT_CLOSE_REASON.PROTOCOL_EVENT_REJECTED);
      return;
    }
    renderer.event(packet, turnEvent);
    if (!turnEvent) return;
    tracker.apply(turnEvent);
    const request = readInteractionRequest(turnEvent);
    if (!request) return;
    answerInteraction(request).catch((error) => {
      renderer.notice(`interaction failed: ${error.message}`);
      connection.close(CLIENT_CLOSE_REASON.INTERACTION_FAILED);
    });
  }

  function onSigint() {
    interrupted = true;
    if (requestStop()) {
      renderer.notice("stopping turn (Ctrl-C again to force)");
      return;
    }
    connection.close(CLIENT_CLOSE_REASON.INTERRUPTED);
  }

  connection = transport.openConnection({ authInfo, locale: command.preferences?.locale, onEvent });
  signalSource.on("SIGINT", onSigint);
  try {
    connection.send(command);
    const outcome = await connection.closed;
    let exitCode = outcome.exitCode;
    if (interactionFailure) exitCode = CLI_EXIT_CODE.INTERACTION_UNAVAILABLE;
    else if (interrupted) exitCode = CLI_EXIT_CODE.STOPPED;
    const rejected =
      outcome.reason === TURN_STATUS_REJECTED_REASON && !interrupted && tracker.state.revision < 1;
    return { outcome, exitCode, tracker, rejected };
  } finally {
    signalSource.off("SIGINT", onSigint);
  }
}
