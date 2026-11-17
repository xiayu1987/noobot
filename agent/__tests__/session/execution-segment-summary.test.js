/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  EXECUTION_EVENT_SEGMENT_ERROR_CODE,
  decodeExecutionSegment,
} from "@noobot/session-protocol/execution-event-index";
import {
  appendRollingJsonlArtifactLog,
  readExecutionSegmentSummary,
  resolveExecutionTurnDir,
} from "../../src/session/session-artifact-execution-logs.js";
import {
  inspectSessionArtifacts,
  repairSessionArtifacts,
} from "../../src/session/session-artifact-maintenance.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";

const file = "segment-000001.jsonl";
const dialogProcessId = "11111111-2222-4333-8444-555555555555";

async function directory(context) {
  const turnDir = await mkdtemp(path.join(tmpdir(), "execution-summary-"));
  context.after(() => rm(turnDir, { recursive: true, force: true }));
  return turnDir;
}

for (const raw of [
  "",
  "{}\n",
  '{"content":"中文🙂"}\r\n  {"id":2}  \n',
  `${JSON.stringify({ content: "中文🙂".repeat(40000) })}\n{}\n`,
]) {
  test(`streaming summary matches protocol decoding for ${Buffer.byteLength(raw)} bytes`, async (context) => {
    const turnDir = await directory(context);
    await writeFile(path.join(turnDir, file), raw);
    const decoded = decodeExecutionSegment(raw, file);
    assert.deepEqual(await readExecutionSegmentSummary({ turnDir, file }), {
      bytes: decoded.bytes,
      records: decoded.records.length,
    });
  });
}

for (const [raw, code] of [
  ['{"id":1}', EXECUTION_EVENT_SEGMENT_ERROR_CODE.TORN_WRITE],
  ['{"id":1}\n{"id":', EXECUTION_EVENT_SEGMENT_ERROR_CODE.TORN_WRITE],
  ['{"id":1}\nwrong\n', EXECUTION_EVENT_SEGMENT_ERROR_CODE.JSONL_CORRUPTED],
  ["[]\n", EXECUTION_EVENT_SEGMENT_ERROR_CODE.JSONL_CORRUPTED],
  ["{}\n\n", EXECUTION_EVENT_SEGMENT_ERROR_CODE.JSONL_CORRUPTED],
]) {
  test(`streaming summary rejects ${JSON.stringify(raw)}`, async (context) => {
    const turnDir = await directory(context);
    await writeFile(path.join(turnDir, file), raw);
    await assert.rejects(readExecutionSegmentSummary({ turnDir, file }), { code });
  });
}

test("missing segment retains the protocol error; cancellation rejects before accessing it", async (context) => {
  const turnDir = await directory(context);
  await assert.rejects(readExecutionSegmentSummary({ turnDir, file }), {
    code: EXECUTION_EVENT_SEGMENT_ERROR_CODE.MISSING,
  });
  const controller = new AbortController();
  const reason = new Error("cancelled by caller");
  controller.abort(reason);
  await assert.rejects(
    readExecutionSegmentSummary({ turnDir, file, signal: controller.signal }),
    (error) => error === reason,
  );
});

async function registeredFixture(context) {
  const sessionDir = await directory(context);
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "audit", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "initial",
    changes: [{ collection: "metadata", key: "name", value: "audit" }],
  });
  await appendRollingJsonlArtifactLog({
    storageService,
    sessionDir,
    log: { dialogProcessId, content: "中文🙂" },
    maxSegmentBytes: 1024,
    alreadyLocked: false,
  });
  const turnDir = resolveExecutionTurnDir(sessionDir, dialogProcessId);
  const indexPath = path.join(turnDir, "index.json");
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  index.segments[0].bytes = 0;
  index.segments[0].records = 0;
  await writeFile(indexPath, JSON.stringify(index));
  return { sessionDir, turnDir, indexPath };
}

