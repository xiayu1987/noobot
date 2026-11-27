/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PLATFORM,
  SHELL,
  buildRestrictedProcessEnv,
  decodeCommandOutput,
  isBrowserProfileNameAllowed,
  isTransientAtomicRenameError,
  normalizePlatform,
  resolveCommandLookupExecutable,
  resolveBrowserProfileRoot,
  resolveHostShell,
  resolveLibreOfficeExecutable,
  supportsHeadedBrowser,
  syncDirectory,
  terminateProcessTree,
  usesDetachedProcessGroup,
  writeFileAtomic,
  writeFileAtomicCreatingParents,
} from "../src/index.js";

test("platform aliases normalize to one canonical identity", () => {
  assert.equal(normalizePlatform("win32"), PLATFORM.WINDOWS);
  assert.equal(normalizePlatform("darwin"), PLATFORM.MACOS);
  assert.equal(normalizePlatform("linux"), PLATFORM.LINUX);
});

test("directory synchronization owns Windows capability differences", async () => {
  for (const platform of ["win32", "win", "windows"]) {
    assert.equal(
      await syncDirectory({
        directory: "directory",
        platform,
        open: () => {
          assert.fail("Windows must not open directory handles");
        },
      }),
      false,
    );
  }
});

for (const platform of ["linux", "darwin"]) {
  test(`${platform} directory synchronization closes handles and preserves failures`, async () => {
    const syncError = new Error("sync failed");
    const closeError = new Error("close failed");
    const openError = new Error("open failed");
    await assert.rejects(
      syncDirectory({
        directory: "directory",
        platform,
        open: async () => {
          throw openError;
        },
      }),
      (error) => error === openError,
    );
    for (const failures of [[], [syncError], [closeError], [syncError, closeError]]) {
      const calls = [];
      const operation = syncDirectory({
        directory: "directory",
        platform,
        open: async (file, flags) => {
          assert.equal(file, "directory");
          assert.equal(flags, "r");
          return {
            async sync() {
              calls.push("sync");
              if (failures.includes(syncError)) throw syncError;
            },
            async close() {
              calls.push("close");
              if (failures.includes(closeError)) throw closeError;
            },
          };
        },
      });
      if (!failures.length) assert.equal(await operation, true);
      else
        await assert.rejects(operation, (error) => {
          if (failures.length === 1) return error === failures[0];
          assert.ok(error instanceof AggregateError);
          assert.deepEqual(error.errors, failures);
          assert.equal(error.cause, syncError);
          return true;
        });
      assert.deepEqual(calls, ["sync", "close"]);
    }
  });
}

test("directory synchronization requires an injected open operation on every platform", async () => {
  for (const platform of ["win32", "linux", "darwin"])
    await assert.rejects(syncDirectory({ directory: "directory", platform }), TypeError);
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
  assert.equal(resolveLibreOfficeExecutable({ platform: "win32", sourceEnv: {} }), "soffice.com");
  assert.equal(resolveLibreOfficeExecutable({ platform: "darwin", sourceEnv: {} }), "libreoffice");
});

test("browser profile root is resolved only from the declared environment key", () => {
  assert.equal(
    resolveBrowserProfileRoot({ sourceEnv: { NOOBOT_BROWSER_PROFILE_ROOT: "/data/profiles" } }),
    "/data/profiles",
  );
  assert.equal(resolveBrowserProfileRoot({ sourceEnv: { HOME: "/home/user" } }), "");
  assert.equal(resolveBrowserProfileRoot({ sourceEnv: { NOOBOT_BROWSER_PROFILE_ROOT: "  " } }), "");
});

test("browser profile names reject traversal and separator characters", () => {
  assert.equal(isBrowserProfileNameAllowed("default"), true);
  assert.equal(isBrowserProfileNameAllowed("work-account.2"), true);
  assert.equal(isBrowserProfileNameAllowed(".."), false);
  assert.equal(isBrowserProfileNameAllowed("../escape"), false);
  assert.equal(isBrowserProfileNameAllowed("nested/name"), false);
  assert.equal(isBrowserProfileNameAllowed("back\\slash"), false);
  assert.equal(isBrowserProfileNameAllowed(""), false);
  assert.equal(isBrowserProfileNameAllowed(".hidden"), false);
  assert.equal(isBrowserProfileNameAllowed("a".repeat(65)), false);
});

