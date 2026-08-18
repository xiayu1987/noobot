/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { transitionTurnLifecycle } from "@noobot/authoritative-state/domain";
import {
  commitTurnLifecycle,
  createAuthoritativeTurnSnapshot,
} from "@noobot/authoritative-state/application";
import {
  acknowledgeAuthorityEventDelivery,
  listPendingAuthorityEvents,
  recordAuthorityEventDeliveryAttempt,
} from "@noobot/event-protocol";
import { AGENT_TRANSPORT_EVENT } from "@noobot/agent-transport-protocol";
import {
  createTurnLifecycleEnvelope,
  TURN_EVENT,
  TURN_LIFECYCLE_WIRE_EVENT,
  TURN_COMMAND,
  TURN_PHASE,
  TURN_STATE,
  SESSION_ERROR_CODE,
} from "@noobot/session-protocol";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { recoverTurnFinalize } from "../../ws/chat-websocket/finalize-recovery.js";
import { createTurnLifecycleBridge } from "../../ws/chat-websocket/turn-lifecycle-bridge.js";
import { createAuthorityEventDispatcher } from "../../ws/chat-websocket/authority-event-dispatcher.js";
import { createRunEventListener } from "../../ws/chat-websocket/run-event-listener.js";
import {
  attachRunTransport,
  publishRunEvent,
  registerActiveRun,
  unregisterActiveRun,
} from "../../ws/chat-websocket/run-registry.js";
import { EXECUTION_QUERY_COMMAND } from "@noobot/session-protocol/execution-lifecycle";
import {
  startServerWithWs,
  closeServer,
  callChatWs,
  stopChatWs,
  createProtocolTestCommand,
} from "./chat-websocket-server.test-helpers.js";

import {
  createTestLifecycleEnvelope,
  createAuthoritativeBot,
  payload,
  installLifecycleSnapshotReader,
  requestTurnSnapshot,
} from "./chat-websocket-server.turn-lifecycle.fixtures.js";

test("run event publishing awaits the actual transport send result", async () => {
  const handle = {};
  assert.equal(
    await publishRunEvent(handle, TURN_LIFECYCLE_WIRE_EVENT, { eventId: "event-0" }),
    false,
  );
  attachRunTransport(handle, async () => false);
  assert.equal(
    await publishRunEvent(handle, TURN_LIFECYCLE_WIRE_EVENT, { eventId: "event-1" }),
    false,
  );
  attachRunTransport(handle, async () => true);
  assert.equal(
    await publishRunEvent(handle, TURN_LIFECYCLE_WIRE_EVENT, { eventId: "event-2" }),
    true,
  );
  attachRunTransport(handle, async () => {
    throw new Error("send failed");
  });
  await assert.rejects(
    publishRunEvent(handle, TURN_LIFECYCLE_WIRE_EVENT, { eventId: "event-3" }),
    /send failed/,
  );
});

test("authoritative lifecycle follows accepted -> running -> processed -> summary completed", async () => {
  const authoritative = createAuthoritativeBot();
  const server = await startServerWithWs({
    bot: authoritative.bot,
    resolveAuthByApiKey: () => ({ userId: "u1" }),
  });
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
      .map((item) => item.data.payload.eventType);
    assert.deepEqual(wireEvents, authoritative.committed());
    assert.equal(
      events.some(
        (item) =>
          item?.event === AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT &&
          item?.data?.outcome === "completed",
      ),
      true,
    );
    const turn = authoritative.lifecycle().turns[payload.turnScopeId];
    assert.equal(turn.state, "completed");
    assert.equal(turn.summaryVersion, 1);
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
    const completedEnvelope = events.find(
      (item) =>
        item?.event === "turn_lifecycle" && item?.data?.payload?.eventType === TURN_EVENT.COMPLETED,
    );
    assert.equal(completedEnvelope.data.payload.startedAt, authoritativeStartedAt);
    assert.equal(completedEnvelope.data.identity.messageId, turn.messageId);
    assert.equal(completedEnvelope.data.payload.presentationMessageId, turn.presentationMessageId);
    assert.equal(Boolean(completedEnvelope.data.payload.finishedAt), true);
    assert.equal(
      inputs.slice(1).some((input) => "createSessionIfAbsent" in input),
      false,
    );
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
  const server = await startServerWithWs({
    bot: authoritative.bot,
    resolveAuthByApiKey: () => ({ userId: "u1" }),
  });
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
      assert.equal(envelope.identity.executionId, "workflow:turn-workflow-identity");
      assert.equal(envelope.payload.executionKind, "workflow");
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
    assert.equal(
      events.some(
        (item) =>
          item?.event === AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT &&
          item?.data?.outcome === "completed",
      ),
      false,
    );
    assert.equal(events.at(-1)?.event, AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT);
    assert.equal(events.at(-1)?.data?.error?.code, "session_identity_conflict");
  } finally {
    await closeServer(server);
  }
});

test("stale aggregate version is rejected before lifecycle state and Agent execution", async () => {
  const authoritative = createAuthoritativeBot();
  let lifecycleCalls = 0;
  authoritative.bot.applyTurnLifecycleEvent = async (input) => {
    lifecycleCalls += 1;
    assert.equal(input.eventType, TURN_EVENT.ACTION_ACCEPTED);
    assert.equal(input.expectedAggregateVersion, 2);
    return {
      applied: false,
      reason: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
      currentVersion: 3,
    };
  };
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const events = await callChatWs({
      port: server.address().port,
      payload: {
        ...payload,
        sessionId: "s-stale-aggregate",
        turnScopeId: "turn-stale-aggregate",
        commandId: "command-stale-aggregate",
        expectedAggregateVersion: 2,
        config: { ...payload.config, turnScopeId: "turn-stale-aggregate" },
      },
    });
    assert.equal(lifecycleCalls, 1);
    assert.equal(authoritative.runCount(), 0);
    assert.equal(
      events.some((item) => item?.event === "turn_lifecycle"),
      false,
    );
    const receipt = events.find(
      (item) => item?.event === AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
    )?.data;
    assert.equal(receipt?.error?.code, SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT);
    assert.equal(receipt?.identity?.turnScopeId, "turn-stale-aggregate");
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
  assert.equal(sent[0]?.data?.causality?.commandId, event.commandId);
  assert.equal(sent[0]?.data?.identity?.eventId, first.envelope.identity.eventId);
  assert.equal(listPendingAuthorityEvents(eventOutbox).length, 0);
});
