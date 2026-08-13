/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";

import {
  buildNativeProcessEnv,
  cleanupNativeTaskDirectory,
  resolveNativeBrowserExecutable,
  resolveNativeLibreOfficeExecutable,
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
        maxRetries: TURN_THRESHOLDS.tools.nativeTaskCleanupMaxRetries,
        retryDelay: TIME_THRESHOLDS.tools.nativeTaskCleanupRetryDelayMs,
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
      ELECTRON_RUN_AS_NODE: "1",
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
    ELECTRON_RUN_AS_NODE: "1",
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

test("native process environment forces packaged Electron into Node mode", () => {
  const environment = buildNativeProcessEnv({
    home: "/task",
    temp: "/temp",
    platform: "linux",
    sourceEnv: { PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "" },
  });

  assert.equal(environment.ELECTRON_RUN_AS_NODE, "1");
});

test("native process environment preserves only declared network proxy variables", () => {
  const environment = buildNativeProcessEnv({
    home: "/task",
    temp: "/temp",
    platform: "linux",
    sourceEnv: {
      PATH: "/usr/bin",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      NO_PROXY: "127.0.0.1,localhost",
      SECRET: "must-not-pass",
    },
  });

  assert.equal(environment.HTTPS_PROXY, "http://127.0.0.1:7890");
  assert.equal(environment.NO_PROXY, "127.0.0.1,localhost");
  assert.equal(environment.SECRET, undefined);
});

test("native LibreOffice executable uses the host-resolved dependency path", () => {
  assert.equal(
    resolveNativeLibreOfficeExecutable({
      platform: "win32",
      sourceEnv: {
        LIBRE_OFFICE_EXE: "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      },
    }),
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  );
  assert.equal(
    resolveNativeLibreOfficeExecutable({ platform: "win32", sourceEnv: {} }),
    "soffice.exe",
  );
  assert.equal(
    resolveNativeLibreOfficeExecutable({ platform: "darwin", sourceEnv: {} }),
    "libreoffice",
  );
});

test("native browser executable prefers the client-resolved dependency path", () => {
  assert.equal(
    resolveNativeBrowserExecutable({
      playwrightExecutable: "/standard-cache/chromium",
      sourceEnv: { NOOBOT_PLAYWRIGHT_CHROMIUM_PATH: "/client/chromium" },
    }),
    "/client/chromium",
  );
  assert.equal(
    resolveNativeBrowserExecutable({
      playwrightExecutable: "/standard-cache/chromium",
      sourceEnv: {},
    }),
    "/standard-cache/chromium",
  );
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
