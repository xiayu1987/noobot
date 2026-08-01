/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { transitionTurnLifecycle } from "@noobot/authoritative-state/domain";
import { commitTurnLifecycle } from "@noobot/authoritative-state/application";
import {
  acknowledgeAuthorityEventDelivery,
  listPendingAuthorityEvents,
  recordAuthorityEventDeliveryAttempt,
  TURN_EVENT,
  TURN_LIFECYCLE_WIRE_EVENT,
  TURN_PHASE,
} from "@noobot/authoritative-state/contracts";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { recoverTurnFinalize } from "../../ws/chat-websocket/finalize-recovery.js";
import { createTurnLifecycleBridge } from "../../ws/chat-websocket/turn-lifecycle-bridge.js";
import { createAuthorityEventDispatcher } from "../../ws/chat-websocket/authority-event-dispatcher.js";
import { createRunEventListener } from "../../ws/chat-websocket/run-event-listener.js";
import { attachRunTransport, publishRunEvent } from "../../ws/chat-websocket/run-registry.js";
import { EXECUTION_QUERY_COMMAND } from "@noobot/shared/execution-lifecycle-protocol";
import { startServerWithWs, closeServer, callChatWs, stopChatWs } from "./chat-websocket-server.test-helpers.js";

function createAuthoritativeBot({ persistSummary = true, failureAt = "" } = {}) {
  let lifecycle = {};
  let eventOutbox = [];
  let eventIdSequence = 0;
  const committed = [];
  const commitInputs = [];
  let runCount = 0;
  let lastRunConfig = null;
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
      commitInputs.push(structuredClone(input));
      if (input.terminalStatus && !persistSummary) {
        return { applied: false, reason: "summary_persistence_failed", lifecycle };
      }
      const lifecycleEvent = input.terminalStatus ? {
        ...input,
        summaryVersion: 7,
        completionCommitId: input.completionCommitId || input.commandId,
      } : input;
      const result = commitTurnLifecycle({
        lifecycle,
        event: lifecycleEvent,
        eventOutbox,
        createEventId: () => `authority-event-${++eventIdSequence}`,
        materializeTerminal: input.terminalStatus
          ? () => ({
              turnStatus: {
                version: 7,
                turnScopeId: input.turnScopeId,
                dialogProcessId: input.dialogProcessId,
                status: input.terminalStatus.command,
              },
            })
          : undefined,
      });
      if (result.applied) {
        lifecycle = result.lifecycle;
        eventOutbox = result.eventOutbox;
        committed.push(input.eventType);
      }
      return input.terminalStatus && result.applied
        ? { ...result, turnStatus: { version: 7, status: input.terminalStatus.command } }
        : result;
    },
    async getPendingAuthorityEvents() {
      return { found: true, events: listPendingAuthorityEvents(eventOutbox) };
    },
    async recordAuthorityEventAttempt({ eventId } = {}) {
      const result = recordAuthorityEventDeliveryAttempt(eventOutbox, { eventId });
      if (result.found) eventOutbox = result.outbox;
      return { recorded: result.found, reason: result.reason };
    },
    async acknowledgeAuthorityEvent({ eventId } = {}) {
      const result = acknowledgeAuthorityEventDelivery(eventOutbox, {
        eventId,
        deliveredAt: new Date().toISOString(),
      });
      if (result.found) eventOutbox = result.outbox;
      return { acknowledged: result.found, deduplicated: result.deduplicated, reason: result.reason };
    },
    async runSession({ sessionId, runConfig, eventListener }) {
      runCount += 1;
      lastRunConfig = structuredClone(runConfig);
      if (failureAt === "action") throw Object.assign(new Error("agent initialization failed"), { code: "agent_init_failed" });
      eventListener.onEvent({
        event: "agent_lifecycle_state_changed",
        data: {
          state: "running",
          sessionId,
          turnScopeId: runConfig.turnScopeId,
          dialogProcessId: "dp-authoritative",
        },
      });
      if (failureAt === "processing") throw Object.assign(new Error("agent processing failed"), { code: "agent_processing_failed" });
      return {
        sessionId,
        dialogProcessId: "dp-authoritative",
        answer: "done",
        messages: [],
        traces: [],
        executionLogs: [],
      };
    },
    async upsertTurnStatus(payload) {
      if (!persistSummary) return null;
      return {
        turnStatus: {
          version: 7,
          turnScopeId: payload.turnScopeId,
          dialogProcessId: payload.dialogProcessId,
          status: "completed",
          reason: "run_completed",
        },
      };
    },
  };
  return {
    bot,
    committed: () => [...committed],
    commitInputs: () => structuredClone(commitInputs),
    runCount: () => runCount,
    lastRunConfig: () => structuredClone(lastRunConfig),
    lifecycle: () => lifecycle,
    eventOutbox: () => structuredClone(eventOutbox),
  };
}

const payload = {
  userId: "u1",
  sessionId: "s-authoritative",
  message: "hello",
  turnScopeId: "turn-authoritative",
  commandId: "command-authoritative",
  config: {
    turnScopeId: "turn-authoritative",
    thinkingStartedAt: "2026-07-24T05:42:07.698Z",
  },
};

test("run event publishing reports the actual transport send result", () => {
  const handle = {};
  attachRunTransport(handle, () => false);
  assert.equal(publishRunEvent(handle, TURN_LIFECYCLE_WIRE_EVENT, { eventId: "event-1" }), false);
  attachRunTransport(handle, () => true);
  assert.equal(publishRunEvent(handle, TURN_LIFECYCLE_WIRE_EVENT, { eventId: "event-2" }), true);
});

