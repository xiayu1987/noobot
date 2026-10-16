/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AGENT_COMMAND } from "@noobot/agent-transport-protocol";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import {
  SESSION_ERROR_CODE,
  TURN_ACTION,
  TURN_EVENT,
  TURN_PHASE,
  createAssistantMessageEventId,
  createTurnAcceptanceReceipt,
  createTurnLifecycleCommandId,
} from "@noobot/session-protocol";
import {
  TURN_COMMITTED_WIRE_EVENT,
  assertTurnCommittedEventData,
} from "@noobot/session-protocol/turn-commit";
import { createAgentApplication } from "#agent/application";
import { resolveAuthoritativeConnectorSelection } from "../../../services/chat-run-service.js";
import { attachRunTransport, findActiveRun } from "../run-registry.js";
import {
  recordServiceAgentTransportDebug,
  recordServiceWebSocketLifecycle,
  summarizeDebugAttachments,
} from "../runtime-events.js";
import { text } from "@noobot/shared/value";

export async function mapRunCommand(context, command) {
  const mapped = await resolveAuthoritativeConnectorSelection({
    bot: context.resolveBot(),
    connectorAccessPort: context.connectorAccessPort,
    request: context.mapAgentRunCommand(command, { userId: context.authInfo?.userId }),
  });
  context.state.currentTurnScopeId = text(mapped.turnScopeId);
  context.state.currentLocale = context.normalizeLocale(
    mapped.runConfig.locale || context.state.currentLocale,
  );
  return { ...mapped, normalizedRunConfig: mapped.runConfig };
}

export function recordReceivedCommand(context, command, run) {
  void writeRuntimeEvent({
    scope: "session",
    source: "service",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
    event: "debug.resend.websocket.received",
    userId: text(run.userId),
    sessionId: text(run.sessionId),
    parentSessionId: text(run.parentSessionId),
    turnScopeId: text(run.turnScopeId),
    data: {
      commandType: command.commandType,
      reuseExistingUserTurn: run.normalizedRunConfig.reuseExistingUserTurn === true,
      attachments: summarizeDebugAttachments(run.attachments),
    },
  });
}

export function validateRunIdentity(context, run) {
  if (!run.userId || !run.sessionId || !run.message) {
    throw new Error(
      context.translateText("common.userSessionMessageRequired", context.state.currentLocale),
    );
  }
}

export async function bindExistingRun(context, run, onRunBound) {
  const runningTurn = findActiveRun({
    userId: context.canonicalRunOwnerId,
    sessionId: run.sessionId,
    turnScopeId: context.state.currentTurnScopeId,
    dialogProcessId: run.dialogProcessId,
  });
  if (!runningTurn || runningTurn.abortController?.signal?.aborted) return false;
  context.state.currentRunHandle = runningTurn;
  context.state.currentRunTransportBinding = attachRunTransport(runningTurn, context.sendEvent, {
    onDiagnostic: context.recordRunTransportDiagnostic(runningTurn),
  });
  onRunBound?.(runningTurn);
  await context.dispatchAuthorityEvents?.({
    userId: run.userId,
    sessionId: run.sessionId,
    parentSessionId: run.parentSessionId,
  });
  void recordServiceWebSocketLifecycle({
    event: "service.websocket.run.transportRebound",
    userId: run.userId,
    sessionId: run.sessionId,
    dialogProcessId: runningTurn.dialogProcessId,
    turnScopeId: context.state.currentTurnScopeId,
  });
  return true;
}

const RUN_COMMAND_TURN_ACTION = Object.freeze({
  [AGENT_COMMAND.SEND]: TURN_ACTION.SEND,
  [AGENT_COMMAND.RESEND]: TURN_ACTION.RESEND,
  [AGENT_COMMAND.CONTINUE]: TURN_ACTION.CONTINUE,
});

