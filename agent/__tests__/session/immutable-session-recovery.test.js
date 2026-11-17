/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { contentDigest } from "../../src/session/session-artifact-session/immutable-object-store.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { committedPhysicalRecord } from "./helpers/immutable-record-reads.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-recovery-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  return new ImmutableSessionStore({ sessionDir, sessionId: "session-1", allowCreate: true });
}

function operation(expectedGeneration, operationId, value) {
  return {
    expectedGeneration,
    operationId,
    changes: [{ collection: "messages", key: "message", value }],
  };
}

async function writeHead(store, head) {
  const payload = JSON.stringify(head);
  await writeFile(store.headPath, JSON.stringify({ payload, checksum: contentDigest(payload) }));
}

test("operation replay rejects malformed receipts and foreign commits before returning success", async (t) => {
  const store = await fixture(t);
  const request = operation(0, "first", "first-value");
  await store.commit(request);
  const head = await store.snapshot();
  const { receipt, originalCommit } = await store.objects.withSnapshot(head, async () => {
    const receipt = await store.objects.readValue(await store.index.get(head.operations, "first"));
    return { receipt, originalCommit: await store.objects.readValue(receipt.commit) };
  });
  const commitLocation = await committedPhysicalRecord(store, receipt.commit);
  const { base, foreignCommit, wrongGeneration } = await store.objects.withDurabilityBatch(
    async () => {
      store.objects.beginCommit(head);
      const foreignCommit = await store.objects.putValue({
        ...originalCommit,
        operationId: "foreign",
      });
      const wrongGeneration = await store.objects.putValue({ ...originalCommit, generation: 2 });
      await store.objects.publishReachable([
        head.root,
        head.operations,
        foreignCommit,
        wrongGeneration,
      ]);
      return {
        base: { ...head, ...store.objects.publicationHeadFields() },
        foreignCommit,
        wrongGeneration,
      };
    },
  );
  const invalid = [
    null,
    [],
    {},
    { ...receipt, generation: 0 },
    { ...receipt, generation: 2 },
    { ...receipt, generation: 1.5 },
    { ...receipt, digest: "invalid" },
    { ...receipt, commit: "invalid" },
    { ...receipt, extra: [] },
    { ...receipt, commit: foreignCommit },
    { ...receipt, commit: wrongGeneration },
  ];
  for (const value of invalid) {
    const changed = await store.objects.withDurabilityBatch(async () => {
      store.objects.beginCommit(base);
      const root = await store.index.set(
        head.operations,
        "first",
        await store.objects.putValue(value),
      );
      await store.objects.publishReachable([root]);
      return { ...base, operations: root, ...store.objects.publicationHeadFields() };
    });
    await writeHead(store, changed);
    await assert.rejects(store.commit(request), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
    assert.deepEqual(await store.snapshot(), changed);
  }
  await writeHead(store, head);
  await rm(store.objects.segments.segmentPath(commitLocation.segmentId));
  await assert.rejects(store.commit(request), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
});

for (const stage of [
  "segment-file-sync",
  "segment-directory-sync",
  "head-file-write",
  "head-file-sync",
]) {
  test(`failure at ${stage} preserves the old generation and permits an identical retry`, async (t) => {
    const store = await fixture(t);
    await store.commit(operation(0, "seed", "before"));
    const before = await readFile(store.headPath);

    const after =
      stage === "segment-directory-sync" ? randomBytes(2 * 1024 * 1024).toString("hex") : "after";
    const request = operation(1, "change", after);
    let injected = false;
    setFsAdapter({
      open: async (file, flags) => {
        const handle = await open(file, flags);
        const segmentFile = file.startsWith(`${store.objects.segments.directory}${path.sep}`);
        const segmentDirectory = file === store.objects.segments.directory;
        const headFile = file.startsWith(`${store.headPath}.`) && file.endsWith(".tmp");
        return new Proxy(handle, {
          get(target, key) {
            const value = Reflect.get(target, key, target);
            const fail =
              (key === "sync" && stage === "segment-file-sync" && segmentFile && flags === "r+") ||
              (key === "sync" &&
                stage === "segment-directory-sync" &&
                segmentDirectory &&
                flags === "r") ||
              (key === "writeFile" && stage === "head-file-write" && headFile) ||
              (key === "sync" && stage === "head-file-sync" && headFile);
            if (fail)
              return async () => {
                injected = true;
                throw Object.assign(new Error(`injected ${stage}`), { code: "EIO" });
              };
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    });
    try {
      await assert.rejects(store.commit(request), {
        code: stage.startsWith("head-") ? "SESSION_COMMIT_UNCERTAIN" : "EIO",
      });
    } finally {
      resetFsAdapter();
    }
    assert.equal(injected, true);
    assert.deepEqual(await readFile(store.headPath), before);
    assert.equal(await store.get(await store.snapshot(), "messages", "message"), "before");
    const reopened = new ImmutableSessionStore({
      sessionDir: store.sessionDir,
      sessionId: store.sessionId,
    });
    const result = await reopened.commit(request);
    assert.equal(result.generation, 2);
    assert.equal(await reopened.get(await reopened.snapshot(), "messages", "message"), after);
    assert.deepEqual(await reopened.commit(request), { ...result, replayed: true });
  });
}

function writer(t, sessionDir, crashAt = "") {
  const moduleUrl = new URL(
    "../../src/session/session-artifact-session/immutable-session-store.js",
    import.meta.url,
  ).href;
  const adapterUrl = new URL("../../src/shared/storage/fs-adapter.js", import.meta.url).href;
  const source = `
    import { ImmutableSessionStore } from ${JSON.stringify(moduleUrl)};
    import { setFsAdapter } from ${JSON.stringify(adapterUrl)};
    import { rename } from "node:fs/promises";
    const store = new ImmutableSessionStore({ sessionDir: ${JSON.stringify(sessionDir)}, sessionId: "session-1" });
    const crashAt = ${JSON.stringify(crashAt)};
    const crash = () => process.kill(process.pid, "SIGKILL");
    if (crashAt) setFsAdapter({
      rename: async (source, target) => {
        if (target === store.headPath && crashAt === "before-head") crash();
        await rename(source, target);
        if (target === store.headPath && crashAt === "after-head") crash();
      },
    });
    process.once("message", async (request) => {
      try {
        const result = await store.commit(request);
        if (crashAt === "before-response") crash();
        process.send({ ok: true, result });
      } catch (error) {
        process.send({ ok: false, code: error.code, message: error.message, stack: error.stack });
      } finally {
        process.disconnect();
      }
    });
    process.send({ ready: true });
  `;
  const runtimeParamsUrl = new URL("../../../shared/testing/runtime-params.js", import.meta.url)
    .href;
  const child = spawn(
    process.execPath,
    ["--import", runtimeParamsUrl, "--input-type=module", "--eval", source],
    {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0 || (crashAt && signal === "SIGKILL")
        ? resolve({ code, signal })
        : reject(new Error(`writer exited ${code}: ${stderr}`)),
    );
  });
  const ready = new Promise((resolve, reject) => {
    child.once("message", resolve);
    exited.then(() => reject(new Error("writer exited before ready")), reject);
  });
  return {
    ready,
    crash: async (request) => {
      child.send(request);
      return exited;
    },
    run: async (request) => {
      const response = new Promise((resolve, reject) => {
        child.once("message", resolve);
        exited.then(() => reject(new Error("writer exited without result")), reject);
      });
      child.send(request);
      const result = await response;
      await exited;
      return result;
    },
  };
}

test(
  "independent processes serialize competing generations and replay one shared operation",
  { timeout: 15000 },
  async (t) => {
    const store = await fixture(t);
    await store.commit(operation(0, "seed", "initial"));
    const first = writer(t, store.sessionDir);
    const second = writer(t, store.sessionDir);
    await Promise.all([first.ready, second.ready]);
    const requests = [operation(1, "first", "first"), operation(1, "second", "second")];
    const results = await Promise.all([first.run(requests[0]), second.run(requests[1])]);
    const winner = results.findIndex((result) => result.ok);
    assert.notEqual(winner, -1, JSON.stringify(results));
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results[1 - winner].code, "SESSION_GENERATION_CONFLICT");
    const snapshot = await store.snapshot();
    assert.equal(snapshot.generation, 2);
    assert.equal(
      await store.get(snapshot, "messages", "message"),
      requests[winner].changes[0].value,
    );
    const retries = [writer(t, store.sessionDir), writer(t, store.sessionDir)];
    await Promise.all(retries.map((child) => child.ready));
    for (const replay of await Promise.all(retries.map((child) => child.run(requests[winner])))) {
      assert.equal(replay.ok, true);
      assert.deepEqual(replay.result, { ...results[winner].result, replayed: true });
    }
    assert.deepEqual(await store.snapshot(), snapshot);
  },
);

for (const stage of ["before-head", "after-head", "before-response"]) {
  test(
    `process termination ${stage} recovers one complete graph and one durable operation`,
    { timeout: 15000 },
    async (t) => {
      const store = await fixture(t);
      await store.commit(operation(0, "seed", "before"));
      const initial = await store.snapshot();
      const request = operation(1, "change", "after");
      const child = writer(t, store.sessionDir, stage);
      await child.ready;
      assert.equal((await child.crash(request)).signal, "SIGKILL");
      const reopened = new ImmutableSessionStore({
        sessionDir: store.sessionDir,
        sessionId: store.sessionId,
      });
      const current = await reopened.snapshot();
      const committed = stage !== "before-head";
      assert.equal(current.generation, committed ? 2 : 1);
      assert.equal(
        await reopened.get(current, "messages", "message"),
        committed ? "after" : "before",
      );
      assert.equal(await reopened.get(initial, "messages", "message"), "before");
      if (stage === "before-response") {
        await assert.rejects(readFile(store.lockPath), { code: "ENOENT" });
      } else {
        await utimes(store.lockPath, new Date(0), new Date(0));
      }
      const recovered = await reopened.commit(request);
      assert.equal(recovered.generation, 2);
      assert.equal(recovered.replayed, committed);
      assert.equal(await reopened.get(await reopened.snapshot(), "messages", "message"), "after");
      assert.deepEqual(await reopened.commit(request), { ...recovered, replayed: true });
    },
  );
}