test("authoritative lifecycle follows accepted -> running -> processed -> summary completed", async () => {
  const authoritative = createAuthoritativeBot();
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const events = await callChatWs({ port: server.address().port, payload });
    assert.deepEqual(authoritative.committed(), [
      TURN_EVENT.ACTION_ACCEPTED,
      TURN_EVENT.PROCESSING_STARTED,
      TURN_EVENT.PROCESSING_COMPLETED,
      TURN_EVENT.COMPLETED,
    ]);
    const wireEvents = events
      .filter((item) => item?.event === "turn_lifecycle")
      .map((item) => item.data.eventType);
    assert.deepEqual(wireEvents, authoritative.committed());
    assert.equal(events.some((item) => item?.event === "done"), true);
    const turn = authoritative.lifecycle().turns[payload.turnScopeId];
    assert.equal(turn.state, "completed");
    assert.equal(turn.summaryVersion, 7);
    const inputs = authoritative.commitInputs();
    assert.equal(inputs[0].createSessionIfAbsent, true);
    assert.equal(inputs[0].action, "send");
    const authoritativeStartedAt = inputs[0].startedAt;
    assert.equal(Number.isNaN(Date.parse(authoritativeStartedAt)), false);
    assert.notEqual(authoritativeStartedAt, payload.config.thinkingStartedAt);
    assert.equal(turn.startedAt, authoritativeStartedAt);
    assert.equal(authoritative.lastRunConfig().thinkingStartedAt, authoritativeStartedAt);
    assert.equal(turn.messageId, authoritative.lastRunConfig().messageId);
    assert.equal(turn.presentationMessageId, authoritative.lastRunConfig().presentationMessageId);
    const completedEnvelope = events.find((item) =>
      item?.event === "turn_lifecycle" && item?.data?.eventType === TURN_EVENT.COMPLETED);
    assert.equal(completedEnvelope.data.startedAt, authoritativeStartedAt);
    assert.equal(completedEnvelope.data.messageId, turn.messageId);
    assert.equal(completedEnvelope.data.presentationMessageId, turn.presentationMessageId);
    assert.equal(Boolean(completedEnvelope.data.finishedAt), true);
    assert.equal(inputs.slice(1).some((input) => "createSessionIfAbsent" in input), false);
  } finally {
    await closeServer(server);
  }
});

test("declared workflow execution identity is stable from acceptance through completion", async () => {
  const authoritative = createAuthoritativeBot();
  authoritative.bot.resolveExecutionIntent = async ({ turnScopeId = "" } = {}) => ({
    executionId: `workflow:${turnScopeId}`,
    executionKind: "workflow",
    parentExecutionId: "",
    rootExecutionId: `workflow:${turnScopeId}`,
    origin: { type: "workflow", workflowRunId: `workflow:${turnScopeId}` },
    stage: "planning",
  });
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    await callChatWs({
      port: server.address().port,
      payload: {
        ...payload,
        sessionId: "s-workflow-identity",
        turnScopeId: "turn-workflow-identity",
        commandId: "command-workflow-identity",
        config: { ...payload.config, turnScopeId: "turn-workflow-identity" },
      },
    });
    const envelopes = authoritative.eventOutbox().map((item) => item.envelope);
    assert.equal(envelopes.length, 4);
    for (const envelope of envelopes) {
      assert.equal(envelope.executionId, "workflow:turn-workflow-identity");
      assert.equal(envelope.executionKind, "workflow");
    }
    const turn = authoritative.lifecycle().turns["turn-workflow-identity"];
    assert.equal(turn.executionId, "workflow:turn-workflow-identity");
    assert.equal(turn.executionKind, "workflow");
    assert.equal(turn.revision, 4);
  } finally {
    await closeServer(server);
  }
});

test("rejected initial provision does not start Agent execution", async () => {
  const authoritative = createAuthoritativeBot();
  authoritative.bot.applyTurnLifecycleEvent = async (input) => {
    assert.equal(input.eventType, TURN_EVENT.ACTION_ACCEPTED);
    assert.equal(input.createSessionIfAbsent, true);
    return { applied: false, reason: "session_identity_conflict" };
  };
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const events = await callChatWs({
      port: server.address().port,
      payload: {
        ...payload,
        sessionId: "s-provision-rejected",
        turnScopeId: "turn-provision-rejected",
        commandId: "command-provision-rejected",
        config: { turnScopeId: "turn-provision-rejected" },
      },
    });
    assert.equal(authoritative.runCount(), 0);
    assert.equal(events.some((item) => item?.event === "done"), false);
    assert.equal(events.some((item) => item?.event === "error"), true);
  } finally {
    await closeServer(server);
  }
});

test("deduplicated lifecycle commands do not bypass the acknowledged authority outbox", async () => {
  const sent = [];
  let lifecycle = {};
  let eventOutbox = [];
  let eventIdSequence = 0;
  const bot = {
      applyTurnLifecycleEvent: async (event = {}) => {
        const result = commitTurnLifecycle({
          lifecycle,
          event,
          eventOutbox,
          createEventId: () => `deduplicated-event-${++eventIdSequence}`,
        });
        if (result.applied) {
          lifecycle = result.lifecycle;
          eventOutbox = result.eventOutbox;
        }
        return result;
      },
      async getPendingAuthorityEvents() {
        return { found: true, events: listPendingAuthorityEvents(eventOutbox) };
      },
      async recordAuthorityEventAttempt({ eventId } = {}) {
        const result = recordAuthorityEventDeliveryAttempt(eventOutbox, { eventId });
        if (result.found) eventOutbox = result.outbox;
        return { recorded: result.found, reason: result.reason };
      },
      async acknowledgeAuthorityEvent({ eventId } = {}) {
        const result = acknowledgeAuthorityEventDelivery(eventOutbox, {
          eventId,
          deliveredAt: new Date().toISOString(),
        });
        if (result.found) eventOutbox = result.outbox;
        return { acknowledged: result.found, deduplicated: result.deduplicated, reason: result.reason };
      },
  };
  const dispatchAuthorityEvents = createAuthorityEventDispatcher({
    resolveBot: () => bot,
    sendEvent: (eventName, data) => {
      sent.push({ event: eventName, data });
      return true;
    },
  });
  const commit = createTurnLifecycleBridge({
    resolveBot: () => bot,
    dispatchAuthorityEvents,
  });
  const event = {
    userId: "u1",
    sessionId: "s-deduplicated-ack",
    turnScopeId: "turn-deduplicated-ack",
    commandId: "command-deduplicated-ack",
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    phase: TURN_PHASE.ACTION,
    action: "send",
    messageId: "message-deduplicated-ack",
    presentationMessageId: "presentation-deduplicated-ack",
  };

  const first = await commit(event);
  const replay = await commit(event);

  assert.equal(first.applied, true);
  assert.equal(replay.deduplicated, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.event, TURN_LIFECYCLE_WIRE_EVENT);
  assert.equal(sent[0]?.data?.commandId, event.commandId);
  assert.equal(sent[0]?.data?.eventId, first.envelope.eventId);
  assert.equal(listPendingAuthorityEvents(eventOutbox).length, 0);
});

