/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { open, rename } from "node:fs/promises";
import path from "node:path";
import { EXECUTION_LOG_BATCH_MAX_RECORDS } from "@noobot/session-protocol";
import { FileSystemExecutionRepository } from "../../src/session/repositories/file-system-execution-repository.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { TEST_STORAGE_SERVICE } from "../helpers/storage-service.js";
import {
  resolveExecutionTurnDir,
  readExecutionTurnIndex,
} from "../../src/session/session-artifact-execution-logs.js";
import { withTemp } from "./session-artifact-store-v2.test-helpers.js";

function repositoryAt(sessionDir) {
  const state = { locked: false, entries: 0, releases: 0 };
  const repository = new FileSystemExecutionRepository({
    storageService: TEST_STORAGE_SERVICE,
    sessionRepository: {
      async withSessionReader(_userId, _sessionId, run) {
        const empty = async () => ({ entries: [], sequence: 0, pending: false });
        return run({
          reader: { readTurnMessageDiagnosticPage: empty, readMessageDiagnosticPage: empty },
          scope: { sessionDir },
        });
      },
      async requireSessionScope() {
        return { sessionDir };
      },
      async withSessionMutation(_userId, _sessionId, write) {
        assert.equal(state.locked, false);
        state.locked = true;
        state.entries += 1;
        try {
          return await write({ sessionDir, resolvedParentSessionId: "" });
        } finally {
          state.locked = false;
          state.releases += 1;
        }
      },
    },
  });
  return { repository, state };
}

async function seed(repository, count) {
  for (let offset = 0; offset < count; offset += EXECUTION_LOG_BATCH_MAX_RECORDS) {
    await repository.appendLogs(
      "u",
      "s",
      Array.from(
        { length: Math.min(count - offset, EXECUTION_LOG_BATCH_MAX_RECORDS) },
        (_, index) => ({ dialogProcessId: "d1", event: "slice", data: { number: offset + index } }),
      ),
    );
  }
}

test("append and first projection share one lifecycle lock and only backlog reacquires it", async () => {
  await withTemp(async (sessionDir) => {
    const { repository, state } = repositoryAt(sessionDir);
    const first = [{ dialogProcessId: "d1", event: "first", data: { number: 0 } }];
    const delivered = [];
    const deliver = async (entries) => {
      assert.equal(state.locked, true);
      delivered.push(entries.map(({ record }) => record.data.number));
      return entries.map(() => "written");
    };
    await repository.appendLogs("u", "s", first, { deliver });
    assert.equal(state.entries, 1);
    assert.equal(state.releases, 1);
    assert.deepEqual(delivered, [[0]]);
    await seed(repository, 205);
    const baseline = state.entries;
    delivered.length = 0;
    await repository.appendLogs(
      "u",
      "s",
      [{ dialogProcessId: "d1", event: "last", data: { number: 205 } }],
      { deliver },
    );
    assert.equal(state.entries - baseline, 3);
    assert.equal(state.entries, state.releases);
    assert.deepEqual(
      delivered.map((entries) => entries.length),
      [100, 100, 6],
    );
    assert.deepEqual(
      delivered.flat(),
      Array.from({ length: 206 }, (_, n) => n),
    );
  });
});

test("failed first projection preserves accepted source and recovers without a second append", async () => {
  await withTemp(async (sessionDir) => {
    const { repository, state } = repositoryAt(sessionDir);
    const failure = new Error("projection unavailable");
    const sourceIds = [];
    await assert.rejects(
      repository.appendLogs("u", "s", [{ dialogProcessId: "d1", event: "durable" }], {
        deliver: async (entries) => {
          sourceIds.push(...entries.map(({ sourceId }) => sourceId));
          throw failure;
        },
      }),
      (error) => {
        assert.equal(error.commitState, "committed");
        assert.equal(error.cause, failure);
        return true;
      },
    );
    assert.equal(state.entries, 1);
    assert.equal(state.releases, 1);
    const restarted = repositoryAt(sessionDir);
    const recovered = [];
    await restarted.repository.projectPendingLogs("u", "s", {
      dialogProcessIds: ["d1"],
      deliver: async (entries) => {
        recovered.push(...entries.map(({ sourceId }) => sourceId));
        return entries.map(() => "written");
      },
    });
    assert.deepEqual(recovered, sourceIds);
    assert.equal((await repository.getTurnLogs("u", "s", "d1")).length, 1);
  });
});

