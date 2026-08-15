/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  PLATFORM,
  SHELL,
  buildRestrictedProcessEnv,
  decodeCommandOutput,
  isTransientAtomicRenameError,
  normalizePlatform,
  resolveCommandLookupExecutable,
  resolveCommandShimExecutable,
  resolveHostShell,
  resolveLibreOfficeExecutable,
  terminateProcessTree,
  usesDetachedProcessGroup,
} from "../src/index.js";

test("platform aliases normalize to one canonical identity", () => {
  assert.equal(normalizePlatform("win32"), PLATFORM.WINDOWS);
  assert.equal(normalizePlatform("darwin"), PLATFORM.MACOS);
  assert.equal(normalizePlatform("linux"), PLATFORM.LINUX);
});

test("host shell selection is owned by canonical platform identity", () => {
  assert.equal(resolveHostShell("win32"), SHELL.WINDOWS_COMMAND);
  assert.equal(resolveHostShell("darwin"), SHELL.POSIX);
  assert.equal(resolveHostShell("linux"), SHELL.POSIX);
});

test("process launch conventions are owned by canonical platform identity", () => {
  assert.equal(usesDetachedProcessGroup("win32"), false);
  assert.equal(usesDetachedProcessGroup("darwin"), true);
  assert.equal(usesDetachedProcessGroup("linux"), true);
  assert.equal(resolveCommandLookupExecutable("win32"), "where");
  assert.equal(resolveCommandLookupExecutable("darwin"), "which");
  assert.equal(resolveCommandLookupExecutable("linux"), "which");
  assert.equal(resolveCommandShimExecutable("npm", "win32"), "npm.cmd");
  assert.equal(resolveCommandShimExecutable("npm", "darwin"), "npm");
  assert.equal(resolveCommandShimExecutable("npm", "linux"), "npm");
});

test("Windows localized command output is decoded by locale", () => {
  const gbkText = Buffer.from([0xb2, 0xbb, 0xca, 0xc7]);
  assert.equal(decodeCommandOutput(gbkText, { platform: "win32", locale: "zh-CN" }), "不是");
  assert.equal(
    decodeCommandOutput(Buffer.from("中文", "utf8"), { platform: "win32", locale: "zh-CN" }),
    "中文",
  );
});

test("atomic rename retries only transient Windows lock errors", () => {
  for (const code of ["EPERM", "EACCES", "EBUSY"]) {
    assert.equal(isTransientAtomicRenameError({ code }, { platform: "win32" }), true);
    assert.equal(isTransientAtomicRenameError({ code }, { platform: "linux" }), false);
    assert.equal(isTransientAtomicRenameError({ code }, { platform: "darwin" }), false);
  }
});

test("restricted process environment projects only declared platform variables", () => {
  const environment = buildRestrictedProcessEnv({
    home: "C:/task",
    temp: "C:/temp",
    platform: "win32",
    sourceEnv: {
      PATH: "C:/Windows/System32",
      SystemRoot: "C:/Windows",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      SECRET: "excluded",
    },
  });
  assert.equal(environment.SystemRoot, "C:/Windows");
  assert.equal(environment.HTTPS_PROXY, "http://127.0.0.1:7890");
  assert.equal(environment.SECRET, undefined);
});

test("LibreOffice executable resolution is platform-owned", () => {
  assert.equal(resolveLibreOfficeExecutable({ platform: "win32", sourceEnv: {} }), "soffice.exe");
  assert.equal(resolveLibreOfficeExecutable({ platform: "darwin", sourceEnv: {} }), "libreoffice");
});

test("process tree termination uses the platform primitive", async () => {
  const calls = [];
  await terminateProcessTree({ pid: 42 }, "SIGTERM", {
    platform: "win32",
    execFileImpl: (...args) => args[3](),
    processKill: (...args) => calls.push(args),
  });
  assert.deepEqual(calls, []);

  await terminateProcessTree({ pid: 43 }, "SIGTERM", {
    platform: "linux",
    processKill: (...args) => calls.push(args),
  });
  assert.deepEqual(calls, [[-43, "SIGTERM"]]);

  const directSignals = [];
  await terminateProcessTree({ pid: 44, kill: (signal) => directSignals.push(signal) }, "SIGTERM", {
    platform: "linux",
    processGroup: false,
    processKill: (...args) => calls.push(args),
  });
  assert.deepEqual(directSignals, ["SIGTERM"]);
  assert.deepEqual(calls, [[-43, "SIGTERM"]]);

  await terminateProcessTree({ pid: "not-a-pid" }, "SIGTERM", {
    platform: "win32",
    execFileImpl: (...args) => calls.push(args),
  });
  assert.deepEqual(calls, [[-43, "SIGTERM"]]);
});
