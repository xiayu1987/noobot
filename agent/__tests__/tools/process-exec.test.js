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
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { SCRIPT_FAILURE_CODE } from "@noobot/execution-isolation-protocol";
import {
  hasCommand,
  run,
  runFileBacked,
} from "../../src/tools/execution/script-tool/process-exec.js";

const MISSING_COMMAND = "noobot-missing-command-for-process-exec-test";

test("overflow previews preserve Chinese and supplementary Unicode characters", async (t) => {
  const root = await createRoot(t);
  for (const character of ["中", "😀"]) {
    const count = LENGTH_THRESHOLDS.semanticTransfer.toolResultInlineChars + 1;
    const result = await run(
      {
        command: process.execPath,
        args: ["-e", `process.stdout.write(${JSON.stringify(character)}.repeat(${count}))`],
      },
      root,
      5000,
      null,
      { generatedDataRoot: root },
    );
    assert.equal(result.ok, true);
    assert.equal(result.outputOverflow, true);
    assert.equal(
      result.stdout,
      character.repeat(
        Math.floor(LENGTH_THRESHOLDS.semanticTransfer.previewChars / character.length),
      ),
    );
    assert.equal(await fs.readFile(result.stdoutPath, "utf8"), character.repeat(count));
  }
});

test("inline output uses UTF-16 thresholds without splitting surrogate pairs", async (t) => {
  const root = await createRoot(t);
  const limit = LENGTH_THRESHOLDS.semanticTransfer.toolResultInlineChars;
  const previewLimit = LENGTH_THRESHOLDS.semanticTransfer.previewChars;
  for (const character of ["a", "中", "😀"]) {
    for (const delta of [-1, 0, 1]) {
      const length = limit + delta;
      const output =
        character.repeat(Math.floor(length / character.length)) +
        "x".repeat(length % character.length);
      const result = await run(
        {
          command: process.execPath,
          args: ["-e", `process.stdout.write(${JSON.stringify(output)})`],
        },
        root,
        5000,
        null,
        { generatedDataRoot: root },
      );
      assert.equal(result.ok, true);
      assert.equal(result.outputOverflow === true, delta > 0);
      if (delta <= 0) assert.equal(result.stdout, output);
      else assert.equal(result.stdout.length, previewLimit);
    }
  }
  const result = await run(
    {
      command: process.execPath,
      args: ["-e", `process.stdout.write("a" + "😀".repeat(${limit}))`],
    },
    root,
    5000,
    null,
    { generatedDataRoot: root },
  );
  assert.equal(result.stdout, "a" + "😀".repeat(Math.floor((previewLimit - 1) / 2)));
  assert.equal(result.stdout.isWellFormed(), true);
});

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
  assert.deepEqual(result, {
    ok: false,
    termination: "exited",
    exitCode: 3,
    code: SCRIPT_FAILURE_CODE.exited,
    error: "script exited with code 3",
    stdout: "out",
    stderr: "err",
  });
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
  assert.deepEqual(result, {
    ok: true,
    termination: "exited",
    exitCode: 0,
    stdout: "a b;$x",
    stderr: "",
  });
});

test("run reports spawn failures as a failed outcome without an exit code", async (t) => {
  const root = await createRoot(t);
  const result = await run({ command: MISSING_COMMAND }, root, 5000, null, {
    generatedDataRoot: root,
  });
  assert.equal(result.ok, false);
  assert.equal(result.termination, "spawn_failed");
  assert.equal(result.code, SCRIPT_FAILURE_CODE.spawn_failed);
  assert.equal(result.exitCode, undefined);
  assert.equal(result.error, `spawn ${MISSING_COMMAND} ENOENT`);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
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
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 2);
  assert.equal(result.code, SCRIPT_FAILURE_CODE.exited);
  assert.equal(result.stdoutBytes, 3);
  assert.equal(result.stderrBytes, 3);
  assert.equal(result.signal, undefined);
  assert.ok(result.stdoutPath.startsWith(path.join(root, ".execute-script-background")));
  assert.equal(path.dirname(result.stdoutPath), path.dirname(result.stderrPath));
  assert.deepEqual(await readOutputs(result), { stdout: "out", stderr: "err" });
});

test("runFileBacked reports spawn failure through the outcome, not the stderr file", async (t) => {
  const root = await createRoot(t);
  const result = await runFileBacked({ command: MISSING_COMMAND }, root, 5000, null, {
    generatedDataRoot: root,
  });
  assert.equal(result.code, SCRIPT_FAILURE_CODE.spawn_failed);
  assert.equal(result.exitCode, undefined);
  assert.equal(result.error, `spawn ${MISSING_COMMAND} ENOENT`);
  assert.equal(result.stdoutBytes, 0);
  assert.equal(result.stderrBytes, 0);
});

test("runFileBacked reports timeout through the protocol outcome", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX process-group semantics");
  const root = await createRoot(t);
  const result = await runFileBacked("sleep 5", root, 50, null, { generatedDataRoot: root });
  assert.equal(result.code, SCRIPT_FAILURE_CODE.timeout);
  assert.equal(result.error, "command timed out after 50ms");
  assert.equal((await readOutputs(result)).stderr, "");
});

test("runFileBacked with a pre-aborted signal reports an aborted outcome", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX process-group semantics");
  const root = await createRoot(t);
  const controller = new AbortController();
  controller.abort();
  const result = await runFileBacked("sleep 5", root, 5000, controller.signal, {
    generatedDataRoot: root,
  });
  assert.equal(result.code, SCRIPT_FAILURE_CODE.aborted);
  assert.equal(result.error, "command aborted");
});

test("runFileBacked keeps existing stderr instead of overwriting it on timeout", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX process-group semantics");
  const root = await createRoot(t);
  const result = await runFileBacked("printf early >&2; sleep 5", root, 300, null, {
    generatedDataRoot: root,
  });
  assert.equal(result.code, SCRIPT_FAILURE_CODE.timeout);
  assert.equal((await readOutputs(result)).stderr, "early");
});

test("hasCommand distinguishes installed, missing and failed lookups", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX lookup executable");
  assert.equal(await hasCommand("node"), true);
  assert.equal(await hasCommand(MISSING_COMMAND), false);
  const originalPath = process.env.PATH;
  process.env.PATH = "";
  t.after(() => {
    process.env.PATH = originalPath;
  });
  await assert.rejects(() => hasCommand("node"), { code: "ENOENT" });
});