test("authority dispatcher keeps a failed send pending and reconnect retries the same envelope once", async () => {
  let eventOutbox = [];
  const committed = commitTurnLifecycle({
    lifecycle: {},
    eventOutbox,
    createEventId: () => "authority-event-send-retry",
    event: {
      userId: "u1",
      sessionId: "s-send-retry",
      turnScopeId: "turn-send-retry",
      commandId: "command-send-retry",
      eventType: TURN_EVENT.ACTION_ACCEPTED,
      phase: TURN_PHASE.ACTION,
      action: "send",
      messageId: "message-send-retry",
      presentationMessageId: "presentation-send-retry",
    },
  });
  assert.equal(committed.applied, true);
  eventOutbox = committed.eventOutbox;

  const sent = [];
  let socketAvailable = false;
  const bot = {
    async getPendingAuthorityEvents() {
      return { found: true, events: listPendingAuthorityEvents(eventOutbox) };
    },
    async recordAuthorityEventAttempt({ eventId } = {}) {
      const result = recordAuthorityEventDeliveryAttempt(eventOutbox, {
        eventId,
        attemptedAt: new Date().toISOString(),
      });
      if (result.found) eventOutbox = result.outbox;
      return { recorded: result.found, reason: result.reason };
    },
    async acknowledgeAuthorityEvent({ eventId } = {}) {
      const result = acknowledgeAuthorityEventDelivery(eventOutbox, {
        eventId,
        deliveredAt: new Date().toISOString(),
      });
      if (result.found) eventOutbox = result.outbox;
      return { acknowledged: result.found, reason: result.reason };
    },
  };
  const createDispatcher = () => createAuthorityEventDispatcher({
    resolveBot: () => bot,
    sendEvent: (_eventName, envelope) => {
      if (!socketAvailable) return false;
      sent.push(structuredClone(envelope));
      return true;
    },
  });

  const failed = await createDispatcher()({ userId: "u1", sessionId: "s-send-retry" });
  assert.deepEqual(failed, { dispatched: false, reason: "authority_event_send_failed", delivered: 0 });
  assert.equal(listPendingAuthorityEvents(eventOutbox).length, 1);
  assert.equal(eventOutbox[0].delivery.attempts, 1);

  socketAvailable = true;
  const retried = await createDispatcher()({ userId: "u1", sessionId: "s-send-retry" });
  assert.deepEqual(retried, { dispatched: true, delivered: 1 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].eventId, "authority-event-send-retry");
  assert.deepEqual(sent[0], committed.envelope);
  assert.equal(listPendingAuthorityEvents(eventOutbox).length, 0);

  const afterAcknowledgement = await createDispatcher()({ userId: "u1", sessionId: "s-send-retry" });
  assert.deepEqual(afterAcknowledgement, { dispatched: true, delivered: 0 });
  assert.equal(sent.length, 1);
});

test("authority dispatcher preserves the child persistence scope across every outbox operation", async () => {
  const persistenceScope = Object.freeze({
    scopeId: "agent:child-turn",
    parentSessionId: "root-session",
    relativeDir: "runtime/workflow/session/root-session/child-turn",
    allowedRoot: "runtime/workflow/session",
  });
  const calls = [];
  let pending = true;
  const envelope = {
    eventId: "authority-event-child-context",
    sequence: 9,
    sessionId: "child-session",
    parentSessionId: "root-session",
  };
  const bot = {
    async getPendingAuthorityEvents(input) {
      calls.push({ method: "get", input });
      return { found: true, events: pending ? [{ eventId: envelope.eventId, envelope }] : [] };
    },
    async recordAuthorityEventAttempt(input) {
      calls.push({ method: "attempt", input });
      return { recorded: true };
    },
    async acknowledgeAuthorityEvent(input) {
      calls.push({ method: "acknowledge", input });
      pending = false;
      return { acknowledged: true };
    },
    async compactAuthorityEvents(input) {
      calls.push({ method: "compact", input });
      return { compacted: true };
    },
  };
  const dispatch = createAuthorityEventDispatcher({
    resolveBot: () => bot,
    sendEvent: () => true,
  });

  const result = await dispatch({
    userId: "u1",
    sessionId: "child-session",
    parentSessionId: "root-session",
    persistenceScope,
    limit: 25,
  });

  assert.deepEqual(result, { dispatched: true, delivered: 1 });
  assert.deepEqual(calls.map(({ method }) => method), ["get", "attempt", "acknowledge", "get", "compact"]);
  for (const { input } of calls) {
    assert.equal(input.persistenceScope, persistenceScope);
    assert.equal(input.sessionId, "child-session");
    assert.equal(input.parentSessionId, "root-session");
  }
  assert.equal(calls[0].input.limit, 25);
  assert.equal(calls[1].input.eventId, envelope.eventId);
  assert.equal(calls[2].input.eventId, envelope.eventId);
  assert.equal(calls[4].input.deliveredThroughSequence, 9);
  assert.equal(
    Date.now() - Date.parse(calls[4].input.retainDeliveredAfter) >=
      TIME_THRESHOLDS.agent.authorityOutboxDeliveredRetentionMs,
    true,
  );
});

