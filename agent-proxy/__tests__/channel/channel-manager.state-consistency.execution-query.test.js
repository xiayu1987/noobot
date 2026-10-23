/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../../src/channel/channel-manager.js";
import { PENDING_COMMAND_KIND } from "../../src/channel/command-registry.js";
import { createChannelKey } from "../../src/shared/utils.js";
import {
  countPendingCommands,
  createMockSocket,
  FakeUpstreamWebSocket,
  getEvent,
  registerPendingCommand,
} from "./channel-manager.state-consistency.test-helpers.js";
import { AGENT_TRANSPORT_EVENT } from "@noobot/agent-transport-protocol";
import { createExecutionQueryEnvelope } from "@noobot/event-protocol/execution-query";
import {
  EXECUTION_CHILDREN_WIRE_EVENT,
  EXECUTION_SNAPSHOT_WIRE_EVENT,
  EXECUTION_TREE_WIRE_EVENT,
} from "@noobot/session-protocol/execution-lifecycle";

const QUERY_ROOT_EXECUTION = Object.freeze({
  executionId: "workflow:root",
  executionKind: "workflow",
  rootExecutionId: "workflow:root",
  sessionId: "session-execution-query",
  sequence: 1,
  revision: 1,
});

const QUERY_PAYLOAD_BY_WIRE_EVENT = Object.freeze({
  [EXECUTION_SNAPSHOT_WIRE_EVENT]: { execution: QUERY_ROOT_EXECUTION },
  [EXECUTION_CHILDREN_WIRE_EVENT]: { execution: QUERY_ROOT_EXECUTION, children: [] },
  [EXECUTION_TREE_WIRE_EVENT]: {
    rootExecutionId: QUERY_ROOT_EXECUTION.executionId,
    tree: { executions: { [QUERY_ROOT_EXECUTION.executionId]: QUERY_ROOT_EXECUTION } },
  },
});

function executionQueryEnvelope(wireEvent, commandId) {
  return createExecutionQueryEnvelope({
    wireEvent,
    commandId,
    executionId: QUERY_ROOT_EXECUTION.executionId,
    payload: QUERY_PAYLOAD_BY_WIRE_EVENT[wireEvent],
    occurredAt: "2026-10-17T00:00:00.000Z",
  });
}

test("upstream execution query responses return only to the registered requester", () => {
  FakeUpstreamWebSocket.instances = [];
  const manager = new ChannelManager(FakeUpstreamWebSocket);
  const channel = manager.ensureChannel(
    createChannelKey({ userId: "user-1", sessionId: "session-execution-query" }),
    { userId: "user-1", sessionId: "session-execution-query" },
  );
  manager.connectUpstreamChannel(channel, "api-key-1", "zh-CN", {
    initialCommands: [],
    purpose: "run",
  });
  const upstream = FakeUpstreamWebSocket.instances.at(-1);
  upstream.emit("open");
  const requester = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  const observer = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, observer);
  registerPendingCommand(manager, channel, "execution-query-1", {
    kind: PENDING_COMMAND_KIND.EXECUTION_QUERY,
    socket: requester,
    settle: (envelope) => manager.sendSocketEvent(requester, envelope),
  });

  upstream.emit(
    "message",
    JSON.stringify({
      event: EXECUTION_TREE_WIRE_EVENT,
      data: executionQueryEnvelope(EXECUTION_TREE_WIRE_EVENT, "execution-query-1"),
    }),
  );

  assert.equal(
    getEvent(requester, "execution_tree")?.data?.causality?.commandId,
    "execution-query-1",
  );
  assert.equal(getEvent(observer, "execution_tree"), null);
  assert.equal(countPendingCommands(manager, channel, PENDING_COMMAND_KIND.EXECUTION_QUERY), 0);
});

test("orphan execution query responses are dropped without closing upstream", () => {
  FakeUpstreamWebSocket.instances = [];
  const manager = new ChannelManager(FakeUpstreamWebSocket);
  const channel = manager.ensureChannel(
    createChannelKey({ userId: "user-1", sessionId: "session-orphan-query" }),
    { userId: "user-1", sessionId: "session-orphan-query" },
  );
  manager.connectUpstreamChannel(channel, "api-key-1", "zh-CN", {
    initialCommands: [],
    purpose: "run",
  });
  const upstream = FakeUpstreamWebSocket.instances.at(-1);
  upstream.emit("open");
  const observer = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, observer);
  const logged = [];
  const logChannelEvent = manager.logChannelEvent.bind(manager);
  manager.logChannelEvent = (target, entry) => {
    logged.push(entry.event);
    return logChannelEvent(target, entry);
  };

  for (const event of [
    EXECUTION_TREE_WIRE_EVENT,
    EXECUTION_SNAPSHOT_WIRE_EVENT,
    EXECUTION_CHILDREN_WIRE_EVENT,
  ]) {
    upstream.emit(
      "message",
      JSON.stringify({ event, data: executionQueryEnvelope(event, `late-${event}`) }),
    );
  }

  assert.equal(channel.upstreamClosed, false);
  assert.equal(getEvent(observer, AGENT_TRANSPORT_EVENT.CHANNEL_ERROR), null);
  assert.equal(getEvent(observer, "execution_tree"), null);
  assert.equal(
    logged.filter((event) => event === "agentProxy.upstream.executionQuery.orphanDropped").length,
    3,
  );
  assert.equal(logged.includes("agentProxy.upstream.message.dropped"), false);
});

test("execution query wire events without commandId remain invalid upstream events", () => {
  FakeUpstreamWebSocket.instances = [];
  const manager = new ChannelManager(FakeUpstreamWebSocket);
  const channel = manager.ensureChannel(
    createChannelKey({ userId: "user-1", sessionId: "session-query-no-id" }),
    { userId: "user-1", sessionId: "session-query-no-id" },
  );
  manager.connectUpstreamChannel(channel, "api-key-1", "zh-CN", {
    initialCommands: [],
    purpose: "run",
  });
  const upstream = FakeUpstreamWebSocket.instances.at(-1);
  upstream.emit("open");
  const observer = createMockSocket({ apiKey: "api-key-1", userId: "user-1" });
  manager.attachSubscriber(channel, observer);

  upstream.emit("message", JSON.stringify({ event: "execution_tree", data: { found: true } }));

  assert.equal(channel.upstreamClosed, true);
  assert.ok(getEvent(observer, AGENT_TRANSPORT_EVENT.CHANNEL_ERROR));
});
