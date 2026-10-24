/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { transitionTurnLifecycle } from "@noobot/authoritative-state/domain";

import { TURN_EVENT } from "@noobot/session-protocol";
import { finalizeTurnSnapshot } from "../../ws/chat-websocket/turn-recovery.js";

import { EXECUTION_QUERY_COMMAND } from "@noobot/session-protocol/execution-lifecycle";
import { validateProtocolEvent } from "@noobot/event-protocol";
import {
  createAcceptedAgentExecutionIdentity,
  createProtocolTestCommand,
} from "./chat-websocket-server.test-helpers.js";

test("finalize recovery is idempotent across repeated service recovery attempts", async () => {
  let lifecycle = {};
  const apply = (input) => {
    const result = transitionTurnLifecycle(lifecycle, input);
    lifecycle = result.lifecycle;
    return result;
  };
  apply({
    sessionId: "s-recover",
    turnScopeId: "turn-recover",
    ...createAcceptedAgentExecutionIdentity({ turnScopeId: "turn-recover" }),
    dialogProcessId: "dp-recover",
    presentationMessageId: "presentation-recover",
    commandId: "start",
    causationId: "start",
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    startedAt: "2026-07-18T00:00:00.000Z",
    phase: "action",
    action: "send",
  });
  apply({
    turnScopeId: "turn-recover",
    commandId: "running",
    causationId: "running",
    eventType: TURN_EVENT.PROCESSING_STARTED,
    phase: "processing",
  });
  apply({
    turnScopeId: "turn-recover",
    commandId: "processed",
    causationId: "processed",
    eventType: TURN_EVENT.PROCESSING_COMPLETED,
    phase: "completion",
    completionCommitId: "stable-finalize",
  });
  const bot = {
    session: {
      async getTurnLifecycleSnapshot({ commandId }) {
        const turn = lifecycle.turns["turn-recover"];
        return {
          found: true,
          snapshot: { commandId, activeTurn: lifecycle.activeTurnScopeId ? turn : null },
        };
      },
    },
  };
  const commitTurnLifecycle = async (input) =>
    apply(input.terminalStatus ? { ...input, summaryVersion: 4 } : input);
  const request = { bot, commitTurnLifecycle, userId: "u1", sessionId: "s1", commandId: "recover" };
  const first = await finalizeTurnSnapshot(request);
  const second = await finalizeTurnSnapshot(request);
  assert.equal(first.recovered, true);
  assert.equal(first.action, "finalize");
  assert.equal(first.snapshot.activeTurn, null);
  assert.equal(first.snapshot.recovery, "none");
  assert.equal(second.recovered, false);
  assert.equal(second.action, "none");
  assert.equal(second.reason, "no_active_turn");
  assert.equal(second.snapshot.recovery, "none");
  assert.equal(lifecycle.turns["turn-recover"].summaryVersion, 4);
  assert.equal(lifecycle.turns["turn-recover"].completionCommitId, "stable-finalize");
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
  const generatedAt = "2026-10-17T00:00:00.000Z";
  const bot = {
    session: {
      async getExecution() {
        return { found: true, execution: root, generatedAt };
      },
      async getExecutionChildren() {
        return { found: true, execution: root, children: [child], generatedAt };
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
          generatedAt,
        };
      },
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
  });
  await handler(
    JSON.stringify(
      createProtocolTestCommand({
        commandType: EXECUTION_QUERY_COMMAND.SNAPSHOT_GET,
        sessionId: "root-session",
        executionId: root.executionId,
        rootExecutionId: "",
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
        rootExecutionId: "",
        commandId: "q2",
      }),
    ),
  );
  await handler(
    JSON.stringify(
      createProtocolTestCommand({
        commandType: EXECUTION_QUERY_COMMAND.TREE_GET,
        sessionId: "root-session",
        executionId: "",
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
    sent.map(({ data }) => data.causality.commandId),
    ["q1", "q2", "q3"],
  );
  for (const { data } of sent) {
    assert.equal(validateProtocolEvent(data).valid, true);
    assert.equal(data.identity.executionId, root.executionId);
    assert.equal(data.ordering.scopeId, root.executionId);
    assert.equal(data.occurredAt, generatedAt);
    assert.equal("commandId" in data, false);
  }
  assert.deepEqual(Object.keys(sent[2].data.payload).sort(), ["rootExecutionId", "tree"]);
});

test("execution query rejects a malformed target", async () => {
  const sent = [];
  const { createMessageHandler } = await import("../../ws/chat-websocket/message-handler.js");
  const handleMessage = createMessageHandler({
    state: {},
    authInfo: { userId: "u1" },
    webSocket: { close() {} },
    sendEvent: (event, data) => sent.push({ event, data }),
    resolveBot: () => ({ session: {} }),
  });
  await handleMessage(
    JSON.stringify({
      ...createProtocolTestCommand({
        commandType: EXECUTION_QUERY_COMMAND.SNAPSHOT_GET,
        sessionId: "s1",
        executionId: "agent:x",
        rootExecutionId: "",
        commandId: "bad",
      }),
      query: { executionId: "", rootExecutionId: "" },
    }),
  );
  assert.deepEqual(
    sent.map(({ data }) => ({ commandId: data.commandId, code: data.error?.code })),
    [{ commandId: "bad", code: "invalid_execution_query_target" }],
  );
});
