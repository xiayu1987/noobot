/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSessionExecutionIndex } from "@noobot/session-protocol";
import {
  appendRollingJsonlArtifactLogs,
  readExecutionLogs,
  readRegisteredExecutionTurns,
  resolveExecutionEventsDir,
  resolveExecutionTurnDir,
} from "../../src/session/session-artifact-execution-logs.js";
import {
  inspectSessionArtifacts,
  repairSessionArtifacts,
} from "../../src/session/session-artifact-maintenance.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { TEST_STORAGE_SERVICE } from "../helpers/storage-service.js";
import { readTurnIndex, withTemp } from "./session-artifact-store-v2.test-helpers.js";

const dialogProcessId = "registration-turn";
const record = (sequence) => ({ dialogProcessId, sequence });
const append = (sessionDir, logs, storageService = TEST_STORAGE_SERVICE) =>
  appendRollingJsonlArtifactLogs({
    sessionDir,
    logs,
    storageService,
    maxSegmentBytes: 4096,
    alreadyLocked: false,
  });

for (const committedBeforeFailure of [false, true]) {
  test(`registration failure (published=${committedBeforeFailure}) leaves no accepted records and resumes from disk`, async () => {
    await withTemp(async (sessionDir) => {
      const failure = new Error("session registration interrupted");
      const registrationFile = path.join(resolveExecutionEventsDir(sessionDir), "index.json");
      const failingStorage = Object.assign(Object.create(TEST_STORAGE_SERVICE), {
        async writeJsonAtomic(file, value) {
          if (file === registrationFile) {
            if (committedBeforeFailure) await TEST_STORAGE_SERVICE.writeJsonAtomic(file, value);
            throw failure;
          }
          return TEST_STORAGE_SERVICE.writeJsonAtomic(file, value);
        },
      });
      await assert.rejects(
        append(sessionDir, [record(1)], failingStorage),
        (error) => error === failure,
      );
      assert.deepEqual((await readTurnIndex(sessionDir, dialogProcessId)).segments, []);
      assert.deepEqual(
        await readExecutionLogs({ storageService: TEST_STORAGE_SERVICE, sessionDir }),
        [],
      );

      await append(sessionDir, [record(2)]);
      assert.deepEqual(
        await readExecutionLogs({ storageService: TEST_STORAGE_SERVICE, sessionDir }),
        [record(2)],
      );
      assert.equal(
        (await readRegisteredExecutionTurns({ storageService: TEST_STORAGE_SERVICE, sessionDir }))
          .length,
        1,
      );
    });
  });
}

test("registration sees an already published empty turn index before the first record", async () => {
  await withTemp(async (sessionDir) => {
    const registrationFile = path.join(resolveExecutionEventsDir(sessionDir), "index.json");
    const storage = Object.assign(Object.create(TEST_STORAGE_SERVICE), {
      async writeJsonAtomic(file, value) {
        if (file === registrationFile) {
          assert.deepEqual((await readTurnIndex(sessionDir, dialogProcessId)).segments, []);
        }
        return TEST_STORAGE_SERVICE.writeJsonAtomic(file, value);
      },
    });
    await append(sessionDir, [record(1)], storage);
    const before = await readFile(registrationFile);
    await append(sessionDir, [record(2)], storage);
    assert.deepEqual(await readFile(registrationFile), before);
    assert.deepEqual(await readExecutionLogs({ storageService: storage, sessionDir }), [
      record(1),
      record(2),
    ]);
  });
});

async function orphanedTurn(sessionDir) {
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "orphan-audit",
    allowCreate: true,
  });
  await store.commit({ expectedGeneration: 0, operationId: "initial", changes: [] });
  await append(sessionDir, [record(1)]);
  const registrationFile = path.join(resolveExecutionEventsDir(sessionDir), "index.json");
  await TEST_STORAGE_SERVICE.writeJsonAtomic(registrationFile, createSessionExecutionIndex([]));
  return registrationFile;
}

