/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { rename } from "node:fs/promises";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  immutableMutationFixture,
  mutationMessage as message,
  mutationTime,
} from "../helpers/immutable-mutation-integration-fixture.js";

const deletion = (fixture, scope = "drop", fields = {}) => ({
  ...fixture.request,
  anchor: { turnScopeId: scope },
  commandId: "delete-tail",
  ...fields,
});

test("interleaved deletion response preserves the partial turn and replays exact original message effects", async (t) => {
  const f = await immutableMutationFixture(t, {
    messages: [message("a1", "a"), message("b1", "b"), message("a2", "a")],
  });
  const request = deletion(f, "b");
  const first = await f.service.deleteFromMessage(request);
  assert.deepEqual(first.projection.messageSuffix, { firstOrdinal: 2, previousMessageCount: 3 });
  assert.deepEqual(
    (await (await f.open()).exportSession()).messages.map((entry) => entry.messageUid),
    ["a1"],
  );
  await f.commit({ messages: [message("a1", "a", { content: "later edit" }), message("a3", "a")] });
  const beforeRetry = await f.open();
  const retry = await f.service.deleteFromMessage(request);
  assert.equal(retry.deduplicated, true);
  assert.deepEqual(retry.projection.messageSuffix, first.projection.messageSuffix);
  assert.deepEqual(
    (await (await f.open()).exportSession()).messages.map((entry) => entry.content),
    ["later edit", "a3"],
  );
  assert.equal((await f.open()).generation, beforeRetry.generation);
  assert.equal(retry.generation, beforeRetry.generation);
  assert.deepEqual(retry.projection, first.projection);
  assert.deepEqual(retry.displayMessages, []);
});

test("deleteFromMessage commits only the suffix and passes the persistence context to the response", async (t) => {
  const f = await immutableMutationFixture(t, {
    aggregateVersion: 2,
    messages: [message("keep"), message("drop"), message("tail")],
  });
  const before = await f.open();
  t.mock.method(f.runtime.sessionCrudService, "getSessionDisplayData", () => {
    assert.fail("mutation response must not read the full display document");
  });
  const result = await f.service.deleteFromMessage(
    deletion(f, "drop", { expectedAggregateVersion: 2 }),
  );
  assert.equal(result.deletedCount, 2);
  assert.equal(result.anchorIndex, 1);
  assert.deepEqual(result.deletedTurnScopeIds, ["drop", "tail"]);
  assert.equal(result.committedAggregateVersion, 3);
  assert.equal(result.deduplicated, false);
  assert.equal(result.projection.metadata.aggregateVersion, 3);
  assert.equal(result.generation, before.generation + 1);
  assert.equal(Object.hasOwn(result, "detail"), false);
  const after = await f.open();
  assert.equal(after.generation, before.generation + 1);
  assert.deepEqual(
    (await after.exportSession()).messages.map((item) => item.content),
    ["keep"],
  );
  assert.equal((await after.readMetadata()).updatedAt, mutationTime);
  assert.notEqual(await before.readMessage("drop"), null);
  assert.equal(await after.readMessage("drop"), null);
});

test("deleteFromMessage leaves another session's committed graph unchanged", async (t) => {
  const parent = await immutableMutationFixture(t, {
    messages: [message("keep"), message("drop")],
  });
  const child = await immutableMutationFixture(t, { messages: [message("child")] });
  const before = await child.open();
  await parent.service.deleteFromMessage(deletion(parent));
  const after = await child.open();
  assert.equal(after.generation, before.generation);
  assert.deepEqual(await after.exportSession(), await before.exportSession());
});

test("deleteFromMessage replays its command after the anchor is gone and rejects changed requests", async (t) => {
  const f = await immutableMutationFixture(t, {
    aggregateVersion: 2,
    messages: [message("keep"), message("drop")],
  });
  const request = deletion(f, "drop", { expectedAggregateVersion: 2 });
  const first = await f.service.deleteFromMessage(request);
  const before = await f.open();
  const replay = await f.service.deleteFromMessage(request);
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.committedAggregateVersion, first.committedAggregateVersion);
  assert.equal((await f.open()).generation, before.generation);
  await assert.rejects(
    f.service.deleteFromMessage({ ...request, anchor: { turnScopeId: "keep" } }),
    (error) => error.statusCode === 409,
  );
  assert.equal((await f.open()).generation, before.generation);
});

test("deleteFromMessage rejects missing anchors and stale versions without publishing", async (t) => {
  const f = await immutableMutationFixture(t, { aggregateVersion: 5, messages: [message("keep")] });
  const before = await f.open();
  await assert.rejects(
    f.service.deleteFromMessage(deletion(f, "missing")),
    (error) => error.statusCode === 404 && /anchor not found/.test(error.message),
  );
  await assert.rejects(
    f.service.deleteFromMessage(deletion(f, "keep", { expectedAggregateVersion: 4 })),
    (error) => error.statusCode === 409 && error.currentVersion === 5,
  );
  assert.equal((await f.open()).generation, before.generation);
});

