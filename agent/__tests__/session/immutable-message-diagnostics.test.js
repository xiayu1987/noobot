/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rename, rm } from "node:fs/promises";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { commitSessionChanges } from "../../src/session/session-artifact-session/commit-session-changes.js";
import { withImmutableSessionReader } from "../../src/session/session-artifact-session/immutable-session-reader.js";
import { FileSystemExecutionRepository } from "../../src/session/repositories/file-system-execution-repository.js";
import { ExecutionLogRepository } from "../../src/observability/execution-log/execution-log-repository.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { TEST_STORAGE_SERVICE } from "../helpers/storage-service.js";
import { canonicalMessages, withTemp } from "./session-artifact-store-v2.test-helpers.js";
import {
  persistChildSessionFixture,
  useRuntimeEventsUserWorkspace,
} from "../helpers/runtime-events-env.js";

const ts = "2026-11-16T00:00:00.000Z";
function changes(count, dialogProcessId = "d1", start = 0) {
  const messages = canonicalMessages(
    Array.from({ length: count }, (_, index) => ({
      messageUid: `message-${start + index}`,
      role: "assistant",
      content: `body-${index}`,
      dialogProcessId,
      turnScopeId: `turn-${dialogProcessId}`,
      ts,
    })),
    "s1",
  );
  return {
    messages,
    messageDiagnostics: messages.map((message) => ({
      messageUid: message.messageUid,
      record: {
        userId: "u1",
        sessionId: "s1",
        dialogProcessId,
        turnScopeId: message.turnScopeId,
        event: "session_turn_full",
        category: "diagnostic",
        type: "session_turn",
        ts,
        data: { artifactRef: { source: "session.messages", messageUid: message.messageUid } },
      },
    })),
  };
}
async function initialize(sessionDir, parentSessionId = "") {
  await initializeImmutableSession({
    sessionDir,
    operationId: "initialize",
    session: {
      sessionId: "s1",
      parentSessionId,
      aggregateVersion: 0,
      messages: [],
      caller: SESSION_CALLER.USER,
      dialogOrder: [],
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      createdAt: ts,
      updatedAt: ts,
    },
  });
}
async function commit(sessionDir, delta, operationId, expectedGeneration) {
  const store = await ImmutableSessionStore.open({ sessionDir, sessionId: "s1" });
  return commitSessionChanges({
    sessionDir,
    sessionId: "s1",
    expectedGeneration: expectedGeneration ?? (await store.snapshot()).generation,
    operationId,
    committedAt: ts,
    changes: delta,
  });
}
function repositories(sessionDir, parentSessionId = "") {
  const sessionRepository = {
    withSessionReader: (_userId, _sessionId, run) =>
      withImmutableSessionReader({ sessionDir, sessionId: "s1", parentSessionId }, (reader) =>
        run(reader, { sessionDir, resolvedParentSessionId: parentSessionId }),
      ),
    withSessionMutation: (_userId, _sessionId, run) =>
      run({ sessionDir, resolvedParentSessionId: parentSessionId }),
  };
  const executionRepository = new FileSystemExecutionRepository({
    storageService: TEST_STORAGE_SERVICE,
    sessionRepository,
  });
  return { executionRepository, repository: new ExecutionLogRepository({ executionRepository }) };
}

test("messages and diagnostics publish atomically, replay once and query only the selected turn", async () => {
  await withTemp(async (sessionDir) => {
    await initialize(sessionDir);
    const delta = changes(3);
    const initial = await ImmutableSessionStore.open({ sessionDir, sessionId: "s1" });
    const generation = (await initial.snapshot()).generation;
    const result = await commit(sessionDir, delta, "first", generation);
    await commit(sessionDir, changes(2, "d2", 3), "second");
    const replay = await commit(sessionDir, delta, "first", generation);
    assert.deepEqual(replay.result, result.result);
    const { executionRepository } = repositories(sessionDir);
    assert.equal((await executionRepository.getTurnLogs("u1", "s1", "d1")).length, 3);
    assert.equal((await executionRepository.getTurnLogs("u1", "s1", "d2")).length, 2);
    await executionRepository.appendLogs("u1", "s1", [
      { dialogProcessId: "d1", event: "tool_call_start", data: { toolCallId: "t1" } },
      { dialogProcessId: "d2", event: "other_turn" },
      { dialogProcessId: "d1", event: "tool_call_end", data: { toolCallId: "t1" } },
    ]);
    const mixed = await executionRepository.getTurnLogs("u1", "s1", "d1");
    assert.deepEqual(
      mixed.map(({ event }) => event),
      [
        "tool_call_start",
        "tool_call_end",
        "session_turn_full",
        "session_turn_full",
        "session_turn_full",
      ],
    );
    assert.deepEqual(
      mixed.slice(2).map(({ data }) => data.artifactRef.messageUid),
      ["message-0", "message-1", "message-2"],
    );
    await assert.rejects(
      commit(
        sessionDir,
        { ...changes(1, "d3", 5), messageDiagnostics: delta.messageDiagnostics },
        "bad",
      ),
    );
    const store = await ImmutableSessionStore.open({ sessionDir, sessionId: "s1" });
    assert.equal(await store.get(await store.snapshot(), "messages", "message-5"), null);
  });
});