test("offline audit detects unregistered indexed logs and explicit repair restores discovery idempotently", async () => {
  await withTemp(async (sessionDir) => {
    await orphanedTurn(sessionDir);
    const storageService = TEST_STORAGE_SERVICE;
    const before = await inspectSessionArtifacts({ storageService, sessionDir });
    assert.equal(before.storage.ok, true);
    assert.equal(before.ok, false);
    assert.equal(before.issues[0].code, "EXECUTION_TURN_UNREGISTERED");
    assert.deepEqual(await readExecutionLogs({ storageService, sessionDir }), []);
    const options = {
      storageService,
      sessionDir,
      alreadyLocked: false,
      assertSessionWritable: async () => {},
    };
    const repaired = await repairSessionArtifacts(options);
    assert.equal(repaired.after.ok, true);
    assert.deepEqual(await readExecutionLogs({ storageService, sessionDir }), [record(1)]);
    assert.deepEqual((await repairSessionArtifacts(options)).repaired, []);
  });
});

test("offline repair refuses to register damaged orphan logs and preserves registration evidence", async () => {
  await withTemp(async (sessionDir) => {
    const registrationFile = await orphanedTurn(sessionDir);
    const before = await readFile(registrationFile);
    await writeFile(
      path.join(resolveExecutionTurnDir(sessionDir, dialogProcessId), "segment-000001.jsonl"),
      "[]\n",
    );
    await assert.rejects(
      repairSessionArtifacts({
        storageService: TEST_STORAGE_SERVICE,
        sessionDir,
        alreadyLocked: false,
        assertSessionWritable: async () => {},
      }),
      { code: "EXECUTION_EVENT_JSONL_CORRUPTED" },
    );
    assert.deepEqual(await readFile(registrationFile), before);
  });
});

for (const operation of [inspectSessionArtifacts, repairSessionArtifacts]) {
  test(`${operation.name} propagates cancellation during orphan discovery without publishing registration`, async () => {
    await withTemp(async (sessionDir) => {
      const registrationFile = await orphanedTurn(sessionDir);
      const before = await readFile(registrationFile);
      const controller = new AbortController();
      const reason = new Error("cancel orphan discovery");
      const turnIndex = path.join(
        resolveExecutionTurnDir(sessionDir, dialogProcessId),
        "index.json",
      );
      const storageService = Object.assign(Object.create(TEST_STORAGE_SERVICE), {
        async readOptionalJson(file) {
          const value = await TEST_STORAGE_SERVICE.readOptionalJson(file);
          if (file === turnIndex) controller.abort(reason);
          return value;
        },
      });
      await assert.rejects(
        operation({
          storageService,
          sessionDir,
          signal: controller.signal,
          alreadyLocked: false,
          assertSessionWritable: async () => {},
        }),
        (error) => error === reason,
      );
      assert.deepEqual(await readFile(registrationFile), before);
    });
  });
}

for (const published of [false, true]) {
  test(`explicit registration repair resumes from disk after publication failure (published=${published})`, async () => {
    await withTemp(async (sessionDir) => {
      const registrationFile = await orphanedTurn(sessionDir);
      const segmentFile = path.join(
        resolveExecutionTurnDir(sessionDir, dialogProcessId),
        "segment-000001.jsonl",
      );
      const before = await readFile(segmentFile);
      const failure = new Error("repair registration interrupted");
      const storageService = Object.assign(Object.create(TEST_STORAGE_SERVICE), {
        async writeJsonAtomic(file, value) {
          if (file === registrationFile) {
            if (published) await TEST_STORAGE_SERVICE.writeJsonAtomic(file, value);
            throw failure;
          }
          return TEST_STORAGE_SERVICE.writeJsonAtomic(file, value);
        },
      });
      const options = { sessionDir, alreadyLocked: false, assertSessionWritable: async () => {} };
      await assert.rejects(
        repairSessionArtifacts({ ...options, storageService }),
        (error) => error === failure,
      );
      const repaired = await repairSessionArtifacts({
        ...options,
        storageService: TEST_STORAGE_SERVICE,
      });
      assert.equal(repaired.after.ok, true);
      assert.deepEqual(await readFile(segmentFile), before);
      assert.deepEqual(
        await readExecutionLogs({ storageService: TEST_STORAGE_SERVICE, sessionDir }),
        [record(1)],
      );
      assert.deepEqual(
        (await repairSessionArtifacts({ ...options, storageService: TEST_STORAGE_SERVICE }))
          .repaired,
        [],
      );
    });
  });
}

