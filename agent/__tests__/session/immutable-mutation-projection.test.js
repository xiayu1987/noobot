/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { requireSessionMutationProjection, SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { immutableLifecycleCommandKey } from "../../src/session/session-artifact-session/immutable-command-index.js";
import { readImmutableMutationProjection } from "../../src/session/session-artifact-session/immutable-mutation-projection.js";
import { immutableOrderKey } from "../../src/session/session-artifact-session/immutable-order-key.js";
import {
  immutableMutationFixture,
  mutationMessage as message,
} from "../helpers/immutable-mutation-integration-fixture.js";

test("mutation projection rejects a checksummed commit whose receipt and effect disagree", async (t) => {
  const f = await immutableMutationFixture(t, { messages: [message("keep"), message("drop")] });
  const result = await f.service.deleteFromMessage({
    ...f.request,
    commandId: "delete",
    anchor: { turnScopeId: "drop" },
  });
  const reader = await f.open();
  const valid = await reader.readMutationProjection(result.commandId);
  const store = new ImmutableSessionStore({ sessionDir: f.scope.sessionDir, sessionId: "s1" });
  const key = immutableLifecycleCommandKey("delete");
  const command = { collection: "commands", key, value: valid.receipt };
  const metadata = { collection: "metadata", key: "session", value: valid.metadata };
  const lifecycle = { collection: "metadata", key: "lifecycle", value: valid.lifecycleHead };
  const removed = { collection: "messages", key: "drop", remove: true };
  for (const [index, changes] of [
    [command],
    [command, metadata],
    [command, metadata, lifecycle],
    [command, metadata, lifecycle, removed, { ...removed, key: "invented" }],
    [
      command,
      { ...metadata, value: { ...valid.metadata, sessionId: "another" } },
      lifecycle,
      removed,
    ],
    [
      command,
      { ...metadata, value: { ...valid.metadata, aggregateVersion: 2 } },
      lifecycle,
      removed,
    ],
  ].entries()) {
    await store.commit({
      expectedGeneration: (await store.snapshot()).generation,
      operationId: `invalid-effect:${index}`,
      changes,
    });
    const snapshot = await store.snapshot();
    await assert.rejects(
      readImmutableMutationProjection({ store, snapshot, commandId: "delete" }),
      { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
    );
    assert.deepEqual(await reader.readMutationProjection("delete"), valid);
  }
});

test("mutation replay rejects a message order that truncates a different position", async (t) => {
  const f = await immutableMutationFixture(t, { messages: [message("keep"), message("drop")] });
  await f.service.deleteFromMessage({
    ...f.request,
    commandId: "delete",
    anchor: { turnScopeId: "drop" },
  });
  await using reader = await f.open();
  const original = await reader.readMutationProjection("delete");
  const { changes } = await reader.readCommandChanges("delete");
  const store = new ImmutableSessionStore({ sessionDir: f.scope.sessionDir, sessionId: "s1" });
  await store.commit({
    expectedGeneration: reader.generation,
    operationId: "invalid-suffix-order",
    changes: [
      ...changes.map((change) =>
        change.collection === "messageOrder" ? { ...change, key: immutableOrderKey(1) } : change,
      ),
      {
        collection: "commands",
        key: immutableLifecycleCommandKey("delete"),
        value: original.receipt,
      },
    ],
  });
  await using reopened = await f.open();
  await assert.rejects(reopened.readMutationProjection("delete"), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    message: "Mutation commit has an incomplete published message suffix",
  });
  assert.deepEqual(original.messageSuffix, { firstOrdinal: 2, previousMessageCount: 2 });
  assert.deepEqual(await reader.readMutationProjection("delete"), original);
});

test("replacement projections validate receipt identity for both commits and imported baselines", async (t) => {
  const f = await immutableMutationFixture(t, { messages: [message("keep"), message("drop")] });
  const result = await f.service.replaceTurn({
    ...f.request,
    commandId: "replace",
    anchor: { turnScopeId: "drop" },
    newContent: "replacement",
    turnScopeId: "new-turn",
    attachments: [],
  });
  const projection = await (await f.open()).readMutationProjection(result.commandId);
  const baseline = { kind: "baseline", generation: 1, receipt: projection.receipt };
  for (const source of [projection, baseline]) {
    assert.equal(requireSessionMutationProjection(source, { sessionId: "s1" }), source);
    for (const [key, value] of Object.entries({
      sessionId: "another-session",
      commandId: "another-command",
      committedAggregateVersion: projection.receipt.aggregateVersion + 1,
      requestHash: "another-hash",
      committedAt: "2026-06-18T00:00:00.000Z",
    })) {
      const invalid = structuredClone(source);
      invalid.receipt.result.turnReplacement[key] = value;
      assert.throws(
        () => requireSessionMutationProjection(invalid, { sessionId: "s1" }),
        { code: SESSION_ERROR_CODE.SESSION_MUTATION_PROJECTION_INVALID },
        `${source.kind}:${key}`,
      );
    }
  }
  assert.throws(
    () => requireSessionMutationProjection({ ...baseline, messages: [] }, { sessionId: "s1" }),
    { code: SESSION_ERROR_CODE.SESSION_MUTATION_PROJECTION_INVALID },
  );
});

test("mutation timing validation compares canonical fields independently of JSON key order", async (t) => {
  const f = await immutableMutationFixture(t, { messages: [message("keep"), message("drop")] });
  const result = await f.service.deleteFromMessage({
    ...f.request,
    commandId: "delete",
    anchor: { turnScopeId: "drop" },
  });
  const projection = await (await f.open()).readMutationProjection(result.commandId);
  const value = {
    modelLoopRound: 2,
    thinkingFinishedAt: "2026-06-17T00:00:00.000Z",
    dialogProcessId: "dialog-keep",
    turnScopeId: "keep",
  };
  const withTiming = { ...projection, timings: [{ key: "keep", value }] };
  assert.equal(requireSessionMutationProjection(withTiming, { sessionId: "s1" }), withTiming);
  for (const changed of [
    { ...value, thinkingFinishedAt: " 2026-06-17T00:00:00.000Z " },
    { ...value, modelLoopRound: 0 },
    { ...value, modelLoopRound: "2" },
    { ...value, unknown: true },
    { ...value, turnScopeId: "different" },
  ]) {
    assert.throws(
      () =>
        requireSessionMutationProjection(
          { ...projection, timings: [{ key: "keep", value: changed }] },
          { sessionId: "s1" },
        ),
      { code: SESSION_ERROR_CODE.SESSION_MUTATION_PROJECTION_INVALID },
    );
  }
});