for (const operation of [inspectSessionArtifacts, repairSessionArtifacts]) {
  test(`${operation.name} propagates cancellation after the storage audit without rewriting the log index`, async (context) => {
    const { sessionDir, indexPath } = await registeredFixture(context);
    const before = await readFile(indexPath);
    const controller = new AbortController();
    const reason = new Error("cancel execution inspection");
    let reads = 0;
    const cancellingStorage = Object.assign(Object.create(storageService), {
      async readOptionalJson(filePath) {
        const value = await storageService.readOptionalJson(filePath);
        reads += 1;
        controller.abort(reason);
        return value;
      },
    });
    await assert.rejects(
      operation({
        storageService: cancellingStorage,
        sessionDir,
        signal: controller.signal,
        alreadyLocked: false,
        assertSessionWritable: async () => {},
      }),
      (error) => error === reason,
    );
    assert.equal(reads, 1);
    assert.deepEqual(await readFile(indexPath), before);
  });
}

test("streaming inspection reports mismatched counts and repair rebuilds them idempotently", async (context) => {
  const { sessionDir } = await registeredFixture(context);
  const report = await inspectSessionArtifacts({ storageService, sessionDir });
  assert.equal(report.storage.ok, true);
  assert.equal(report.ok, false);
  assert.deepEqual(report.execution, { turns: 1, segments: 1 });
  assert.equal(report.issues[0].code, "EXECUTION_INDEX_MISMATCH");
  const options = {
    storageService,
    sessionDir,
    alreadyLocked: false,
    assertSessionWritable: async () => {},
  };
  const repaired = await repairSessionArtifacts(options);
  assert.equal(repaired.after.ok, true);
  assert.deepEqual(repaired.repaired, [`turns/${dialogProcessId}/${file}`]);
  assert.deepEqual((await repairSessionArtifacts(options)).repaired, []);
});

test("corrupt registered segment blocks index repair without changing its evidence", async (context) => {
  const { sessionDir, turnDir, indexPath } = await registeredFixture(context);
  const before = await readFile(indexPath);
  await writeFile(path.join(turnDir, file), "{}\n[]\n");
  const report = await inspectSessionArtifacts({ storageService, sessionDir });
  assert.equal(report.ok, false);
  assert.equal(report.issues[0].code, EXECUTION_EVENT_SEGMENT_ERROR_CODE.JSONL_CORRUPTED);
  await assert.rejects(
    repairSessionArtifacts({
      storageService,
      sessionDir,
      alreadyLocked: false,
      assertSessionWritable: async () => {},
    }),
    { code: EXECUTION_EVENT_SEGMENT_ERROR_CODE.JSONL_CORRUPTED },
  );
  assert.deepEqual(await readFile(indexPath), before);
});

test("segment larger than the process heap is summarized and its stream can be cancelled", async (context) => {
  const turnDir = await directory(context);
  const block = `${JSON.stringify({ content: "x".repeat(1000) })}\n`.repeat(1024);
  const handle = await open(path.join(turnDir, file), "w");
  try {
    for (let position = 0; position < 64; position += 1) await handle.writeFile(block);
  } finally {
    await handle.close();
  }
  const moduleUrl = new URL(
    "../../src/session/session-artifact-execution-logs.js",
    import.meta.url,
  );
  const script = `
    import assert from "node:assert/strict";
    import { readExecutionSegmentSummary } from ${JSON.stringify(moduleUrl.href)};
    const options = { turnDir: process.argv[1], file: process.argv[2] };
    console.log(JSON.stringify(await readExecutionSegmentSummary(options)));
    const controller = new AbortController();
    const reading = readExecutionSegmentSummary({ ...options, signal: controller.signal });
    setImmediate(() => controller.abort());
    await assert.rejects(reading, { name: "AbortError" });
  `;
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--max-old-space-size=48",
    "--input-type=module",
    "--eval",
    script,
    turnDir,
    file,
  ]);
  assert.deepEqual(JSON.parse(stdout), { bytes: Buffer.byteLength(block) * 64, records: 65536 });
});