test("diagnostic projection failure preserves source and restart drains bounded batches in order", async () => {
  await withTemp(async (sessionDir) => {
    await initialize(sessionDir);
    await commit(sessionDir, changes(205), "batch");
    const failure = new Error("output unavailable");
    const { executionRepository } = repositories(sessionDir);
    await assert.rejects(
      executionRepository.projectMessageDiagnostics("u1", "s1", {
        deliver: async () => {
          throw failure;
        },
      }),
      (error) => error.code === "EXECUTION_LOG_PROJECTION_FAILED" && error.cause === failure,
    );
    const seen = [];
    const restarted = repositories(sessionDir).executionRepository;
    assert.equal(
      (
        await restarted.projectMessageDiagnostics("u1", "s1", {
          deliver: async (entries) => {
            seen.push(entries);
            return entries.map(() => "written");
          },
        })
      ).records,
      205,
    );
    assert.deepEqual(
      seen.map((page) => page.length),
      [100, 100, 5],
    );
    assert.deepEqual(
      seen.flat().map(({ record }) => record.data.artifactRef.messageUid),
      Array.from({ length: 205 }, (_, index) => `message-${index}`),
    );
    assert.equal(
      (
        await restarted.projectMessageDiagnostics("u1", "s1", {
          deliver: async () => assert.fail("committed cursor must suppress repeat delivery"),
        })
      ).records,
      0,
    );
  });
});

test("real output receipt deduplicates diagnostics after source cursor publication fails", async (t) => {
  const workspaceRoot = await useRuntimeEventsUserWorkspace(t, "u1");
  const eventsDir = await persistChildSessionFixture(workspaceRoot);
  const sessionDir = path.dirname(eventsDir);
  await rm(path.join(sessionDir, "head.json"));
  await initialize(sessionDir, "p1");
  const delta = changes(2);
  for (const message of delta.messages) message.parentSessionId = "p1";
  await commit(sessionDir, delta, "source");
  const failure = new Error("cursor unavailable");
  setFsAdapter({
    async rename(source, destination) {
      if (destination === path.join(sessionDir, "message-diagnostics", "cursor.json"))
        throw failure;
      return rename(source, destination);
    },
  });
  t.after(resetFsAdapter);
  await assert.rejects(
    repositories(sessionDir, "p1").repository.projectMessageDiagnostics("u1", "s1"),
    (error) => error.code === "EXECUTION_LOG_PROJECTION_FAILED" && error.cause === failure,
  );
  resetFsAdapter();
  const cursorFile = path.join(sessionDir, "message-diagnostics", "cursor.json");
  const outputFile = path.join(eventsDir, "system.jsonl");
  const readOutput = async () =>
    (await readFile(outputFile, "utf8")).trim().split("\n").map(JSON.parse);
  const delivered = await readOutput();
  assert.equal(delivered.length, 2);
  assert.deepEqual(
    delivered.map(({ data }) => data.artifactRef.messageUid),
    ["message-0", "message-1"],
  );
  await assert.rejects(readFile(cursorFile), { code: "ENOENT" });
  const restarted = repositories(sessionDir, "p1");
  assert.equal((await restarted.repository.recoverSessionLogProjection("u1", "s1")).records, 2);
  assert.deepEqual(await readOutput(), delivered);
  assert.equal((await restarted.repository.recoverSessionLogProjection("u1", "s1")).records, 0);
  assert.deepEqual(await readOutput(), delivered);
  assert.equal(JSON.parse(await readFile(cursorFile, "utf8")).sequence, 2);
  assert.equal((await restarted.executionRepository.getTurnLogs("u1", "s1", "d1")).length, 2);
});
