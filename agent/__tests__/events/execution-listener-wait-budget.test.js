/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  executionLogQueueWaitBudget,
  executionLogQueueWaitFailure,
} from "@noobot/session-protocol";
import { createExecutionEventListener } from "../../src/events/execution-listener.js";
import { createEventEnvelope, EVENT_FAMILY, getEventFamily } from "@noobot/event-protocol";

const route = {
  userId: "u1",
  sessionId: "s1",
  parentSessionId: "",
  dialogProcessId: "d1",
  turnScopeId: "t1",
};
const emit = (listener, sequence) => listener.onEvent({ event: "wait_test", data: { sequence } });
const createListener = (appendExecutionLogs, upstream = null) =>
  createExecutionEventListener({
    ...route,
    persistenceScope: null,
    now: () => "2026-11-15T00:00:00.000Z",
    sessionManager: { appendExecutionLogs },
    upstream,
  });

function clockFor(t) {
  let value = 0;
  t.mock.method(performance, "now", () => value);
  return (time) => {
    value = time;
  };
}

test("queue wait protocol accepts its boundary and reports structured budget violations", () => {
  const budget = executionLogQueueWaitBudget();
  assert.ok(budget > 0);
  assert.equal(executionLogQueueWaitFailure(budget, budget), null);
  const error = executionLogQueueWaitFailure(budget + 1, budget);
  assert.equal(error.code, "EXECUTION_LOG_QUEUE_WAIT_EXCEEDED");
  assert.equal(error.waitMs, budget + 1);
  assert.equal(error.maxWaitMs, budget);
  for (const [wait, max] of [
    [-1, budget],
    [NaN, budget],
    [0, 0],
    [0, Infinity],
  ]) {
    assert.throws(() => executionLogQueueWaitFailure(wait, max), RangeError);
  }
});

for (const fails of [false, true]) {
  test(`overdue admission waits for accepted records after write ${fails ? "failure" : "success"}`, async (t) => {
    const setTime = clockFor(t);
    const budget = executionLogQueueWaitBudget();
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    t.after(() => release.resolve());
    const batches = [];
    const writeFailure = new Error("disk failure");
    let first = true;
    const listener = createListener(async ({ records }) => {
      batches.push(records.map(({ data }) => data.sequence));
      if (first) {
        first = false;
        started.resolve();
        await release.promise;
        if (fails) throw writeFailure;
      }
    });
    emit(listener, "active");
    await started.promise;
    emit(listener, "queued");
    setTime(budget);
    emit(listener, "at-boundary");
    setTime(budget + 1);
    let admitted = false;
    const admission = emit(listener, "after-budget").then(() => {
      admitted = true;
    });
    await Promise.resolve();
    assert.equal(admitted, false);
    release.resolve();
    await admission;
    assert.equal(admitted, true);
    if (fails) {
      await assert.rejects(listener.flush(), (error) => {
        assert.equal(error.code, "EXECUTION_LOG_PERSISTENCE_FAILED");
        assert.equal(error.cause, writeFailure);
        assert.equal(error.failures.length, 1);
        return true;
      });
    } else {
      await listener.flush();
    }
    assert.deepEqual(batches, [["active"], ["queued", "at-boundary", "after-budget"]]);
    await emit(listener, "after-drain");

    if (fails) await assert.rejects(listener.flush(), { code: "EXECUTION_LOG_PERSISTENCE_FAILED" });
    else await listener.flush();
    assert.deepEqual(batches.at(-1), ["after-drain"]);
  });
}

test("flush completes delayed accepted records when no producer attempts another admission", async (t) => {
  const setTime = clockFor(t);
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  const persisted = [];
  const listener = createListener(async ({ records }) => {
    if (records[0].data.sequence === 0) {
      started.resolve();
      await release.promise;
    }
    persisted.push(...records.map(({ data }) => data.sequence));
  });
  emit(listener, 0);
  await started.promise;
  emit(listener, 1);
  setTime(executionLogQueueWaitBudget() + 1);
  let settled = false;
  const completion = listener.flush().then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  release.resolve();
  await completion;
  assert.deepEqual(persisted, [0, 1]);
});

