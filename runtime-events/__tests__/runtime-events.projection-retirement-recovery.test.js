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
  EXECUTION_PROJECTION_PENDING_SUFFIX,
  executionLogProjectionIdentity,
  decodeExecutionProjectionOutputRecord,
} from "@noobot/session-protocol";
import { appendJsonLine } from "../src/transports/jsonl.js";

for (const continuation of ["append", "rotate", "advance-receipt"]) {
  test(`retired intent recovery preserves confirmed output after ${continuation}`, async (context) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "projection-retirement-"));
    context.after(() => fs.rm(root, { recursive: true, force: true }));
    const file = path.join(root, "interaction.jsonl");
    const pending = `${file}${EXECUTION_PROJECTION_PENDING_SUFFIX}`;
    const receipt = path.join(root, "receipt.json");
    const options = (offset) => ({
      projection: { file: receipt, sourceId: executionLogProjectionIdentity("d1", 1, offset) },
    });
    const failure = new Error("retirement interrupted after unlink");
    const unlink = fs.unlink.bind(fs);
    const open = fs.open.bind(fs);
    let retired = null;
    const unlinkMock = context.mock.method(fs, "unlink", async (target) => {
      if (target !== pending) return unlink(target);
      retired = await fs.readFile(pending);
      await unlink(target);
      throw failure;
    });
    await assert.rejects(
      appendJsonLine(file, { first: true }, options(0)),
      (error) => error === failure,
    );
    unlinkMock.mock.restore();
    assert.ok(retired !== null);
    if (continuation === "advance-receipt")
      await appendJsonLine(file, { second: true }, options(10));
    else
      await appendJsonLine(
        file,
        { second: true },
        continuation === "rotate" ? { maxFileBytes: 1 } : {},
      );
    const confirmedReceipt = await fs.readFile(receipt);

    await fs.writeFile(pending, retired);
    const before = new Map();
    for (const name of await fs.readdir(root))
      if (name.endsWith(".jsonl")) before.set(name, await fs.readFile(path.join(root, name)));
    let outputOpens = 0;
    const readMock = context.mock.method(fs, "open", async (target, ...flags) => {
      if (target === file) outputOpens += 1;
      return open(target, ...flags);
    });
    const result = await appendJsonLine(file, { replay: true }, options(0));
    readMock.mock.restore();
    assert.equal(result.duplicate, true);
    assert.equal(outputOpens, 0);
    assert.deepEqual(await fs.readFile(receipt), confirmedReceipt);
    for (const [name, bytes] of before)
      assert.deepEqual(await fs.readFile(path.join(root, name)), bytes);
    await assert.rejects(fs.stat(pending), { code: "ENOENT" });
    assert.equal(
      decodeExecutionProjectionOutputRecord(confirmedReceipt).sourceId,
      options(continuation === "advance-receipt" ? 10 : 0).projection.sourceId,
    );
  });
}