test("a detached child lifecycle commit drains its complete scoped outbox to the root transport", async () => {
  const persistenceScope = Object.freeze({
    scopeId: "agent:workflow-node:child-turn",
    parentSessionId: "root-session",
    relativeDir: "runtime/workflow/session/root-session/child-turn",
    allowedRoot: "runtime/workflow/session",
  });
  const eventTypes = [
    TURN_EVENT.ACTION_ACCEPTED,
    TURN_EVENT.PROCESSING_STARTED,
    TURN_EVENT.PROCESSING_COMPLETED,
    TURN_EVENT.COMPLETED,
  ];
  let pending = eventTypes.map((eventType, index) => ({
    eventId: `child-authority-${index + 1}`,
    envelope: {
      eventId: `child-authority-${index + 1}`,
      eventType,
      sequence: index + 1,
      revision: index + 1,
      userId: "u1",
      sessionId: "child-session",
      parentSessionId: "root-session",
      turnScopeId: "workflow-node:child-turn",
      dialogProcessId: "child-dialog",
      persistenceScope,
    },
  }));
  const calls = [];
  const sent = [];
  const bot = {
    async getPendingAuthorityEvents(input) {
      calls.push({ method: "get", input });
      return { found: true, events: pending };
    },
    async recordAuthorityEventAttempt(input) {
      calls.push({ method: "attempt", input });
      return { recorded: pending.some((item) => item.eventId === input.eventId) };
    },
    async acknowledgeAuthorityEvent(input) {
      calls.push({ method: "acknowledge", input });
      pending = pending.filter((item) => item.eventId !== input.eventId);
      return { acknowledged: true };
    },
  };
  const dispatchAuthorityEvents = createAuthorityEventDispatcher({
    resolveBot: () => bot,
    sendEvent: (event, envelope) => {
      sent.push({ event, envelope });
      return true;
    },
  });
  const listener = createRunEventListener({
    sessionId: "root-session",
    onCommittedTurnLifecycle: (envelope) => dispatchAuthorityEvents({
      userId: envelope.userId,
      sessionId: envelope.sessionId,
      parentSessionId: envelope.parentSessionId,
      persistenceScope: envelope.persistenceScope,
    }),
  });

  const result = await listener.onEvent({
    event: "turn_lifecycle_committed",
    data: { envelope: pending.at(-1).envelope },
  });

  assert.deepEqual(result, { dispatched: true, delivered: 4 });
  assert.deepEqual(sent.map(({ event }) => event), eventTypes.map(() => TURN_LIFECYCLE_WIRE_EVENT));
  assert.deepEqual(sent.map(({ envelope }) => envelope.eventType), eventTypes);
  assert.equal(sent.every(({ envelope }) => envelope.sessionId === "child-session"), true);
  assert.equal(
    calls.every(({ input }) => input.persistenceScope === persistenceScope),
    true,
  );
  assert.equal(pending.length, 0);
});

test("authority dispatcher serializes concurrent scoped drains and performs the requested confirmation pass", async () => {
  let pending = true;
  let releaseSend;
  const sendBarrier = new Promise((resolve) => { releaseSend = resolve; });
  const calls = { get: 0, attempt: 0, acknowledge: 0, send: 0 };
  const envelope = {
    eventId: "authority-event-single-flight",
    sequence: 3,
    sessionId: "child-session",
    parentSessionId: "root-session",
  };
  const bot = {
    async getPendingAuthorityEvents() {
      calls.get += 1;
      return { found: true, events: pending ? [{ eventId: envelope.eventId, envelope }] : [] };
    },
    async recordAuthorityEventAttempt() {
      calls.attempt += 1;
      return { recorded: true };
    },
    async acknowledgeAuthorityEvent() {
      calls.acknowledge += 1;
      pending = false;
      return { acknowledged: true };
    },
  };
  const dispatch = createAuthorityEventDispatcher({
    resolveBot: () => bot,
    sendEvent: async () => {
      calls.send += 1;
      await sendBarrier;
      return true;
    },
  });
  const persistenceScope = { scopeId: "agent:child-turn" };
  const payload = {
    userId: "u1",
    sessionId: "child-session",
    parentSessionId: "root-session",
    persistenceScope,
  };

  const first = dispatch(payload);
  const second = dispatch(payload);
  assert.equal(first, second);
  releaseSend();
  assert.deepEqual(await Promise.all([first, second]), [
    { dispatched: true, delivered: 1 },
    { dispatched: true, delivered: 1 },
  ]);
  assert.deepEqual(calls, { get: 3, attempt: 1, acknowledge: 1, send: 1 });
});

