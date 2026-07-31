/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ChannelEventJournal } from "../../src/channel/channel-event-journal.js";
import { CommandRegistry } from "../../src/channel/command-registry.js";
import { ChannelManager } from "../../src/channel/channel-manager.js";
import { config } from "../../src/shared/config.js";

test("channel event journal is the bounded ordered replay source", () => {
  const journal = new ChannelEventJournal({ maxEvents: 2 });
  journal.append("thinking", { value: 1 });
  journal.append("delta", { value: 2 });
  journal.append("done", { value: 3 });
  assert.deepEqual(journal.events.map((event) => event.sequence), [2, 3]);
  assert.deepEqual(journal.after(2).map((event) => event.event), ["done"]);
});

test("command registry cancels requester commands and expires routes", () => {
  let currentMs = 0;
  const requester = {};
  const registry = new CommandRegistry({ now: () => currentMs, defaultTtlMs: 100 });
  registry.register("snapshot-1", { channelKey: "channel-1", commandType: "turn_snapshot", requester });
  registry.registerRoute("interaction-1", { channelKey: "channel-1" });
  assert.equal(registry.cancelRequester(requester), 1);
  currentMs = 100;
  registry.cleanup({ channelExists: () => true });
  assert.equal(registry.routes.has("interaction-1"), false);
});

test("command registry cancels reconnect snapshot commands by nested socket requester", () => {
  const registry = new CommandRegistry();
  const socket = {};
  let resolution = null;
  registry.register("snapshot-reconnect", {
    channelKey: "channel-1",
    commandType: "turn_snapshot",
    requester: {
      socket,
      resolve: (result) => { resolution = result; },
    },
  });

  assert.equal(registry.cancelRequester(socket), 1);
  assert.deepEqual(resolution, { ok: false, reason: "requester_disconnected" });
  assert.equal(registry.get("snapshot-reconnect"), null);
});

test("subscriber delivery closes a slow consumer at the backpressure boundary", () => {
  const manager = new ChannelManager({ OPEN: 1, CLOSED: 3 });
  let closeReason = "";
  const socket = {
    readyState: 1,
    bufferedAmount: config.wsMaxBufferedBytes + 1,
    close(_code, reason) { closeReason = reason; },
  };
  const result = manager.sendSocketEvent(socket, { event: "delta", data: {} });
  assert.equal(result.reason, "backpressure_limit");
  assert.equal(closeReason, "slow_consumer");
});
