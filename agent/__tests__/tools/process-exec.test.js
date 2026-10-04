/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run, runFileBacked } from "../../src/tools/execution/script-tool/process-exec.js";

const MISSING_COMMAND = "noobot-missing-command-for-process-exec-test";

async function createRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-process-exec-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function readOutputs(result) {
  return {
    stdout: await fs.readFile(result.stdoutPath, "utf8"),
    stderr: await fs.readFile(result.stderrPath, "utf8"),
  };
}

test("run returns exit code and inline output, then removes its output dir", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX shell syntax");
  const root = await createRoot(t);
  const result = await run("printf out; printf err >&2; exit 3", root, 5000, null, {
    generatedDataRoot: root,
  });
  assert.deepEqual(result, { code: 3, stdout: "out", stderr: "err" });
  const foregroundDir = path.join(root, ".execute-script-foreground");
  assert.deepEqual(await fs.readdir(foregroundDir), []);
});

test("run passes object command args without shell interpretation", async (t) => {
  const root = await createRoot(t);
  const result = await run(
    { command: process.execPath, args: ["-e", "process.stdout.write(process.argv[1])", "a b;$x"] },
    root,
    5000,
    null,
    { generatedDataRoot: root },
  );
  assert.deepEqual(result, { code: 0, stdout: "a b;$x", stderr: "" });
});

test("run reports spawn failures through code and stderr", async (t) => {
  const root = await createRoot(t);
  const result = await run({ command: MISSING_COMMAND }, root, 5000, null, {
    generatedDataRoot: root,
  });
  assert.equal(result.code, -2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `spawn ${MISSING_COMMAND} ENOENT`);
});

test("run rejects object commands without an executable", async (t) => {
  const root = await createRoot(t);
  await assert.rejects(
    run({ command: " " }, root, 5000, null, { generatedDataRoot: root }),
    /process command executable is required/,
  );
});

test("runFileBacked keeps output files and reports their sizes", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX shell syntax");
  const root = await createRoot(t);
  const result = await runFileBacked("printf out; printf err >&2; exit 2", root, 5000, null, {
    generatedDataRoot: root,
  });
  assert.equal(result.code, 2);
  assert.equal(result.stdoutBytes, 3);
  assert.equal(result.stderrBytes, 3);
  assert.equal(result.signal, undefined);
  assert.ok(result.stdoutPath.startsWith(path.join(root, ".execute-script-background")));
  assert.equal(path.dirname(result.stdoutPath), path.dirname(result.stderrPath));
  assert.deepEqual(await readOutputs(result), { stdout: "out", stderr: "err" });
});

test("runFileBacked writes spawn failure message into the stderr file", async (t) => {
  const root = await createRoot(t);
  const result = await runFileBacked({ command: MISSING_COMMAND }, root, 5000, null, {
    generatedDataRoot: root,
  });
  const expected = `spawn ${MISSING_COMMAND} ENOENT`;
  assert.equal(result.code, -2);
  assert.equal(result.stdoutBytes, 0);
  assert.equal(result.stderrBytes, Buffer.byteLength(expected));
  assert.deepEqual(await readOutputs(result), { stdout: "", stderr: expected });
});

test("runFileBacked writes timeout message and returns 124", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX process-group semantics");
  const root = await createRoot(t);
  const result = await runFileBacked("sleep 5", root, 50, null, { generatedDataRoot: root });
  assert.equal(result.code, 124);
  assert.equal((await readOutputs(result)).stderr, "command timed out after 50ms");
});

test("runFileBacked with a pre-aborted signal writes abort message and returns 130", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX process-group semantics");
  const root = await createRoot(t);
  const controller = new AbortController();
  controller.abort();
  const result = await runFileBacked("sleep 5", root, 5000, controller.signal, {
    generatedDataRoot: root,
  });
  assert.equal(result.code, 130);
  assert.equal((await readOutputs(result)).stderr, "command aborted");
});

test("runFileBacked keeps existing stderr instead of overwriting it on timeout", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX process-group semantics");
  const root = await createRoot(t);
  const result = await runFileBacked("printf early >&2; sleep 5", root, 300, null, {
    generatedDataRoot: root,
  });
  assert.equal(result.code, 124);
  assert.equal((await readOutputs(result)).stderr, "early");
});