test("authority dispatcher repeats a scoped drain when a lifecycle commit arrives during its final empty read", async () => {
  let pending = [{
    eventId: "authority-event-running",
    envelope: {
      eventId: "authority-event-running",
      eventType: TURN_EVENT.PROCESSING_STARTED,
      sequence: 1,
      sessionId: "child-session",
      parentSessionId: "root-session",
    },
  }];
  let releaseEmptyRead;
  const emptyReadBarrier = new Promise((resolve) => { releaseEmptyRead = resolve; });
  let emptyReadStarted;
  const emptyReadObserved = new Promise((resolve) => { emptyReadStarted = resolve; });
  let reads = 0;
  const sent = [];
  const bot = {
    async getPendingAuthorityEvents() {
      reads += 1;
      const events = pending.slice();
      if (reads === 2) {
        emptyReadStarted();
        await emptyReadBarrier;
      }
      return { found: true, events };
    },
    async recordAuthorityEventAttempt({ eventId }) {
      return { recorded: pending.some((item) => item.eventId === eventId) };
    },
    async acknowledgeAuthorityEvent({ eventId }) {
      pending = pending.filter((item) => item.eventId !== eventId);
      return { acknowledged: true };
    },
  };
  const dispatch = createAuthorityEventDispatcher({
    resolveBot: () => bot,
    sendEvent: (_eventName, envelope) => {
      sent.push(envelope.eventId);
      return true;
    },
  });
  const payload = {
    userId: "u1",
    sessionId: "child-session",
    parentSessionId: "root-session",
    persistenceScope: { scopeId: "agent:child-turn" },
  };

  const runningDrain = dispatch(payload);
  await emptyReadObserved;
  pending.push({
    eventId: "authority-event-completed",
    envelope: {
      eventId: "authority-event-completed",
      eventType: TURN_EVENT.COMPLETED,
      sequence: 2,
      sessionId: "child-session",
      parentSessionId: "root-session",
    },
  });
  const terminalDrain = dispatch(payload);
  assert.equal(terminalDrain, runningDrain);
  releaseEmptyRead();

  assert.deepEqual(await Promise.all([runningDrain, terminalDrain]), [
    { dispatched: true, delivered: 2 },
    { dispatched: true, delivered: 2 },
  ]);
  assert.deepEqual(sent, ["authority-event-running", "authority-event-completed"]);
  assert.equal(pending.length, 0);
  assert.equal(reads, 4);
});

test("authority dispatcher leaves an event pending when acknowledgement persistence fails", async () => {
  let eventOutbox = [];
  const committed = commitTurnLifecycle({
    lifecycle: {},
    eventOutbox,
    createEventId: () => "authority-event-ack-retry",
    event: {
      userId: "u1",
      sessionId: "s-ack-retry",
      turnScopeId: "turn-ack-retry",
      commandId: "command-ack-retry",
      eventType: TURN_EVENT.ACTION_ACCEPTED,
      phase: TURN_PHASE.ACTION,
      action: "send",
      messageId: "message-ack-retry",
      presentationMessageId: "presentation-ack-retry",
    },
  });
  assert.equal(committed.applied, true);
  eventOutbox = committed.eventOutbox;

  let acknowledgementAvailable = false;
  const sentEventIds = [];
  const bot = {
    async getPendingAuthorityEvents() {
      return { found: true, events: listPendingAuthorityEvents(eventOutbox) };
    },
    async recordAuthorityEventAttempt({ eventId } = {}) {
      const result = recordAuthorityEventDeliveryAttempt(eventOutbox, {
        eventId,
        attemptedAt: new Date().toISOString(),
      });
      if (result.found) eventOutbox = result.outbox;
      return { recorded: result.found, reason: result.reason };
    },
    async acknowledgeAuthorityEvent({ eventId } = {}) {
      if (!acknowledgementAvailable) {
        return { acknowledged: false, reason: "session_save_failed" };
      }
      const result = acknowledgeAuthorityEventDelivery(eventOutbox, {
        eventId,
        deliveredAt: new Date().toISOString(),
      });
      if (result.found) eventOutbox = result.outbox;
      return { acknowledged: result.found, reason: result.reason };
    },
  };
  const dispatch = createAuthorityEventDispatcher({
    resolveBot: () => bot,
    sendEvent: (_eventName, envelope) => {
      sentEventIds.push(envelope.eventId);
      return true;
    },
  });

  const failedAcknowledgement = await dispatch({ userId: "u1", sessionId: "s-ack-retry" });
  assert.deepEqual(failedAcknowledgement, {
    dispatched: false,
    reason: "session_save_failed",
    delivered: 0,
  });
  assert.equal(listPendingAuthorityEvents(eventOutbox).length, 1);
  assert.equal(eventOutbox[0].delivery.attempts, 1);

  acknowledgementAvailable = true;
  const retry = await dispatch({ userId: "u1", sessionId: "s-ack-retry" });
  assert.deepEqual(retry, { dispatched: true, delivered: 1 });
  assert.deepEqual(sentEventIds, ["authority-event-ack-retry", "authority-event-ack-retry"]);
  assert.equal(eventOutbox[0].delivery.attempts, 2);
  assert.equal(listPendingAuthorityEvents(eventOutbox).length, 0);

  await dispatch({ userId: "u1", sessionId: "s-ack-retry" });
  assert.equal(sentEventIds.length, 2);
});