for (const entryPoint of ["recovery", "append"]) {
  test(`${entryPoint} projection releases the lifecycle lock between bounded batches and reads each source byte once`, async (t) => {
    await withTemp(async (sessionDir) => {
      const { repository, state } = repositoryAt(sessionDir);
      const count = EXECUTION_LOG_BATCH_MAX_RECORDS * 3 + 5;
      await seed(repository, entryPoint === "append" ? count - 1 : count);
      const turnDir = resolveExecutionTurnDir(sessionDir, "d1");
      const index = await readExecutionTurnIndex({ storageService: TEST_STORAGE_SERVICE, turnDir });
      assert.equal(index.segments.length, 1);
      const probe = await open(path.join(turnDir, index.segments[0].file), "r");
      const prototype = Object.getPrototypeOf(probe);
      await probe.close();
      const originalRead = prototype.read;
      const reads = [];
      t.mock.method(prototype, "read", async function (buffer, offset, length, position) {
        const result = await originalRead.call(this, buffer, offset, length, position);
        if (length > 1) reads.push({ position, bytes: result.bytesRead });
        return result;
      });
      const baseline = state.entries;
      const delivered = [];
      const deliver = async (entries) => {
        assert.equal(state.locked, true);
        assert.ok(entries.length <= EXECUTION_LOG_BATCH_MAX_RECORDS);
        assert.equal(state.entries - baseline, delivered.length + 1);
        assert.equal(state.releases, state.entries - 1);
        delivered.push(entries);
        return entries.map(() => "written");
      };
      if (entryPoint === "append") {
        await repository.appendLogs(
          "u",
          "s",
          [{ dialogProcessId: "d1", event: "slice", data: { number: count - 1 } }],
          { deliver },
        );
      } else {
        const result = await repository.projectPendingLogs("u", "s", {
          dialogProcessIds: ["d1"],
          deliver,
        });
        assert.equal(result.records, count);
      }
      assert.deepEqual(
        delivered.map((entries) => entries.length),
        [100, 100, 100, 5],
      );
      assert.equal(state.entries - baseline, 4);
      assert.equal(state.releases, state.entries);
      assert.equal(state.locked, false);
      let readOffset = 0;
      for (const read of reads) {
        assert.equal(read.position, readOffset);
        readOffset += read.bytes;
      }
      const finalIndex = await readExecutionTurnIndex({
        storageService: TEST_STORAGE_SERVICE,
        turnDir,
      });
      assert.equal(readOffset, finalIndex.segments[0].bytes);
      assert.deepEqual(
        delivered.flat().map(({ record }) => record.data.number),
        Array.from({ length: count }, (_, index) => index),
      );
      await repository.projectPendingLogs("u", "s", {
        dialogProcessIds: ["d1"],
        deliver: () => {
          throw new Error("acknowledged source must not be delivered again");
        },
      });
    });
  });
}

test("cursor publication failure replays stable identities without reappending the source", async (t) => {
  await withTemp(async (sessionDir) => {
    const { repository, state } = repositoryAt(sessionDir);
    const count = EXECUTION_LOG_BATCH_MAX_RECORDS + 5;
    await seed(repository, count);
    const failure = new Error("cursor publication failed");
    let publications = 0;
    setFsAdapter({
      async rename(source, destination) {
        if (destination.endsWith("projection-cursor.json") && ++publications === 2) throw failure;
        return rename(source, destination);
      },
    });
    t.after(resetFsAdapter);
    const attempted = [];
    await assert.rejects(
      repository.projectPendingLogs("u", "s", {
        dialogProcessIds: ["d1"],
        deliver: async (entries) => {
          attempted.push(entries.map(({ sourceId }) => sourceId));
          return entries.map(() => "written");
        },
      }),
      (error) => {
        assert.equal(error.cause, failure);
        assert.equal(error.commitState, "committed");
        assert.deepEqual(error.projection.outcomes, Array(5).fill("written"));
        return true;
      },
    );
    assert.equal(state.locked, false);
    resetFsAdapter();
    const restarted = repositoryAt(sessionDir);
    const replayed = [];
    const result = await restarted.repository.projectPendingLogs("u", "s", {
      dialogProcessIds: ["d1"],
      deliver: async (entries) => {
        replayed.push(...entries.map(({ sourceId }) => sourceId));
        return entries.map(() => "written");
      },
    });
    assert.equal(result.records, 5);
    assert.deepEqual(replayed, attempted[1]);
    assert.equal((await repository.getTurnLogs("u", "s", "d1")).length, count);
    assert.equal(restarted.state.locked, false);
  });
});
