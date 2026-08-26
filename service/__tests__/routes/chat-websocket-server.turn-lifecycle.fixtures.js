/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WebSocket } from "ws";
import {
  commitTurnLifecycle,
  createAuthoritativeTurnSnapshot,
} from "@noobot/authoritative-state/application";
import {
  acknowledgeAuthorityEventDelivery,
  createEventEnvelope,
  EVENT_FAMILY,
  listPendingAuthorityEvents,
  recordAuthorityEventDeliveryAttempt,
} from "@noobot/event-protocol";
import {
  createTurnLifecycleEnvelope,
  TURN_EVENT,
  TURN_COMMAND,
  TURN_PHASE,
  TURN_STATE,
} from "@noobot/session-protocol";
import { createProtocolTestCommand } from "./chat-websocket-server.test-helpers.js";

const TEST_EVENT_FACTS = Object.freeze({
  [TURN_EVENT.ACTION_ACCEPTED]: Object.freeze({
    phase: TURN_PHASE.ACTION,
    state: TURN_STATE.ACTION_REQUESTING,
  }),
  [TURN_EVENT.PROCESSING_STARTED]: Object.freeze({
    phase: TURN_PHASE.PROCESSING,
    state: TURN_STATE.PROCESSING,
  }),
  [TURN_EVENT.PROCESSING_COMPLETED]: Object.freeze({
    phase: TURN_PHASE.COMPLETION,
    state: TURN_STATE.COMPLETION_REQUESTING,
  }),
  [TURN_EVENT.COMPLETED]: Object.freeze({
    phase: TURN_PHASE.COMPLETION,
    state: TURN_STATE.COMPLETED,
  }),
});

export function createTestLifecycleEnvelope({
  eventId,
  eventType = TURN_EVENT.PROCESSING_STARTED,
  sequence = 1,
  sessionId = "child-session",
  parentSessionId = "root-session",
  turnScopeId = "workflow-node:child-turn",
  persistenceScope,
} = {}) {
  const facts = TEST_EVENT_FACTS[eventType];
  const payload = createTurnLifecycleEnvelope({
    eventId,
    commandId: `${eventId}:command`,
    eventType,
    userId: "u1",
    sessionId,
    parentSessionId,
    turnScopeId,
    messageId: `${turnScopeId}:message`,
    presentationMessageId: `${turnScopeId}:presentation`,
    dialogProcessId: `${turnScopeId}:dialog`,
    revision: sequence,
    sequence,
    phase: facts.phase,
    state: facts.state,
    action: "send",
    executionState: eventType === TURN_EVENT.COMPLETED ? "completed" : "sending",
    completionCommitId: eventType === TURN_EVENT.COMPLETED ? `${eventId}:completion` : "",
    summaryVersion: eventType === TURN_EVENT.COMPLETED ? 1 : 0,
  });
  return createEventEnvelope({
    family: EVENT_FAMILY.TURN_LIFECYCLE,
    identity: {
      eventId: payload.eventId,
      eventType: "turn_lifecycle",
      sessionId: payload.sessionId,
      turnScopeId: payload.turnScopeId,
      messageId: payload.messageId,
      executionId: payload.executionId,
    },
    causality: {
      commandId: payload.commandId,
      causationId: payload.commandId,
      correlationId: payload.turnScopeId,
    },
    ordering: {
      domain: "session",
      scopeId: payload.sessionId,
      sequence: payload.sequence,
      revision: payload.revision,
    },
    producer: { type: "test", id: "service-turn-lifecycle-fixture" },
    occurredAt: payload.occurredAt,
    payload,
  });
}

