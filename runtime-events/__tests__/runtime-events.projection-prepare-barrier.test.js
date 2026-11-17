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
import {
  executionLogProjectionIdentity,
  EXECUTION_PROJECTION_PENDING_SUFFIX,
} from "@noobot/session-protocol";
import {
  publishProjectionOutput,
  recoverProjectionOutput,
} from "../src/transports/projection-output.js";

for (const failed of [false, true]) {
  test(`receipt preparation overlaps data sync without publishing before its ${failed ? "failure" : "completion"}`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "projection-prepare-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const file = path.join(root, "output.jsonl");
    const receipt = path.join(root, "receipt.json");
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const prepared = Promise.withResolvers();
    const failure = new Error("data sync failed");
    const open = fs.open.bind(fs);
    const writeFile = fs.writeFile.bind(fs);
    const rename = fs.rename.bind(fs);
    let published = false;
    const openMock = t.mock.method(fs, "open", async (target, ...flags) => {
      const handle = await open(target, ...flags);
      if (target === file && flags[0] === "a+") {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          entered.resolve();
          await release.promise;
          if (failed) throw failure;
          await sync();
        };
      }
      return handle;
    });
    const writeMock = t.mock.method(fs, "writeFile", async (target, ...args) => {
      const result = await writeFile(target, ...args);
      if (target === `${receipt}.tmp`) prepared.resolve();
      return result;
    });
    const renameMock = t.mock.method(fs, "rename", async (source, target) => {
      if (target === receipt) published = true;
      return rename(source, target);
    });
    const entry = {
      line: '{"n":1}\n',
      options: {
        projection: { file: receipt, sourceId: executionLogProjectionIdentity("d1", 1, 0) },
      },
    };
    const write = publishProjectionOutput(file, [entry], 0).then(
      () => ({ ok: true }),
      (error) => ({ error }),
    );
    await Promise.all([entered.promise, prepared.promise]);
    const prematurelyPublished = published;
    release.resolve();
    const result = await write;
    openMock.mock.restore();
    writeMock.mock.restore();
    renameMock.mock.restore();
    assert.equal(prematurelyPublished, false);
    if (failed) {
      assert.equal(result.error, failure);
      assert.equal(published, false);
      await assert.rejects(fs.stat(receipt), { code: "ENOENT" });
      await recoverProjectionOutput(file);
    } else assert.equal(result.ok, true);
    assert.equal(await fs.readFile(file, "utf8"), entry.line);
    await assert.rejects(fs.stat(`${file}${EXECUTION_PROJECTION_PENDING_SUFFIX}`), {
      code: "ENOENT",
    });
  });
}

test("data preparation failure waits for the receipt preparation before releasing publication", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "projection-prepare-failure-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "output.jsonl");
  const receipt = path.join(root, "receipt.json");
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const failure = new Error("data stat failed");
  const open = fs.open.bind(fs);
  const writeFile = fs.writeFile.bind(fs);
  const openMock = t.mock.method(fs, "open", async (target, ...flags) => {
    const handle = await open(target, ...flags);
    if (target === file)
      handle.stat = async () => {
        throw failure;
      };
    return handle;
  });
  const writeMock = t.mock.method(fs, "writeFile", async (target, ...args) => {
    if (target === `${receipt}.tmp`) {
      entered.resolve();
      await release.promise;
    }
    return writeFile(target, ...args);
  });
  let completed = false;
  const write = publishProjectionOutput(
    file,
    [
      {
        line: '{"n":1}\n',
        options: {
          projection: {
            file: receipt,
            sourceId: executionLogProjectionIdentity("d1", 1, 0),
          },
        },
      },
    ],
    0,
  ).catch((error) => {
    completed = true;
    return error;
  });
  await entered.promise;
  await new Promise((resolve) => setImmediate(resolve));
  const prematurelyCompleted = completed;
  release.resolve();
  assert.equal(await write, failure);
  openMock.mock.restore();
  writeMock.mock.restore();
  assert.equal(prematurelyCompleted, false);
  await assert.rejects(fs.stat(receipt), { code: "ENOENT" });
  await recoverProjectionOutput(file);
  assert.equal(await fs.readFile(file, "utf8"), '{"n":1}\n');
});
