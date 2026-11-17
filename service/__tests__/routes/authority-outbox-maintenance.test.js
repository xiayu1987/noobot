/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { flushJsonLineBatches } from "@noobot/runtime-events";
import {
  withRuntimeEventsRoot,
  initializeSessionTree,
  persistSession,
} from "../runtime-events-root.test-helpers.js";
import {
  createAuthorityEventDispatcher,
  AUTHORITY_EVENT_CONSUMER,
} from "../../ws/chat-websocket/authority-event-dispatcher.js";
import { createTestLifecycleEnvelope } from "./chat-websocket-server.turn-lifecycle.fixtures.js";
import {
  compactAuthorityEventOutbox,
  normalizeAuthorityEventOutbox,
} from "@noobot/event-protocol/outbox";

const idleMs = TIME_THRESHOLDS.agent.authorityOutboxCompactIntervalMs;
const identity = { userId: "u-idle", sessionId: "s-idle", persistenceScope: null };

function fixture(t, compact) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  const bot = {
    session: {
      readServerNow: () => "2026-11-12T12:00:00.000Z",
      getPendingAuthorityEvents: async () => ({ found: true, events: [] }),
      compactAuthorityEvents: async (request) => {
        calls.push(request);
        if (compact) await compact();
        return { compacted: true, nextRetainedDeliveryAt: null };
      },
    },
  };
  let currentBot = bot;
  const resolveBot = () => currentBot;
  const dispatcher = () =>
    createAuthorityEventDispatcher({
      resolveBot,
      sendEvent: () => true,
      consumerId: AUTHORITY_EVENT_CONSUMER.WEBSOCKET,
    });
  return {
    bot,
    calls,
    dispatcher,
    replaceBot: (next) => {
      currentBot = next;
    },
  };
}

test("multiple connections share a fixed maintenance deadline and retain the delivery cutoff", async (t) => {
  const { calls, dispatcher } = fixture(t);
  await dispatcher()(identity);
  t.mock.timers.tick(idleMs - 1);
  await dispatcher()(identity);
  t.mock.timers.tick(1);
  await setImmediate();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    ...identity,
    retainDeliveredAfter: new Date(
      Date.parse("2026-11-12T12:00:00.000Z") -
        TIME_THRESHOLDS.agent.authorityOutboxDeliveredRetentionMs,
    ).toISOString(),
  });
  t.mock.timers.tick(idleMs * 2);
  assert.equal(calls.length, 1);
});

test("delivery neither waits for nor duplicates an in-flight maintenance operation", async (t) => {
  const pending = Promise.withResolvers();
  const { calls, dispatcher } = fixture(t, () => pending.promise);
  const dispatch = dispatcher();
  await dispatch(identity);
  t.mock.timers.tick(idleMs);
  assert.equal(calls.length, 1);
  assert.deepEqual(await dispatch(identity), { dispatched: true, delivered: 0 });
  t.mock.timers.tick(idleMs * 2);
  assert.equal(calls.length, 1);
  pending.resolve();
  await setImmediate();
  t.mock.timers.tick(idleMs);
  await setImmediate();
  assert.equal(calls.length, 2);
});

test("an active delivery postpones maintenance across connections and scopes stay independent", async (t) => {
  const { bot, calls, dispatcher } = fixture(t);
  await dispatcher()(identity);
  const pending = Promise.withResolvers();
  bot.session.getPendingAuthorityEvents = () => pending.promise;
  const delivery = dispatcher()(identity);
  t.mock.timers.tick(idleMs * 2);
  assert.equal(calls.length, 0);
  pending.resolve({ found: true, events: [] });
  await delivery;
  assert.equal(calls.length, 0);
  t.mock.timers.tick(0);
  await setImmediate();
  assert.equal(calls.length, 1);
  await dispatcher()({ ...identity, sessionId: "s-other" });
  t.mock.timers.tick(idleMs);
  await setImmediate();
  assert.deepEqual(calls.map((request) => request.sessionId).sort(), ["s-idle", "s-other"]);
});

test("scheduled maintenance resolves the current Bot after runtime reconfiguration", async (t) => {
  const { calls, dispatcher, replaceBot } = fixture(t);
  await dispatcher()(identity);
  let compacted = 0;
  replaceBot({
    session: {
      readServerNow: () => "2026-11-12T12:00:00.000Z",
      compactAuthorityEvents: async () => {
        compacted += 1;
        return { compacted: false, removed: 0, nextRetainedDeliveryAt: null };
      },
    },
  });
  t.mock.timers.tick(idleMs);
  await setImmediate();
  assert.equal(compacted, 1);
  assert.equal(calls.length, 0);
});