function createActionEvent(context, command, run, executionIntent, startedAt) {
  const commandId = text(command.commandId);
  const isContinue = command.commandType === AGENT_COMMAND.CONTINUE;
  return {
    userId: run.userId,
    sessionId: run.sessionId,
    parentSessionId: run.parentSessionId,
    turnScopeId: context.state.currentTurnScopeId,
    dialogProcessId: run.dialogProcessId,
    commandId: createTurnLifecycleCommandId({
      commandId,
      eventType: TURN_EVENT.ACTION_ACCEPTED,
      phase: TURN_PHASE.ACTION,
    }),
    causationId: commandId,
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    phase: TURN_PHASE.ACTION,
    action: RUN_COMMAND_TURN_ACTION[command.commandType],
    messageId: run.normalizedRunConfig.messageId,
    presentationMessageId: run.normalizedRunConfig.presentationMessageId,
    startedAt,
    createSessionIfAbsent: run.createSessionIfAbsent,
    expectedRevision: run.expectedRevision,
    expectedAggregateVersion: run.normalizedRunConfig.expectedAggregateVersion,
    ...executionIntent,
    ...(![AGENT_COMMAND.RESEND].includes(command.commandType)
      ? {
          userMessage: {
            content: run.message,
            messageId: run.normalizedRunConfig.userMessageId,
            parentDialogProcessId: run.parentDialogProcessId,
            messageOrigin: "natural",
            userMetaMaterialized: true,
          },
        }
      : {}),
    ...(isContinue
      ? {
          continuationSource: {
            dialogProcessId: run.normalizedRunConfig.resumeDialogProcessId,
            turnScopeId: run.normalizedRunConfig.resumeTurnScopeId,
          },
        }
      : {}),
  };
}

function rejectedActionError(accepted) {
  const error = new Error(accepted?.reason || "action_rejected");
  error.code = accepted?.reason || "action_rejected";
  error.currentVersion = accepted?.currentVersion;
  if (accepted?.reason === SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT) error.statusCode = 409;
  return error;
}

async function commitAction(context, actionEvent, run) {
  let accepted = await context.commitTurnLifecycle(actionEvent);
  if (
    !accepted?.applied &&
    !accepted?.deduplicated &&
    (await context.recoverConflictingTurn({
      accepted,
      userId: run.userId,
      sessionId: run.sessionId,
      parentSessionId: run.parentSessionId,
    }))
  ) {
    accepted = await context.commitTurnLifecycle(actionEvent);
  }
  if (!accepted?.applied && !accepted?.deduplicated) throw rejectedActionError(accepted);
  return accepted;
}

export async function acceptRunCommand(context, command, run) {
  const startedAt = new Date().toISOString();
  run.normalizedRunConfig.thinkingStartedAt = startedAt;
  run.normalizedRunConfig.messageId = createAssistantMessageEventId(
    run.normalizedRunConfig.presentationMessageId,
  );
  const activeBot = context.resolveBot();
  const agentApplication = createAgentApplication({ runtime: activeBot });
  const executionIntent = await agentApplication.resolveExecutionIntent({
    userId: run.userId,
    sessionId: run.sessionId,
    parentSessionId: run.parentSessionId,
    turnScopeId: context.state.currentTurnScopeId,
    runConfig: run.normalizedRunConfig,
  });
  Object.assign(run.normalizedRunConfig, executionIntent);
  const actionEvent = createActionEvent(context, command, run, executionIntent, startedAt);
  const accepted = await commitAction(context, actionEvent, run);
  run.dialogProcessId = text(accepted.dialogProcessId);
  if (command.commandType !== AGENT_COMMAND.RESEND) {
    const committedEvent = assertTurnCommittedEventData({
      sessionId: run.sessionId,
      aggregateVersion: accepted.aggregateVersion,
      dialogProcessId: run.dialogProcessId,
      turnScopeId: context.state.currentTurnScopeId,
      userMessage: accepted.userMessage,
    });
    context.sendEvent(TURN_COMMITTED_WIRE_EVENT, committedEvent);
    run.turnAcceptance = createTurnAcceptanceReceipt({
      commandId: text(command.commandId),
      sessionId: run.sessionId,
      turnScopeId: context.state.currentTurnScopeId,
      dialogProcessId: run.dialogProcessId,
      messageUid: accepted.userMessage.messageUid,
      aggregateVersion: accepted.aggregateVersion,
      committedEventPublished: true,
    });
  }
  if (
    run.createSessionIfAbsent === true &&
    run.normalizedRunConfig.selectedConnectorIds.length > 0
  ) {
    await activeBot.session.setRootSessionSelectedConnectorIds({
      userId: run.userId,
      sessionId: run.sessionId,
      selectedConnectorIds: run.normalizedRunConfig.selectedConnectorIds,
    });
  }
  context.lifecycle.pending = null;
  context.lifecycle.latestTurn = accepted.turn || null;
  void recordServiceAgentTransportDebug({
    event: "service.agentTransport.commandConsumed",
    command,
    userId: run.userId,
    data: {
      accepted: true,
      consumed: true,
      transport: "websocket",
      lifecycleEventType: TURN_EVENT.ACTION_ACCEPTED,
      lifecycleRevision: Number(accepted?.turn?.revision || accepted?.currentRevision || 0),
    },
  });
  context.state.currentLifecycleCommandId = text(command.commandId);
  context.state.currentLifecyclePhase = TURN_PHASE.ACTION;
  return { activeBot, agentApplication, commandId: text(command.commandId) };
}