test("deleteFromMessage rejects legacy and ambiguous anchors before accessing storage", async (t) => {
  const f = await immutableMutationFixture(t);
  t.mock.method(f.repository, "requireSessionReader", () =>
    assert.fail("invalid request accessed storage"),
  );
  for (const anchor of [
    { dialogProcessId: "legacy" },
    { ts: mutationTime },
    { turnScopeId: "a", messageUid: "b" },
  ])
    await assert.rejects(f.service.deleteFromMessage({ ...deletion(f), anchor }));
});

async function accept(f, scope) {
  await f.commit({
    turnTransition: {
      eventType: "turn.action_accepted",
      phase: "action",
      action: "send",
      sessionId: "s1",
      turnScopeId: scope,
      dialogProcessId: `dialog-${scope}`,
      presentationMessageId: `p:${scope}`,
      executionId: `agent:${scope}`,
      executionKind: "agent",
      rootExecutionId: `agent:${scope}`,
      commandId: `accept:${scope}`,
      causationId: `accept:${scope}`,
    },
  });
}

test("deleteFromMessage atomically removes lifecycle, summary, timing, command and pending outbox references", async (t) => {
  const f = await immutableMutationFixture(t, { messages: [message("keep"), message("drop")] });
  for (const scope of ["keep", "drop"]) {
    await accept(f, scope);
    await f.commit({
      summaryCheckpoints: [
        {
          userId: "u1",
          sessionId: "s1",
          dialogProcessId: `dialog-${scope}`,
          turnScopeId: scope,
          checkpointId: `cp:${scope}`,
          expectedCheckpointRevision: 0,
          messages: [],
          persistedMessageUids: [],
          summarizedMessageUids: [scope],
          retainedMessageUids: [],
        },
      ],
      timings: [{ turnScopeId: scope, dialogProcessId: `dialog-${scope}`, modelLoopRound: 1 }],
    });
    for (const [eventType, phase, extra] of [
      ["turn.processing_started", "processing", {}],
      ["turn.processing_completed", "completion", { completionCommitId: `completed:${scope}` }],
      [
        "turn.completed",
        "completion",
        { commandId: `completed:${scope}`, terminalStatus: { command: "completed" } },
      ],
    ])
      await f.commit({
        turnTransition: {
          eventType,
          phase,
          sessionId: "s1",
          turnScopeId: scope,
          commandId: `${eventType}:${scope}`,
          causationId: `${eventType}:${scope}`,
          ...extra,
        },
      });
  }
  const before = await f.open();
  const events = (await before.readOutboxPage({ consumerId: "client" })).events;
  assert.equal(events.length, 8);
  await f.service.deleteFromMessage(deletion(f));
  const after = await f.open();
  assert.equal(after.generation, before.generation + 1);
  for (const scope of ["keep", "drop"]) {
    const removed = scope === "drop";
    assert.equal((await after.readTurnState(scope)) === null, removed);
    assert.equal((await after.readCheckpoint(scope, `cp:${scope}`)) === null, removed);
    assert.equal((await after.readTurnTiming(scope)) === null, removed);
    assert.equal((await after.readCommand(`accept:${scope}`)) === null, removed);
  }
  assert.equal((await after.readOutboxPage({ consumerId: "client" })).events.length, 4);
  assert.equal((await before.readOutboxPage({ consumerId: "client" })).events.length, 8);
  assert.deepEqual(
    (await after.exportSession()).dialogOrder.map((item) => item.turnScopeId),
    ["keep"],
  );
  assert.equal((await after.readMetadata({ includeAutoTitle: true })).autoTitle, "keep");
});

test("deleteFromMessage recomputes the title when removing all messages", async (t) => {
  const f = await immutableMutationFixture(t, { messages: [message("drop")] });
  await f.service.deleteFromMessage(deletion(f));
  const after = await f.open();
  assert.equal((await after.readFacts()).messageCount, 0);
  assert.equal((await after.readMetadata({ includeAutoTitle: true })).autoTitle, undefined);
  assert.deepEqual((await after.exportSession()).dialogOrder, []);
});

test("deleteFromMessage exposes no partial state on head failure and retries the same command", async (t) => {
  const f = await immutableMutationFixture(t, { messages: [message("keep"), message("drop")] });
  const before = await f.open();
  setFsAdapter({
    rename: async (source, target) => {
      if (target === `${f.scope.sessionDir}/head.json`)
        throw Object.assign(new Error("injected"), { code: "EIO" });
      return rename(source, target);
    },
  });
  try {
    await assert.rejects(f.service.deleteFromMessage(deletion(f)), {
      code: "SESSION_COMMIT_UNCERTAIN",
    });
  } finally {
    resetFsAdapter();
  }
  const failed = await f.open();
  assert.equal(failed.generation, before.generation);
  assert.notEqual(await failed.readMessage("drop"), null);
  assert.equal(await failed.readCommand("delete-tail"), null);
  await f.service.deleteFromMessage(deletion(f));
  assert.equal(await (await f.open()).readMessage("drop"), null);
});
