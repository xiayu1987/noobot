/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNativeProcessEnv,
  cleanupNativeTaskDirectory,
  terminateNativeProcessTree,
} from "../../src/tools/execution/native-script-process.js";

test("native task cleanup applies the cross-platform lock retry contract", async () => {
  const calls = [];
  await cleanupNativeTaskDirectory("C:/runtime/native_tasks/task-1", {
    rmImpl: async (directory, options) => calls.push({ directory, options }),
  });

  assert.deepEqual(calls, [
    {
      directory: "C:/runtime/native_tasks/task-1",
      options: {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      },
    },
  ]);
});

test("native process environment isolates task paths on Linux and macOS", () => {
  for (const platform of ["linux", "darwin"]) {
    const environment = buildNativeProcessEnv({
      home: "/task",
      temp: "/temp",
      platform,
      sourceEnv: { PATH: "/usr/bin", SECRET: "must-not-pass" },
    });
    assert.deepEqual(environment, {
      PATH: "/usr/bin",
      HOME: "/task",
      TMPDIR: "/temp",
      LANG: "C.UTF-8",
    });
  }
});

test("native process environment keeps required Windows process variables", () => {
  const environment = buildNativeProcessEnv({
    home: "C:/task",
    temp: "C:/temp",
    platform: "win32",
    sourceEnv: {
      PATH: "C:/Windows/System32",
      SystemRoot: "C:/Windows",
      WINDIR: "C:/Windows",
      ComSpec: "C:/Windows/System32/cmd.exe",
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
      SystemDrive: "C:",
      SECRET: "must-not-pass",
    },
  });

  assert.deepEqual(environment, {
    PATH: "C:/Windows/System32",
    HOME: "C:/task",
    TMPDIR: "C:/temp",
    LANG: "C.UTF-8",
    SystemRoot: "C:/Windows",
    WINDIR: "C:/Windows",
    ComSpec: "C:/Windows/System32/cmd.exe",
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    SystemDrive: "C:",
    USERPROFILE: "C:/task",
    TEMP: "C:/temp",
    TMP: "C:/temp",
  });
  assert.equal(environment.SECRET, undefined);
});

test("native process termination waits for the Windows process tree to exit", async () => {
  const calls = [];
  let releaseTaskkill;
  const terminated = terminateNativeProcessTree({ pid: 123 }, "SIGTERM", {
    platform: "win32",
    execFileImpl: (...args) => {
      calls.push(args);
      releaseTaskkill = args[3];
    },
  });
  let settled = false;
  terminated.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(calls[0][0], "taskkill");
  assert.deepEqual(calls[0][1], ["/PID", "123", "/T", "/F"]);
  releaseTaskkill();
  await terminated;
  assert.equal(settled, true);
});

test("native process termination uses detached groups on Linux and macOS", async () => {
  for (const platform of ["linux", "darwin"]) {
    const processKillCalls = [];
    const childKillCalls = [];
    await terminateNativeProcessTree(
      { pid: 456, kill: (signal) => childKillCalls.push(signal) },
      "SIGKILL",
      {
        platform,
        processKill: (...args) => processKillCalls.push(args),
      },
    );
    assert.deepEqual(processKillCalls, [[-456, "SIGKILL"]]);
    assert.deepEqual(childKillCalls, []);
  }
});