test("continuous delivery cannot postpone maintenance beyond its scheduled interval", async (t) => {
  const { calls, dispatcher } = fixture(t);
  const dispatch = dispatcher();
  for (let index = 0; index < 10; index += 1) {
    await dispatch(identity);
    t.mock.timers.tick(idleMs / 2);
    await setImmediate();
    assert.equal(calls.length, Math.floor((index + 1) / 2));
  }
  t.mock.timers.tick(idleMs * 2);
  await setImmediate();
  assert.equal(calls.length, 5);
});

for (const failureMode of ["return-false", "throw"]) {
  test(`partial delivery schedules maintenance after publisher ${failureMode}`, async (t) => {
    const { bot, calls, dispatcher } = fixture(t);
    const events = [1, 2].map((sequence) => {
      const envelope = createTestLifecycleEnvelope({
        eventId: `partial-${sequence}`,
        sequence,
        sessionId: identity.sessionId,
      });
      return { eventId: envelope.identity.eventId, envelope };
    });
    bot.session.getPendingAuthorityEvents = async () => ({ found: true, events });
    bot.session.recordAuthorityEventAttempts = async () => ({ recorded: true });
    const acknowledged = [];
    bot.session.acknowledgeAuthorityEvents = async ({ acknowledgements }) => {
      acknowledged.push(...acknowledgements.map((item) => item.eventId));
      return { acknowledged: true };
    };
    const failure = new Error("publisher failed after one delivery");
    const delivery = dispatcher()(identity, async (_type, envelope) => {
      if (envelope.identity.eventId === events[0].eventId) return true;
      if (failureMode === "throw") throw failure;
      return false;
    });
    if (failureMode === "throw") await assert.rejects(delivery, (error) => error === failure);
    else
      assert.deepEqual(await delivery, {
        dispatched: false,
        reason: "authority_event_send_failed",
        delivered: 1,
      });
    assert.deepEqual(acknowledged, [events[0].eventId]);
    t.mock.timers.tick(idleMs);
    await setImmediate();
    assert.equal(calls.length, 1);
    t.mock.timers.tick(idleMs * 2);
    await setImmediate();
    assert.equal(calls.length, 1);
  });
}

test("retention expires without another dispatch and without periodic scans", async (t) => {
  const { bot, calls, dispatcher } = fixture(t);
  const deliveredAt = "2026-11-12T12:00:00.000Z";
  let now = Date.parse(deliveredAt);
  bot.session.readServerNow = () => new Date(now).toISOString();
  const envelope = createTestLifecycleEnvelope({
    eventId: "retained",
    sequence: 1,
    sessionId: identity.sessionId,
  });
  let outbox = normalizeAuthorityEventOutbox([
    {
      eventId: envelope.identity.eventId,
      envelope,
      committedAt: deliveredAt,
      deliveries: {
        "service.websocket": {
          attempts: 0,
          lastAttemptAt: "",
          deliveredAt,
          orderingDomain: envelope.ordering.domain,
          orderingScopeId: envelope.ordering.scopeId,
          sequence: envelope.ordering.sequence,
        },
      },
    },
  ]);
  bot.session.compactAuthorityEvents = async (request) => {
    calls.push(request);
    const result = compactAuthorityEventOutbox(outbox, request);
    outbox = result.outbox;
    return { ...result, hasMore: false };
  };
  await dispatcher()(identity);
  now += idleMs;
  t.mock.timers.tick(idleMs);
  await setImmediate();
  assert.equal(calls.length, 1);
  assert.equal(outbox.length, 1);
  const remaining = TIME_THRESHOLDS.agent.authorityOutboxDeliveredRetentionMs - idleMs;
  now += remaining;
  t.mock.timers.tick(remaining);
  await setImmediate();
  assert.equal(calls.length, 1, "cutoff equality retains the delivery without polling");
  now += 1;
  t.mock.timers.tick(1);
  await setImmediate();
  assert.equal(calls.length, 2);
  assert.equal(outbox.length, 0);
  t.mock.timers.tick(TIME_THRESHOLDS.agent.authorityOutboxDeliveredRetentionMs);
  await setImmediate();
  assert.equal(calls.length, 2, "completed cleanup releases the schedule");
});

