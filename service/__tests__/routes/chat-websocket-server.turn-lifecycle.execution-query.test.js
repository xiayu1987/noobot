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
  apply({
    turnScopeId: "turn-recover",
    commandId: "running",
    eventType: TURN_EVENT.PROCESSING_STARTED,
    phase: "processing",
    executionState: "sending",
  });
  apply({
    turnScopeId: "turn-recover",
    commandId: "processed",
    eventType: TURN_EVENT.PROCESSING_COMPLETED,
    phase: "completion",
    finalizeCommandId: "stable-finalize",
  });
  const bot = {
    async getTurnLifecycleSnapshot({ commandId }) {
      const turn = lifecycle.turns["turn-recover"];
      return {
        found: true,
        snapshot: { commandId, activeTurn: lifecycle.activeTurnScopeId ? turn : null },
      };
    },
  };
  const commitTurnLifecycle = async (input) =>
    apply(
      input.terminalStatus
        ? {
            ...input,
            summaryVersion: 4,
            completionCommitId: input.completionCommitId || input.commandId,
          }
        : input,
    );
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
    executionId: "agent:root",
    executionKind: "agent",
    rootExecutionId: "agent:root",
    sessionId: "root-session",
    turnScopeId: "root",
    state: "processing",
    revision: 2,
    sequence: 2,
  };
  const child = {
    executionId: "agent:child",
    executionKind: "agent",
    parentExecutionId: "agent:root",
    rootExecutionId: "agent:root",
    sessionId: "child-session",
    turnScopeId: "child",
    state: "processing",
    revision: 1,
    sequence: 1,
  };
  const bot = {
    async getExecution() {
      return { found: true, execution: root, generatedAt: "now" };
    },
    async getExecutionChildren() {
      return { found: true, execution: root, children: [child], generatedAt: "now" };
    },
    async getExecutionTree() {
      return {
        found: true,
        execution: root,
        rootExecutionId: root.executionId,
        tree: {
          executions: {
            [root.executionId]: { ...root, childExecutionIds: [child.executionId] },
            [child.executionId]: { ...child, childExecutionIds: [] },
          },
          rootExecutionIds: [root.executionId],
        },
        generatedAt: "now",
      };
    },
  };
  const { createMessageHandler } = await import("../../ws/chat-websocket/message-handler.js");
  const handler = createMessageHandler({
    state: {},
    authInfo: { userId: "u1" },
    webSocket: { close() {} },
    sendEvent: (event, data) => sent.push({ event, data }),
    resolveBot: () => bot,
    isForbiddenUserScope: () => false,
    pendingInteractionRequests: new Map(),
  });
  await handler(
    JSON.stringify(
      createProtocolTestCommand({
        commandType: EXECUTION_QUERY_COMMAND.SNAPSHOT_GET,
        sessionId: "root-session",
        executionId: root.executionId,
        commandId: "q1",
      }),
    ),
  );
  await handler(
    JSON.stringify(
      createProtocolTestCommand({
        commandType: EXECUTION_QUERY_COMMAND.CHILDREN_GET,
        sessionId: "root-session",
        executionId: root.executionId,
        commandId: "q2",
      }),
    ),
  );
  await handler(
    JSON.stringify(
      createProtocolTestCommand({
        commandType: EXECUTION_QUERY_COMMAND.TREE_GET,
        sessionId: "root-session",
        rootExecutionId: root.executionId,
        commandId: "q3",
      }),
    ),
  );
  assert.deepEqual(
    sent.map(({ event }) => event),
    ["execution_snapshot", "execution_children", "execution_tree"],
  );
  assert.deepEqual(
    sent.map(({ data }) => data.commandId),
    ["q1", "q2", "q3"],
  );
});

test("execution query rejects malformed and unavailable requests", async () => {
  const sent = [];
  const { createMessageHandler } = await import("../../ws/chat-websocket/message-handler.js");
  const create = ({ bot = {} } = {}) =>
    createMessageHandler({
      state: {},
      authInfo: { userId: "u1" },
      webSocket: { close() {} },
      sendEvent: (event, data) => sent.push({ event, data }),
      resolveBot: () => bot,
      pendingInteractionRequests: new Map(),
    });
  await create()(
    JSON.stringify(
      createProtocolTestCommand({
        commandType: EXECUTION_QUERY_COMMAND.SNAPSHOT_GET,
        sessionId: "s1",
        commandId: "bad",
      }),
    ),
  );
  await create()(
    JSON.stringify(
      createProtocolTestCommand({
        commandType: EXECUTION_QUERY_COMMAND.SNAPSHOT_GET,
        sessionId: "s1",
        executionId: "agent:x",
        commandId: "missing-reader",
      }),
    ),
  );
  assert.deepEqual(
    sent.map(({ data }) => ({ commandId: data.commandId, code: data.error?.code })),
    [
      { commandId: "bad", code: "missing_execution_id" },
      { commandId: "missing-reader", code: "execution_query_unavailable" },
    ],
  );
});