test("processing-start persistence rejection is observed while Agent execution is still active", async () => {
  const authoritative = createAuthoritativeBot();
  const applyLifecycle = authoritative.bot.applyTurnLifecycleEvent;
  authoritative.bot.applyTurnLifecycleEvent = async (input) => {
    if (input.eventType === TURN_EVENT.PROCESSING_STARTED) {
      return { applied: false, reason: "session_not_found" };
    }
    return applyLifecycle(input);
  };
  authoritative.bot.runSession = async ({ sessionId, runConfig, eventListener }) => {
    eventListener.onEvent({
      event: "agent_lifecycle_state_changed",
      data: {
        state: "running",
        sessionId,
        turnScopeId: runConfig.turnScopeId,
        dialogProcessId: "dp-processing-rejected",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { sessionId, dialogProcessId: "dp-processing-rejected", messages: [] };
  };
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const events = await callChatWs({ port: server.address().port, payload: {
      ...payload,
      sessionId: "s-processing-rejected",
      turnScopeId: "turn-processing-rejected",
      commandId: "command-processing-rejected",
      config: { turnScopeId: "turn-processing-rejected" },
    } });
    assert.equal(events.some((item) => item?.event === "error"), true);
    assert.equal(server.server.listening, true);
  } finally {
    await closeServer(server);
  }
});

test("message listener boundary contains failures raised by terminal error persistence", async () => {
  const authoritative = createAuthoritativeBot({ failureAt: "action" });
  authoritative.bot.upsertTurnStatus = async () => {
    throw new Error("terminal_status_storage_failed");
  };
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const events = await callChatWs({ port: server.address().port, payload: {
      ...payload,
      sessionId: "s-terminal-boundary",
      turnScopeId: "turn-terminal-boundary",
      commandId: "command-terminal-boundary",
      config: { turnScopeId: "turn-terminal-boundary" },
    } });
    assert.equal(events.some((item) => item?.event === "error"), true);
    assert.equal(server.server.listening, true);
  } finally {
    await closeServer(server);
  }
});

test("summary persistence failure never commits authoritative completed", async () => {
  const authoritative = createAuthoritativeBot({ persistSummary: false });
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const events = await callChatWs({ port: server.address().port, payload: {
      ...payload,
      sessionId: "s-summary-failure",
      turnScopeId: "turn-summary-failure",
      commandId: "command-summary-failure",
      config: { turnScopeId: "turn-summary-failure" },
    } });
    assert.deepEqual(authoritative.committed(), [
      TURN_EVENT.ACTION_ACCEPTED,
      TURN_EVENT.PROCESSING_STARTED,
      TURN_EVENT.PROCESSING_COMPLETED,
      TURN_EVENT.FAILED,
    ]);
    assert.equal(events.some((item) => item?.event === "done"), false);
    assert.equal(
      events.filter((item) => item?.event === "turn_lifecycle")
        .some((item) => item?.data?.eventType === TURN_EVENT.COMPLETED),
      false,
    );
    assert.equal(authoritative.lifecycle().turns["turn-summary-failure"].state, "completion_failed");
  } finally {
    await closeServer(server);
  }
});

for (const [failureAt, expectedPhase] of [["action", "action"], ["processing", "processing"]]) {
  test(`authoritative failure before/after RUNNING is classified as ${expectedPhase}`, async () => {
    const authoritative = createAuthoritativeBot({ failureAt });
    const scopedPayload = {
      ...payload,
      sessionId: `s-${failureAt}-failure`,
      turnScopeId: `turn-${failureAt}-failure`,
      commandId: `command-${failureAt}-failure`,
      config: { turnScopeId: `turn-${failureAt}-failure` },
    };
    const server = await startServerWithWs({ bot: authoritative.bot });
    try {
      const events = await callChatWs({ port: server.address().port, payload: scopedPayload });
      const lifecycleEvents = events.filter((item) => item?.event === "turn_lifecycle").map((item) => item.data);
      assert.deepEqual(lifecycleEvents.map((item) => item.eventType), [
        TURN_EVENT.ACTION_ACCEPTED,
        ...(failureAt === "processing" ? [TURN_EVENT.PROCESSING_STARTED] : []),
        TURN_EVENT.FAILED,
      ]);
      const failed = lifecycleEvents.at(-1);
      assert.equal(failed.phase, expectedPhase);
      assert.equal(failed.failure.phase, expectedPhase);
      assert.equal(authoritative.lifecycle().turns[scopedPayload.turnScopeId].state, `${expectedPhase}_failed`);
    } finally {
      await closeServer(server);
    }
  });
}