test("repair validates every orphan before registering any discovered turn", async () => {
  await withTemp(async (sessionDir) => {
    const registrationFile = await orphanedTurn(sessionDir);
    const otherId = "other-registration-turn";
    await append(sessionDir, [{ dialogProcessId: otherId, sequence: 2 }]);
    await TEST_STORAGE_SERVICE.writeJsonAtomic(registrationFile, createSessionExecutionIndex([]));
    const before = await readFile(registrationFile);
    await writeFile(
      path.join(resolveExecutionTurnDir(sessionDir, otherId), "segment-000001.jsonl"),
      "[]\n",
    );
    await assert.rejects(
      repairSessionArtifacts({
        storageService: TEST_STORAGE_SERVICE,
        sessionDir,
        alreadyLocked: false,
        assertSessionWritable: async () => {},
      }),
      { code: "EXECUTION_EVENT_JSONL_CORRUPTED" },
    );
    assert.deepEqual(await readFile(registrationFile), before);
  });
});

for (const existing of [false, true]) {
  test(`offline recovery discovers segments after final turn index publication failed (existing=${existing})`, async () => {
    await withTemp(async (sessionDir) => {
      const store = new ImmutableSessionStore({
        sessionDir,
        sessionId: "index-failure",
        allowCreate: true,
      });
      await store.commit({ expectedGeneration: 0, operationId: "initial", changes: [] });
      if (existing) await append(sessionDir, [record(0)]);
      const turnIndexFile = path.join(
        resolveExecutionTurnDir(sessionDir, dialogProcessId),
        "index.json",
      );
      const failure = new Error("final turn index publication failed");
      const storageService = Object.assign(Object.create(TEST_STORAGE_SERVICE), {
        async writeJsonAtomic(file, value) {
          if (file === turnIndexFile && value.segments.length) throw failure;
          return TEST_STORAGE_SERVICE.writeJsonAtomic(file, value);
        },
      });
      const logs = [record(1), record(2), record(3)];
      await assert.rejects(
        appendRollingJsonlArtifactLogs({
          storageService,
          sessionDir,
          logs,
          maxSegmentBytes: 1,
          alreadyLocked: false,
        }),
        (error) => {
          assert.equal(error.code, "EXECUTION_LOG_APPEND_FAILED");
          assert.equal(error.commitState, "committed");
          assert.equal(error.cause, failure);
          assert.deepEqual(error.append.records, logs);
          assert.deepEqual(
            error.append.outcomes,
            logs.map(() => "written"),
          );
          return true;
        },
      );
      const options = {
        storageService: TEST_STORAGE_SERVICE,
        sessionDir,
        alreadyLocked: false,
        assertSessionWritable: async () => {},
      };
      const before = await inspectSessionArtifacts(options);
      assert.equal(before.ok, false);
      assert.ok(before.issues.some(({ code }) => code === "EXECUTION_SEGMENT_UNINDEXED"));
      const firstUnindexed = path.join(
        resolveExecutionTurnDir(sessionDir, dialogProcessId),
        existing ? "segment-000002.jsonl" : "segment-000001.jsonl",
      );
      const originalBytes = await readFile(firstUnindexed);
      await assert.rejects(
        appendRollingJsonlArtifactLogs({
          storageService: TEST_STORAGE_SERVICE,
          sessionDir,
          logs: [record(4)],
          maxSegmentBytes: 1,
          alreadyLocked: false,
        }),
        { code: "EXECUTION_SEGMENT_UNINDEXED" },
      );
      assert.deepEqual(await readFile(firstUnindexed), originalBytes);
      assert.equal((await repairSessionArtifacts(options)).after.ok, true);
      assert.deepEqual(await readExecutionLogs(options), existing ? [record(0), ...logs] : logs);
      assert.deepEqual((await repairSessionArtifacts(options)).repaired, []);
    });
  });
}

test("damaged unindexed segment prevents repair without rewriting its turn index", async () => {
  await withTemp(async (sessionDir) => {
    await orphanedTurn(sessionDir);
    const turnDir = resolveExecutionTurnDir(sessionDir, dialogProcessId);
    const indexFile = path.join(turnDir, "index.json");
    const before = await readFile(indexFile);
    await writeFile(path.join(turnDir, "segment-000002.jsonl"), "[]\n");
    await assert.rejects(
      repairSessionArtifacts({
        storageService: TEST_STORAGE_SERVICE,
        sessionDir,
        alreadyLocked: false,
        assertSessionWritable: async () => {},
      }),
      { code: "EXECUTION_EVENT_JSONL_CORRUPTED" },
    );
    assert.deepEqual(await readFile(indexFile), before);
  });
});
