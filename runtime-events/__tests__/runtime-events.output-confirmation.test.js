/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMutationCoordinator } from "@noobot/shared/file-mutation-coordinator";
import {
  executionLogProjectionIdentity,
  EXECUTION_PROJECTION_PENDING_SUFFIX,
  encodeExecutionProjectionOutputRecord,
} from "@noobot/session-protocol";
import { appendJsonLine, flushJsonLineBatches } from "../src/transports/jsonl.js";
import {
  recoverProjectionOutput,
  syncOutputDirectory,
} from "../src/transports/projection-output.js";

for (const mode of ["ordinary", "projection", "replay"]) {
  test(`${mode} confirmation waits for lock cleanup and reports its failure`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "output-confirmation-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const file = path.join(root, "interaction.jsonl");
    const options =
      mode === "ordinary"
        ? {}
        : {
            projection: {
              file: path.join(root, "receipt.json"),
              sourceId: executionLogProjectionIdentity("d1", 1, 0),
            },
          };
    if (mode === "replay") await appendJsonLine(file, { n: 1 }, options);
    const failure = new Error("output lock close failed");
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const runHolding = FileMutationCoordinator.prototype.runHolding;
    const mock = t.mock.method(
      FileMutationCoordinator.prototype,
      "runHolding",
      function (lock, operation) {
        if (lock.key === `${file}.mutation.lock`) {
          const close = lock.handle.close.bind(lock.handle);
          lock.handle.close = async () => {
            await close();
            entered.resolve();
            await release.promise;
            throw failure;
          };
        }
        return runHolding.call(this, lock, operation);
      },
    );
    let confirmed = false;
    const write = appendJsonLine(file, { n: 1 }, options).then(
      (result) => {
        confirmed = true;
        return { result };
      },
      (error) => ({ error }),
    );
    await entered.promise;
    const flushed = flushJsonLineBatches().then(
      () => ({}),
      (error) => ({ error }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    const confirmedBeforeCleanup = confirmed;
    release.resolve();
    const outcome = await write;
    const barrier = await flushed;
    mock.mock.restore();
    assert.equal(confirmedBeforeCleanup, false);
    assert.equal(outcome.error, failure);
    assert.ok(barrier.error instanceof AggregateError);
    assert.deepEqual(barrier.error.errors, [failure]);
    await assert.rejects(fs.stat(`${file}.mutation.lock`), { code: "ENOENT" });
    if (mode !== "ordinary") await appendJsonLine(file, { n: 1 }, options);
    await appendJsonLine(file, { n: 2 });
    assert.deepEqual((await fs.readFile(file, "utf8")).trim().split("\n").map(JSON.parse), [
      { n: 1 },
      { n: 2 },
    ]);
  });
}

for (const stage of ["directory", "read", "data"]) {
  for (const fault of ["operation", "close", "both"]) {
    test(`${stage} preserves ${fault} failures`, async (t) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "projection-close-"));
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      const file = path.join(root, "interaction.jsonl");
      const pending = `${file}${EXECUTION_PROJECTION_PENDING_SUFFIX}`;
      if (stage === "read") await fs.writeFile(pending, encodeExecutionProjectionOutputRecord({}));
      const failure = new Error("output operation failed");
      const closeFailure = new Error("output close failed");
      const open = fs.open.bind(fs);
      const mock = t.mock.method(fs, "open", async (target, ...options) => {
        const handle = await open(target, ...options);
        const selected =
          stage === "directory"
            ? target === root
            : stage === "read"
              ? target === pending
              : target === file && options[0] === "a+";
        if (!selected) return handle;
        if (fault !== "close")
          handle[stage === "read" ? "readFile" : "sync"] = async () => {
            throw failure;
          };
        const close = handle.close.bind(handle);
        handle.close = async () => {
          await close();
          if (fault !== "operation") throw closeFailure;
        };
        return handle;
      });
      const options = {
        projection: {
          file: path.join(root, "receipt.json"),
          sourceId: executionLogProjectionIdentity("d1", 1, 0),
        },
      };
      const operation =
        stage === "directory"
          ? syncOutputDirectory(root)
          : stage === "read"
            ? recoverProjectionOutput(file)
            : appendJsonLine(file, { n: 1 }, options);
      await assert.rejects(operation, (error) => {
        if (fault !== "both") return error === (fault === "close" ? closeFailure : failure);
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [failure, closeFailure]);
        assert.equal(error.cause, failure);
        return true;
      });
      mock.mock.restore();
      if (stage === "data") {
        await appendJsonLine(file, { n: 1 }, options);
        assert.deepEqual((await fs.readFile(file, "utf8")).trim().split("\n").map(JSON.parse), [
          { n: 1 },
        ]);
      }
    });
  }
}

for (const stage of ["stat", "readFile", "close"]) {
  test(`optional projection read propagates ENOENT from ${stage} after opening`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "projection-optional-boundary-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const file = path.join(root, "interaction.jsonl");
    const failure = Object.assign(new Error(`${stage} failed after opening`), { code: "ENOENT" });
    let closed = 0;
    const bytes = encodeExecutionProjectionOutputRecord({});
    t.mock.method(fs, "open", async () => ({
      stat: async () => {
        if (stage === "stat") throw failure;
        return { size: Buffer.byteLength(bytes) };
      },
      readFile: async () => {
        if (stage === "readFile") throw failure;
        return Buffer.from(bytes);
      },
      close: async () => {
        closed += 1;
        if (stage === "close") throw failure;
      },
    }));
    await assert.rejects(recoverProjectionOutput(file), (error) => error === failure);
    assert.equal(closed, 1);
  });
}