test("socket close terminates an accepted turn and releases the session mutex", async () => {
  const authoritative = createAuthoritativeBot();
  authoritative.bot.runSession = async ({ abortSignal }) => {
    await new Promise((resolve) => abortSignal.addEventListener("abort", resolve, { once: true }));
    const error = new Error("socket closed");
    error.name = "AbortError";
    throw error;
  };
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const scopedPayload = {
      ...payload,
      sessionId: "s-socket-close",
      turnScopeId: "turn-socket-close",
      commandId: "command-socket-close",
      config: { turnScopeId: "turn-socket-close" },
    };
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/chat/ws`, {
        headers: { authorization: "Bearer test-key" },
      });
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error("socket close lifecycle timeout"));
      }, 2000);
      ws.on("open", () => ws.send(JSON.stringify(scopedPayload)));
      ws.on("message", (raw) => {
        const message = JSON.parse(String(raw || "{}"));
        if (message?.event === "turn_lifecycle" && message?.data?.eventType === TURN_EVENT.ACTION_ACCEPTED) {
          ws.close(1000, "restart");
        }
      });
      ws.on("close", () => { clearTimeout(timer); resolve(); });
      ws.on("error", (error) => { clearTimeout(timer); reject(error); });
    });

    const deadline = Date.now() + 1000;
    while (authoritative.lifecycle().activeTurnScopeId && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(authoritative.committed(), [TURN_EVENT.ACTION_ACCEPTED, TURN_EVENT.FAILED]);
    assert.equal(authoritative.lifecycle().activeTurnScopeId, "");
    assert.equal(authoritative.lifecycle().turns[scopedPayload.turnScopeId].state, "action_failed");
  } finally {
    await closeServer(server);
  }
});

test("a new action recovers a stale persisted turn lost after service restart", async () => {
  const authoritative = createAuthoritativeBot();
  await authoritative.bot.applyTurnLifecycleEvent({
    turnScopeId: "turn-before-restart",
    messageId: "turn-message-before-restart",
    presentationMessageId: "presentation-before-restart",
    dialogProcessId: "dialog-before-restart",
    commandId: "command-before-restart",
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    phase: "action",
    action: "send",
  });
  await authoritative.bot.applyTurnLifecycleEvent({
    turnScopeId: "turn-before-restart",
    dialogProcessId: "dialog-before-restart",
    commandId: "command-before-restart:processing-started",
    eventType: TURN_EVENT.PROCESSING_STARTED,
    phase: "processing",
    executionState: "sending",
  });
  authoritative.lifecycle().turns["turn-before-restart"].updatedAt = new Date(
    Date.now() - TIME_THRESHOLDS.service.orphanedTurnRecoveryGraceMs - 1,
  ).toISOString();

  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const events = await callChatWs({
      port: server.address().port,
      payload: {
        ...payload,
        sessionId: "s-after-restart",
        turnScopeId: "turn-after-restart",
        commandId: "command-after-restart",
        config: { turnScopeId: "turn-after-restart" },
      },
    });

    assert.equal(authoritative.lifecycle().turns["turn-before-restart"].state, "processing_failed");
    assert.equal(authoritative.lifecycle().turns["turn-after-restart"].state, "completed");
    assert.equal(events.some((item) => item?.event === "done"), true);
    const orphanFailure = authoritative.commitInputs().find(
      (input) => input.eventType === TURN_EVENT.FAILED && input.turnScopeId === "turn-before-restart",
    );
    assert.equal(orphanFailure?.failure?.code, "service_restart_orphaned_turn");
  } finally {
    await closeServer(server);
  }
});

test("summary failure is classified as completion without authoritative completed", async () => {
  const authoritative = createAuthoritativeBot({ persistSummary: false });
  const scopedPayload = {
    ...payload,
    sessionId: "s-completion-failure",
    turnScopeId: "turn-completion-failure",
    commandId: "command-completion-failure",
    config: { turnScopeId: "turn-completion-failure" },
  };
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const events = await callChatWs({ port: server.address().port, payload: scopedPayload });
    const lifecycleEvents = events.filter((item) => item?.event === "turn_lifecycle").map((item) => item.data);
    assert.equal(lifecycleEvents.some((item) => item.eventType === TURN_EVENT.COMPLETED), false);
    const failed = lifecycleEvents.find((item) => item.eventType === TURN_EVENT.FAILED);
    assert.equal(failed?.phase, "completion");
    assert.equal(authoritative.lifecycle().turns[scopedPayload.turnScopeId].state, "completion_failed");
  } finally {
    await closeServer(server);
  }
});

test("authoritative stop follows accepted -> stop processed -> stop summary completed", async () => {
  const authoritative = createAuthoritativeBot();
  authoritative.bot.runSession = async ({ sessionId, runConfig, eventListener, abortSignal }) => {
    eventListener.onEvent({
      event: "agent_lifecycle_state_changed",
      data: {
        state: "running",
        sessionId,
        turnScopeId: runConfig.turnScopeId,
        dialogProcessId: "dp-stop-authoritative",
      },
    });
    await new Promise((resolve) => abortSignal.addEventListener("abort", resolve, { once: true }));
    const error = new Error("stopped");
    error.name = "AbortError";
    throw error;
  };
  authoritative.bot.persistStoppedAssistantMessage = async ({ partialAssistant }) => ({
    version: 9,
    sessionId: "s-stop-authoritative",
    turnScopeId: partialAssistant.turnScopeId,
    dialogProcessId: partialAssistant.dialogProcessId,
    status: "user_stopped",
    reason: "user_stop",
  });
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const events = await stopChatWs({
      port: server.address().port,
      payload: {
        ...payload,
        sessionId: "s-stop-authoritative",
        turnScopeId: "turn-stop-authoritative",
        commandId: "command-stop-authoritative",
        config: { turnScopeId: "turn-stop-authoritative" },
      },
      stopPayload: {
        sessionId: "s-stop-authoritative",
        turnScopeId: "turn-stop-authoritative",
        commandId: "stop-command-authoritative",
        expectedRevision: 2,
        partialAssistant: {
          sessionId: "s-stop-authoritative",
          turnScopeId: "turn-stop-authoritative",
          dialogProcessId: "dp-stop-authoritative",
          content: "partial",
        },
      },
    });
    assert.deepEqual(authoritative.committed(), [
      TURN_EVENT.ACTION_ACCEPTED,
      TURN_EVENT.PROCESSING_STARTED,
      TURN_EVENT.STOP_ACCEPTED,
      TURN_EVENT.STOP_PROCESSING_COMPLETED,
      TURN_EVENT.STOP_COMPLETED,
    ]);
    assert.deepEqual(
      events.filter((item) => item?.event === "turn_lifecycle").map((item) => item.data.eventType),
      authoritative.committed(),
    );
    const turn = authoritative.lifecycle().turns["turn-stop-authoritative"];
    assert.equal(turn.state, "stop_completed");
    assert.equal(turn.summaryVersion, 9);
    assert.equal(events.some((item) => item?.event === "user_stopped"), true);
  } finally {
    await closeServer(server);
  }
});

test("rejected stop has no abort or interaction side effects", async () => {
  let abortCount = 0;
  let rejectCount = 0;
  const sent = [];
  const { createMessageHandler } = await import("../../ws/chat-websocket/message-handler.js");
  const handler = createMessageHandler({
    state: { currentTurnScopeId: "turn-locked", currentRunMeta: { sessionId: "session-locked" } },
    authInfo: { userId: "u1" },
    webSocket: {},
    sendEvent: (event, data) => sent.push({ event, data }),
    translateText: (key) => key,
    normalizeLocale: (value) => value,
    normalizeRunConfig: (value) => value,
    isForbiddenUserScope: () => false,
    resolveBot: () => ({}),
    pendingInteractionRequests: new Map(),
    rejectAllPendingInteractions: () => { rejectCount += 1; },
    commitTurnLifecycle: async () => ({ applied: false, reason: "stop_not_allowed", currentRevision: 2 }),
  });
  const originalAbort = AbortController.prototype.abort;
  AbortController.prototype.abort = function (...args) { abortCount += 1; return originalAbort.apply(this, args); };
  try {
    await handler(JSON.stringify({ action: "stop", sessionId: "session-locked", turnScopeId: "turn-locked" }));
  } finally {
    AbortController.prototype.abort = originalAbort;
  }
  assert.equal(rejectCount, 0);
  assert.equal(abortCount, 0);
  assert.equal(sent.at(-1)?.data?.errorCode, "stop_not_allowed");
});

test("finalize recovery is idempotent across repeated service recovery attempts", async () => {
  let lifecycle = {};
  const apply = (input) => {
    const result = transitionTurnLifecycle(lifecycle, input);
    lifecycle = result.lifecycle;
    return result;
  };
  apply({
    turnScopeId: "turn-recover",
    messageId: "turn-message-recover",
    presentationMessageId: "presentation-recover",
    commandId: "start",
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    action: "send",
  });
  apply({ turnScopeId: "turn-recover", commandId: "running", eventType: TURN_EVENT.PROCESSING_STARTED, phase: "processing", executionState: "sending" });
  apply({ turnScopeId: "turn-recover", commandId: "processed", eventType: TURN_EVENT.PROCESSING_COMPLETED, phase: "completion", finalizeCommandId: "stable-finalize" });
  const bot = {
    async getTurnLifecycleSnapshot({ commandId }) {
      const turn = lifecycle.turns["turn-recover"];
      return { found: true, snapshot: { commandId, activeTurn: lifecycle.activeTurnScopeId ? turn : null } };
    },
  };
  const commitTurnLifecycle = async (input) => apply(input.terminalStatus ? {
    ...input,
    summaryVersion: 4,
    completionCommitId: input.completionCommitId || input.commandId,
  } : input);
  const request = { bot, commitTurnLifecycle, userId: "u1", sessionId: "s1", commandId: "recover" };
  const first = await recoverTurnFinalize(request);
  const second = await recoverTurnFinalize(request);
  assert.equal(first.recovered, true);
  assert.equal(second.recovered, false);
  assert.equal(second.reason, "no_recoverable_finalize");
  assert.equal(lifecycle.turns["turn-recover"].summaryVersion, 4);
  assert.equal(lifecycle.turns["turn-recover"].state, "completed");
  assert.equal(lifecycle.turns["turn-recover"].revision, 4);
  assert.equal(lifecycle.sequence, 4);
});

test("execution queries expose authoritative snapshot, children and tree envelopes", async () => {
  const sent = [];
  const root = {
    executionId: "agent:root", executionKind: "agent", rootExecutionId: "agent:root",
    sessionId: "root-session", turnScopeId: "root", state: "processing", revision: 2, sequence: 2,
  };
  const child = {
    executionId: "agent:child", executionKind: "agent", parentExecutionId: "agent:root",
    rootExecutionId: "agent:root", sessionId: "child-session", turnScopeId: "child",
    state: "processing", revision: 1, sequence: 1,
  };
  const bot = {
    async getExecution() { return { found: true, execution: root, generatedAt: "now" }; },
    async getExecutionChildren() { return { found: true, execution: root, children: [child], generatedAt: "now" }; },
    async getExecutionTree() {
      return { found: true, execution: root, rootExecutionId: root.executionId, tree: {
        executions: { [root.executionId]: { ...root, childExecutionIds: [child.executionId] }, [child.executionId]: { ...child, childExecutionIds: [] } },
        rootExecutionIds: [root.executionId],
      }, generatedAt: "now" };
    },
  };
  const { createMessageHandler } = await import("../../ws/chat-websocket/message-handler.js");
  const handler = createMessageHandler({
    state: {}, authInfo: { userId: "u1" }, webSocket: { close() {} },
    sendEvent: (event, data) => sent.push({ event, data }), resolveBot: () => bot,
    isForbiddenUserScope: () => false, pendingInteractionRequests: new Map(),
  });
  await handler(JSON.stringify({ commandType: EXECUTION_QUERY_COMMAND.SNAPSHOT_GET, executionId: root.executionId, commandId: "q1" }));
  await handler(JSON.stringify({ commandType: EXECUTION_QUERY_COMMAND.CHILDREN_GET, executionId: root.executionId, commandId: "q2" }));
  await handler(JSON.stringify({ commandType: EXECUTION_QUERY_COMMAND.TREE_GET, rootExecutionId: root.executionId, commandId: "q3" }));
  assert.deepEqual(sent.map(({ event }) => event), ["execution_snapshot", "execution_children", "execution_tree"]);
  assert.deepEqual(sent.map(({ data }) => data.commandId), ["q1", "q2", "q3"]);
});

test("execution query rejects invalid, forbidden and unavailable requests", async () => {
  const sent = [];
  const { createMessageHandler } = await import("../../ws/chat-websocket/message-handler.js");
  const create = ({ forbidden = false, bot = {} } = {}) => createMessageHandler({
    state: {}, authInfo: { userId: "u1" }, webSocket: { close() {} },
    sendEvent: (event, data) => sent.push({ event, data }), resolveBot: () => bot,
    isForbiddenUserScope: () => forbidden, pendingInteractionRequests: new Map(),
  });
  await create()(JSON.stringify({ commandType: EXECUTION_QUERY_COMMAND.SNAPSHOT_GET, commandId: "bad" }));
  await create({ forbidden: true })(JSON.stringify({ commandType: EXECUTION_QUERY_COMMAND.SNAPSHOT_GET, executionId: "agent:x", commandId: "denied" }));
  await create()(JSON.stringify({ commandType: EXECUTION_QUERY_COMMAND.SNAPSHOT_GET, executionId: "agent:x", commandId: "missing-reader" }));
  assert.deepEqual(sent.map(({ data }) => data.errorCode), [
    "invalid_execution_query", "invalid_execution_query", "execution_query_unavailable",
  ]);
});