test("active persistence duration alone does not consume the queue wait budget", async (t) => {
  const setTime = clockFor(t);
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  const persisted = [];
  let first = true;
  const listener = createListener(async ({ records }) => {
    if (first) {
      first = false;
      started.resolve();
      await release.promise;
    }
    persisted.push(...records.map(({ data }) => data.sequence));
  });
  emit(listener, 0);
  await started.promise;
  setTime(executionLogQueueWaitBudget() * 2);
  emit(listener, 1);
  release.resolve();
  await listener.flush();
  assert.deepEqual(persisted, [0, 1]);
});

test("overdue diagnostics preserve subsequent delivery and report the actual delivery failure", async (t) => {
  const setTime = clockFor(t);
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  const delivered = [];
  const persisted = [];
  const listener = createListener(
    async ({ records }) => {
      started.resolve();
      await release.promise;
      persisted.push(...records.map(({ data }) => data.sequence));
    },
    {
      async onEvent({ data }) {
        delivered.push(data.presentationMessageId);
        return data.presentationMessageId !== "failed";
      },
    },
  );
  emit(listener, 0);
  await started.promise;
  emit(listener, 1);
  setTime(executionLogQueueWaitBudget() + 1);
  assert.equal(
    await listener.forwardEvent({
      event: "message",
      data: { presentationMessageId: "failed" },
      route,
    }),
    false,
  );
  await listener.forwardEvent({ event: "message", data: { presentationMessageId: "next" }, route });
  release.resolve();
  await assert.rejects(listener.flush(), (error) => {
    assert.equal(error.code, "EVENT_UPSTREAM_DELIVERY_FAILED");
    assert.equal(error.failures.length, 1);
    return true;
  });
  assert.deepEqual(delivered, ["failed", "next"]);
  assert.deepEqual(persisted, [0, 1, 0]);
});

test("overdue lifecycle admission waits for persistence and preserves its delivery result", async (t) => {
  const setTime = clockFor(t);
  const started = Promise.withResolvers();
  const releasePersistence = Promise.withResolvers();
  const deliveryStarted = Promise.withResolvers();
  const releaseDelivery = Promise.withResolvers();
  t.after(() => {
    releasePersistence.resolve();
    releaseDelivery.resolve();
  });
  const delivered = { delivered: true };
  const listener = createListener(
    async () => {
      started.resolve();
      await releasePersistence.promise;
    },
    {
      async onEvent() {
        deliveryStarted.resolve();
        await releaseDelivery.promise;
        return delivered;
      },
    },
  );
  emit(listener, "active");
  await started.promise;
  emit(listener, "queued");
  setTime(executionLogQueueWaitBudget() + 1);
  let completed = false;
  const admission = listener
    .onEvent({ event: "turn_lifecycle_committed", data: {} })
    .then((result) => {
      completed = true;
      return result;
    });
  await deliveryStarted.promise;
  assert.equal(completed, false);
  releasePersistence.resolve();
  await Promise.resolve();
  assert.equal(completed, false);
  releaseDelivery.resolve();
  assert.equal(await admission, delivered);
  await listener.flush();
});

test("transient message delivery waits for an overdue queue without adding a log record", async (context) => {
  const setTime = clockFor(context);
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  context.after(() => release.resolve());
  const persisted = [];
  const forwarded = [];
  const listener = createListener(
    async ({ records }) => {
      started.resolve();
      await release.promise;
      persisted.push(...records);
    },
    {
      async onEvent(event) {
        forwarded.push(event);
        return true;
      },
    },
  );
  emit(listener, "active");
  await started.promise;
  emit(listener, "queued");
  setTime(executionLogQueueWaitBudget() + 1);
  const envelope = createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    schemaVersion: getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).schemaVersion,
    identity: { eventId: "delta", eventType: "message_event", sessionId: "s1", turnScopeId: "t1" },
    causality: {},
    ordering: { domain: "message-event", scopeId: "presentation", sequence: 0 },
    producer: { type: "agent", id: "message-runtime" },
    occurredAt: "2026-11-25T00:00:00.000Z",
    payload: {
      eventType: "llm_delta",
      presentationMessageId: "presentation",
      dialogProcessId: "d1",
      text: "continued answer",
    },
  });
  let completed = false;
  const admission = listener
    .onEvent({ event: "authority_event_committed", data: { envelope } })
    .then((result) => {
      completed = true;
      return result;
    });
  await Promise.resolve();
  assert.equal(completed, false);
  release.resolve();
  assert.equal(await admission, true);
  await listener.flush();
  assert.equal(forwarded[0].data.envelope, envelope);
  assert.deepEqual(
    persisted.map(({ data }) => data.sequence),
    ["active", "queued"],
  );
});