export function createAuthoritativeBot({ persistSummary = true, failureAt = "" } = {}) {
  let lifecycle = {};
  let eventOutbox = [];
  let eventIdSequence = 0;
  const committed = [];
  const commitInputs = [];
  let runCount = 0;
  let lastRunConfig = null;
  let lastTurnAcceptance = null;
  const userMessages = new Map();
  const bot = {
    async resolveExecutionIntent({ turnScopeId = "", runConfig = {} } = {}) {
      const executionId = String(runConfig?.executionId || `agent:${turnScopeId}`).trim();
      return {
        executionId,
        executionKind: String(runConfig?.executionKind || "agent").trim(),
        parentExecutionId: String(runConfig?.parentExecutionId || "").trim(),
        rootExecutionId: String(runConfig?.rootExecutionId || executionId).trim(),
        origin: runConfig?.origin && typeof runConfig.origin === "object" ? runConfig.origin : {},
        stage: String(runConfig?.stage || "").trim(),
      };
    },
    async applyTurnLifecycleEvent(input) {
      if (
        input.eventType === TURN_EVENT.ACTION_ACCEPTED &&
        input.action !== "resend" &&
        !String(input.dialogProcessId || "").trim()
      ) {
        input.dialogProcessId = `dialog:${input.turnScopeId}`;
      }
      commitInputs.push(structuredClone(input));
      const result = commitTurnLifecycle({
        lifecycle,
        event: input,
        eventOutbox,
        createEventId: () => `authority-event-${++eventIdSequence}`,
        materializeTerminal: input.terminalStatus
          ? ({ terminalStatus, previousSummaryVersion }) =>
              persistSummary
                ? {
                    materialized: true,
                    terminalStatus,
                    messages: [],
                    summaryVersion: previousSummaryVersion + 1,
                  }
                : { materialized: false, reason: "summary_persistence_failed" }
          : undefined,
      });
      if (result.applied) {
        lifecycle = result.lifecycle;
        eventOutbox = result.eventOutbox;
        committed.push(input.eventType);
      }
      let userMessage = null;
      if (input.eventType === TURN_EVENT.ACTION_ACCEPTED && input.action !== "resend") {
        userMessage = userMessages.get(input.turnScopeId) || {
          messageUid: `session-message:${input.turnScopeId}`,
          messageId: String(input.userMessage?.messageId || `user-message:${input.turnScopeId}`),
          role: "user",
          type: "message",
          content: String(input.userMessage?.content || ""),
          sessionId: input.sessionId,
          parentSessionId: String(input.parentSessionId || ""),
          dialogProcessId: input.dialogProcessId,
          parentDialogProcessId: String(input.userMessage?.parentDialogProcessId || ""),
          turnScopeId: input.turnScopeId,
          messageOrigin: input.userMessage?.messageOrigin || "natural",
          userMetaMaterialized: input.userMessage?.userMetaMaterialized === true,
          attachments: [],
        };
        userMessages.set(input.turnScopeId, userMessage);
      }
      return {
        ...result,
        ...(input.terminalStatus && result.applied
          ? { turnStatus: result.turn.terminalStatus }
          : {}),
        ...(userMessage
          ? { userMessage, dialogProcessId: input.dialogProcessId, aggregateVersion: 1 }
          : {}),
      };
    },
    async getPendingAuthorityEvents() {
      return { found: true, events: listPendingAuthorityEvents(eventOutbox) };
    },
    async recordAuthorityEventAttempt({ eventId } = {}) {
      const result = recordAuthorityEventDeliveryAttempt(eventOutbox, { eventId });
      if (result.found) eventOutbox = result.outbox;
      return { recorded: result.found, reason: result.reason };
    },
    async acknowledgeAuthorityEvent({
      eventId,
      consumerId,
      orderingDomain,
      orderingScopeId,
      sequence,
    } = {}) {
      const result = acknowledgeAuthorityEventDelivery(eventOutbox, {
        eventId,
        consumerId,
        orderingDomain,
        orderingScopeId,
        sequence,
        deliveredAt: new Date().toISOString(),
      });
      if (result.found) eventOutbox = result.outbox;
      return {
        acknowledged: result.found,
        deduplicated: result.deduplicated,
        reason: result.reason,
      };
    },
    async runSession({ sessionId, runConfig, turnAcceptance, eventListener }) {
      runCount += 1;
      lastRunConfig = structuredClone(runConfig);
      lastTurnAcceptance = structuredClone(turnAcceptance);
      if (failureAt === "action")
        throw Object.assign(new Error("agent initialization failed"), {
          code: "agent_init_failed",
        });
      eventListener.onEvent({
        event: "agent_lifecycle_state_changed",
        data: {
          state: "running",
          sessionId,
          turnScopeId: runConfig.turnScopeId,
          dialogProcessId: "dp-authoritative",
        },
      });
      if (failureAt === "processing")
        throw Object.assign(new Error("agent processing failed"), {
          code: "agent_processing_failed",
        });
      return {
        sessionId,
        dialogProcessId: "dp-authoritative",
        answer: "done",
        messages: [],
        traces: [],
        executionLogs: [],
      };
    },
  };
  return {
    bot,
    committed: () => [...committed],
    commitInputs: () => structuredClone(commitInputs),
    runCount: () => runCount,
    lastRunConfig: () => structuredClone(lastRunConfig),
    lastTurnAcceptance: () => structuredClone(lastTurnAcceptance),
    lifecycle: () => lifecycle,
    eventOutbox: () => structuredClone(eventOutbox),
  };
}

export const payload = {
  userId: "u1",
  sessionId: "s-authoritative",
  message: "hello",
  turnScopeId: "turn-authoritative",
  commandId: "command-authoritative",
  createIfAbsent: true,
  config: {
    turnScopeId: "turn-authoritative",
    thinkingStartedAt: "2026-07-24T05:42:07.698Z",
  },
};

export function installLifecycleSnapshotReader(authoritative) {
  authoritative.bot.getTurnLifecycleSnapshot = async ({
    userId,
    sessionId,
    commandId,
    knownSequence,
    terminalLimit,
  } = {}) => ({
    found: true,
    snapshot: createAuthoritativeTurnSnapshot({
      lifecycle: authoritative.lifecycle(),
      terminalTurnScopeIds: Object.keys(authoritative.lifecycle()?.turns || {}),
      commandId,
      userId,
      sessionId,
      knownSequence,
      terminalLimit,
    }),
  });
}

export async function requestTurnSnapshot({ port, sessionId, commandId }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/ws`, {
      headers: { authorization: "Bearer test-key" },
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("turn snapshot response timeout"));
    }, 2000);
    const settle = (callback, value) => {
      clearTimeout(timer);
      ws.close();
      callback(value);
    };
    ws.on("open", () =>
      ws.send(
        JSON.stringify(
          createProtocolTestCommand({
            commandType: TURN_COMMAND.SNAPSHOT_GET,
            userId: "u1",
            sessionId,
            commandId,
          }),
        ),
      ),
    );
    ws.on("message", (raw) => {
      const message = JSON.parse(String(raw || "{}"));
      if (message?.event === "error")
        settle(reject, new Error(message?.data?.errorCode || "snapshot_error"));
      if (message?.event === "turn_snapshot") settle(resolve, message.data);
    });
    ws.on("error", (error) => settle(reject, error));
  });
}
