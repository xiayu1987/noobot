/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ChannelManager } from "../src/channel-manager.js";
import { createChannelKey } from "../src/utils.js";
import { CONVERSATION_SOURCE_EVENT, CONVERSATION_STATE } from "../src/constants.js";

test("ChannelManager writes message and state logs to business session", () => {
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
  manager.pushChannelEvent(channel, "message", {
    sessionId: "session-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    requestId: "request-1",
    content: "full message should not be mirrored into summary",
  });
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

  assert.equal(records.length, 2);
  assert.deepEqual(records.map((item) => item.apiKey), ["api-key-1", "api-key-1"]);

  assert.equal(records[0].event.category, "message");
  assert.equal(records[0].event.event, "agentProxy.channel.event");
  assert.equal(records[0].event.sessionId, "session-1");
  assert.deepEqual(records[0].event.data, {
    channelKey,
    event: "message",
    sequence: 1,
    sessionId: "session-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    requestId: "request-1",
    hasContent: true,
  });

  assert.equal(records[1].event.category, "state");
  assert.equal(records[1].event.event, "agentProxy.conversation.state");
  assert.equal(records[1].event.sessionId, "session-1");
  assert.equal(records[1].event.dialogProcessId, "dialog-1");
  assert.equal(records[1].event.turnScopeId, "turn-1");
  assert.deepEqual(records[1].event.data, {
    channelKey,
    state: CONVERSATION_STATE.SENDING,
    sourceEvent: CONVERSATION_SOURCE_EVENT.INIT,
    seq: 1,
    requestId: "request-1",
  });
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