test("headed browser support requires a display only on Linux", () => {
  assert.equal(supportsHeadedBrowser({ platform: "win32", sourceEnv: {} }), true);
  assert.equal(supportsHeadedBrowser({ platform: "darwin", sourceEnv: {} }), true);
  assert.equal(supportsHeadedBrowser({ platform: "linux", sourceEnv: {} }), false);
  assert.equal(supportsHeadedBrowser({ platform: "linux", sourceEnv: { DISPLAY: ":0" } }), true);
  assert.equal(
    supportsHeadedBrowser({ platform: "linux", sourceEnv: { WAYLAND_DISPLAY: "wayland-0" } }),
    true,
  );
});

test("restricted process env never projects display session variables", () => {
  const sourceEnv = {
    PATH: "/usr/bin",
    DISPLAY: ":0",
    XAUTHORITY: "/run/user/1000/.mutter-Xwaylandauth",
    XDG_RUNTIME_DIR: "/run/user/1000",
    SECRET: "excluded",
  };
  const restricted = buildRestrictedProcessEnv({
    home: "/task",
    temp: "/tmp",
    platform: "linux",
    sourceEnv,
  });
  assert.equal(restricted.DISPLAY, undefined);
  assert.equal(restricted.XAUTHORITY, undefined);
  assert.equal(restricted.XDG_RUNTIME_DIR, undefined);
  assert.equal(restricted.SECRET, undefined);
});

test("process tree termination uses the platform primitive", async () => {
  const calls = [];
  let alive = true;
  await terminateProcessTree(42, {
    graceMs: 0,
    settleMs: 100,
    platform: "win32",
    execFileImpl: (command, args, options, done) => {
      calls.push([command, args, options]);
      if (args.at(-1).includes("SELECT ProcessId")) {
        done(
          null,
          JSON.stringify(
            alive ? [{ pid: 42, parentPid: 1, started: "20261126000000.000000+000" }] : [],
          ),
        );
        return;
      }
      alive = false;
      done();
    },
    processKill: () => {
      if (!alive) throw Object.assign(new Error("gone"), { code: "ESRCH" });
    },
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(([command]) => command === "powershell.exe"));
  assert.match(calls[1][1].at(-1), /ProcessId = 42/);

  const signals = [];
  await terminateProcessTree(43, {
    graceMs: 100,
    settleMs: 100,
    platform: "linux",
    processKill: (target, signal) => {
      assert.equal(target, -43);
      if (signal === 0) throw Object.assign(new Error("gone"), { code: "ESRCH" });
      signals.push(signal);
    },
  });
  assert.deepEqual(signals, ["SIGTERM"]);
});

test("atomic write keeps a fixed-length temporary name for long target names", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "atomic-write-"));
  const fileName = `${"a".repeat(240)}.json`;
  try {
    await writeFileAtomic({
      filePath: path.join(directory, fileName),
      content: "{}",
      writeFile,
      rename,
      remove: rm,
    });
    assert.equal(await readFile(path.join(directory, fileName), "utf8"), "{}");
    assert.deepEqual(await readdir(directory), [fileName]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("workspace atomic write creates missing parent directories without leaving temporary files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "atomic-write-parents-"));
  const target = path.join(directory, "docs", "nested", "报告.md");
  try {
    await writeFileAtomicCreatingParents({
      filePath: target,
      content: "中文\n",
      mkdir,
      writeFile,
      rename,
      remove: rm,
    });
    assert.equal(await readFile(target, "utf8"), "中文\n");
    assert.deepEqual(await readdir(path.dirname(target)), ["报告.md"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("workspace atomic write requires an injected mkdir operation", async () => {
  await assert.rejects(
    writeFileAtomicCreatingParents({
      filePath: path.join(tmpdir(), "never-written.txt"),
      content: "",
      writeFile,
      rename,
      remove: rm,
    }),
    TypeError,
  );
});
