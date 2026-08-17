/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../../src/channel/channel-manager.js";
import { createChannelKey } from "../../src/shared/utils.js";
import { CONVERSATION_SOURCE_EVENT, CONVERSATION_STATE } from "../../src/shared/constants.js";
import { canonicalMessageEvent } from "./channel-manager.state-consistency.test-helpers.js";
import { MESSAGE_EVENT_WIRE_EVENT } from "@noobot/event-protocol/message-event";

test("ChannelManager omits successful data-plane logs but retains state logs", () => {
  const records = [];
  const sessionLogClient = {
    log(apiKey, event) {
      records.push({ apiKey, event });
      return true;
    },
  };
  const manager = new ChannelManager({ OPEN: 1 }, { sessionLogClient });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-1" });
  const channel = manager.ensureChannel(channelKey, {
    sessionId: "session-1",
    dialogProcessId: "dialog-start",
    turnScopeId: "turn-start",
  });
  channel.apiKey = "api-key-1";

  records.length = 0;
  manager.pushChannelEvent(channel, MESSAGE_EVENT_WIRE_EVENT, canonicalMessageEvent({
    text: "full message should not be mirrored into summary",
  }));
  manager.updateConversationState(channel, {
    sessionId: "session-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    state: CONVERSATION_STATE.SENDING,
    sourceEvent: CONVERSATION_SOURCE_EVENT.INIT,
    seq: 1,
    requestId: "request-1",
    broadcast: false,
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].apiKey, "api-key-1");
  assert.equal(records[0].event.category, "state");
  assert.equal(records[0].event.event, "agentProxy.conversation.state");
  assert.equal(records[0].event.sessionId, "session-1");
  assert.equal(records[0].event.dialogProcessId, "dialog-1");
  assert.equal(records[0].event.turnScopeId, "turn-1");
  assert.deepEqual(records[0].event.data, {
    channelKey,
    state: CONVERSATION_STATE.SENDING,
    sourceEvent: CONVERSATION_SOURCE_EVENT.INIT,
    seq: 1,
    requestId: "request-1",
  });
});

test("ChannelManager counts nested authoritative message events without session logging", () => {
  const records = [];
  const manager = new ChannelManager({ OPEN: 1 }, {
    sessionLogClient: { log: (apiKey, event) => records.push({ apiKey, event }) },
  });
  const channel = manager.ensureChannel(
    createChannelKey({ userId: "user-1", sessionId: "session-1" }),
    { sessionId: "session-1" },
  );
  channel.apiKey = "api-key-1";
  records.length = 0;

  manager.pushChannelEvent(channel, MESSAGE_EVENT_WIRE_EVENT, canonicalMessageEvent({
    messageId: "message-1",
    text: "authoritative result",
  }));

  assert.equal(records.length, 0);
  assert.equal(manager.drainSuccessfulDataPlaneMetrics()?.channelEvents, 1);
});

test("ChannelManager falls back to session id from channel key for session logs", () => {
  const records = [];
  const manager = new ChannelManager({ OPEN: 1 }, {
    sessionLogClient: { log: (apiKey, event) => records.push({ apiKey, event }) },
  });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "session-from-key" });
  const channel = manager.ensureChannel(channelKey);
  channel.ownerApiKey = "owner-key";

  records.length = 0;
  manager.updateConversationState(channel, {
    state: CONVERSATION_STATE.SENDING,
    sourceEvent: CONVERSATION_SOURCE_EVENT.CHANNEL_STATUS,
    seq: 2,
    broadcast: false,
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].apiKey, "owner-key");
  assert.equal(records[0].event.sessionId, "session-from-key");
  assert.equal(records[0].event.category, "state");
});

test("ChannelManager assigns child session logs to the root session from the channel key", () => {
  const records = [];
  const manager = new ChannelManager({ OPEN: 1 }, {
    sessionLogClient: { log: (apiKey, event) => records.push({ apiKey, event }) },
  });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "root-session" });
  const channel = manager.ensureChannel(channelKey, { sessionId: "root-session" });

  records.length = 0;
  manager.logSessionEvent(channel, {
    category: "transport",
    event: "agentProxy.child.transport",
    sessionId: "workflow-child-session",
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].event.sessionId, "workflow-child-session");
  assert.equal(records[0].event.parentSessionId, "root-session");
});

test("ChannelManager ignores placeholder parent session ids", () => {
  const records = [];
  const manager = new ChannelManager({ OPEN: 1 }, {
    sessionLogClient: { log: (apiKey, event) => records.push({ apiKey, event }) },
  });
  const channelKey = createChannelKey({ userId: "user-1", sessionId: "root-session" });
  const channel = manager.ensureChannel(channelKey, {
    sessionId: "root-session",
    parentSessionId: "undefined",
  });

  records.length = 0;
  manager.logSessionEvent(channel, {
    category: "transport",
    event: "agentProxy.root.transport",
    sessionId: "root-session",
    parentSessionId: "UNDEFINED",
    data: { parentSessionId: "null" },
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].event.sessionId, "root-session");
  assert.equal(records[0].event.parentSessionId, undefined);
  assert.equal(records[0].event.data.parentSessionId, undefined);
});

test("ChannelManager does not infer log turn identity from channel start payload", () => {
  const records = [];
  const manager = new ChannelManager({ OPEN: 1 }, {
    sessionLogClient: { log: (apiKey, event) => records.push({ apiKey, event }) },
  });
  const channel = manager.ensureChannel(
    createChannelKey({ userId: "user-1", sessionId: "session-1" }),
    { sessionId: "session-1", turnScopeId: "stale-start-turn" },
  );

  records.length = 0;
  manager.logSessionEvent(channel, {
    category: "transport",
    event: "agentProxy.transport.observed",
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].event.turnScopeId, "");
});