test("retention deadlines survive later maintenance pages and do not delay new delivery", async (t) => {
  const { bot, calls, dispatcher } = fixture(t);
  let now = Date.parse("2026-11-12T12:00:00.000Z");
  bot.session.readServerNow = () => new Date(now).toISOString();
  const expiresAt = now + idleMs * 5;
  const retained = new Date(
    expiresAt - TIME_THRESHOLDS.agent.authorityOutboxDeliveredRetentionMs - 1,
  ).toISOString();
  bot.session.compactAuthorityEvents = async (request) => {
    calls.push(request);
    return {
      compacted: false,
      hasMore: calls.length === 1,
      nextRetainedDeliveryAt: calls.length === 1 ? retained : null,
    };
  };
  await dispatcher()(identity);
  for (let index = 0; index < 2; index += 1) {
    now += idleMs;
    t.mock.timers.tick(idleMs);
    await setImmediate();
  }
  assert.equal(calls.length, 2);
  await dispatcher()(identity);
  now += idleMs;
  t.mock.timers.tick(idleMs);
  await setImmediate();
  assert.equal(calls.length, 3, "new work keeps the regular maintenance deadline");
  now = expiresAt;
  t.mock.timers.tick(idleMs * 2);
  await setImmediate();
  assert.equal(calls.length, 4, "earlier page retention still wakes cleanup");
});

for (const busy of ["delivery", "maintenance"]) {
  test(`retention expiry waits for active ${busy} and resumes exactly once`, async (t) => {
    const { bot, calls, dispatcher } = fixture(t);
    let now = Date.parse("2026-11-12T12:00:00.000Z");
    const expiresAt = now + idleMs * 3;
    const retained = new Date(
      expiresAt - TIME_THRESHOLDS.agent.authorityOutboxDeliveredRetentionMs - 1,
    ).toISOString();
    const gate = Promise.withResolvers();
    bot.session.readServerNow = () => new Date(now).toISOString();
    bot.session.compactAuthorityEvents = async (request) => {
      calls.push(request);
      if (busy === "maintenance" && calls.length === 2) await gate.promise;
      return {
        compacted: false,
        hasMore: false,
        nextRetainedDeliveryAt: calls.length === 1 ? retained : null,
      };
    };
    const dispatch = dispatcher();
    await dispatch(identity);
    now += idleMs;
    t.mock.timers.tick(idleMs);
    await setImmediate();
    let delivery;
    if (busy === "delivery") {
      bot.session.getPendingAuthorityEvents = () => gate.promise;
      delivery = dispatch(identity);
    } else {
      await dispatch(identity);
      now += idleMs;
      t.mock.timers.tick(idleMs);
      await setImmediate();
    }
    const beforeExpiry = calls.length;
    t.mock.timers.tick(expiresAt - now);
    now = expiresAt;
    await setImmediate();
    assert.equal(calls.length, beforeExpiry, "expiry cannot overlap active work");
    gate.resolve({ found: true, events: [] });
    if (delivery) await delivery;
    await setImmediate();
    t.mock.timers.tick(0);
    await setImmediate();
    assert.equal(calls.length, beforeExpiry + 1);
    t.mock.timers.tick(idleMs * 2);
    await setImmediate();
    assert.equal(calls.length, beforeExpiry + 1);
  });
}

test("maintenance failure is recorded and retried without blocking delivery", async (t) => {
  await withRuntimeEventsRoot("noobot-outbox-maintenance-", async (workspaceRoot) => {
    await initializeSessionTree(workspaceRoot, identity.userId);
    const dir = await persistSession(workspaceRoot, identity.userId, {
      sessionId: identity.sessionId,
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    let fail = true;
    const { calls, dispatcher } = fixture(t, () => {
      if (fail) throw new Error("compaction disk failure");
    });
    const dispatch = dispatcher();
    await dispatch(identity);
    const systemFile = path.join(dir, "events", "system.jsonl");
    await mkdir(path.dirname(systemFile), { recursive: true });
    await writeFile(systemFile, "");
    const written = Promise.withResolvers();
    const watcher = watch(systemFile, (event) => {
      if (event === "change") written.resolve();
    });
    watcher.on("error", written.reject);
    t.after(() => watcher.close());
    t.mock.timers.tick(idleMs);
    await written.promise;
    await flushJsonLineBatches();
    await setImmediate();
    watcher.close();
    const records = (await readFile(systemFile, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(records?.[0]?.event, "service.authorityOutbox.compactionFailed");
    assert.equal(records[0].data.error, "compaction disk failure");
    fail = false;
    assert.equal((await dispatch(identity)).dispatched, true);
    t.mock.timers.tick(idleMs - 1);
    assert.equal(calls.length, 1);
    t.mock.timers.tick(1);
    await setImmediate();
    assert.equal(calls.length, 2);
  });
});
