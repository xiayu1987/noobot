/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createDependencyDetector } from "../../electron/dependency-detect.js";

function withPlatform(platform, fn) {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Object.defineProperty(process, "platform", original);
    });
}

test("darwin managed dependency probe uses managedVersionArgs", async () => {
  await withPlatform("darwin", async () => {
    const calls = [];
    const detector = createDependencyDetector({
      runProcess: async (command, args) => {
        calls.push({ command, args });
        return { ok: args.length === 1 && args[0] === "-version", code: 0, stdout: "ffmpeg version test" };
      },
      hasExistingFile: (filePath) => filePath === "/managed/ffmpeg/bin/ffmpeg",
      getDarwinManagedKeyForSpec: () => "ffmpeg",
      getMacManagedCommandPath: () => "/managed/ffmpeg/bin/ffmpeg",
    });

    const installed = await detector.isDependencyInstalled({
      label: "FFmpeg",
      managedCommand: "ffmpeg",
      managedVersionArgs: ["-version"],
      checkCommands: ["ffmpeg"],
    });

    assert.equal(installed, true);
    assert.deepEqual(calls, [{ command: "/managed/ffmpeg/bin/ffmpeg", args: ["-version"] }]);
  });
});

test("darwin managed dependency probe falls back to --version when no version args are configured", async () => {
  await withPlatform("darwin", async () => {
    const calls = [];
    const detector = createDependencyDetector({
      runProcess: async (command, args) => {
        calls.push({ command, args });
        return { ok: true, code: 0, stdout: "tool version test" };
      },
      hasExistingFile: () => true,
      getDarwinManagedKeyForSpec: () => "tool",
      getMacManagedCommandPath: () => "/managed/tool/bin/tool",
    });

    assert.equal(await detector.isDependencyInstalled({ label: "Tool", managedCommand: "tool" }), true);
    assert.deepEqual(calls, [{ command: "/managed/tool/bin/tool", args: ["--version"] }]);
  });
});

test("win32 registry default value is parsed and checked for executable candidates", async () => {
  await withPlatform("win32", async () => {
    const installPath = "C:\\Program Files\\LibreOffice";
    const existingPath = path.join(installPath, "program", "soffice.exe");
    const detector = createDependencyDetector({
      runProcess: async (command, args) => {
        assert.equal(command, "reg");
        assert.deepEqual(args, ["query", "HKLM\\SOFTWARE\\LibreOffice\\UNO\\InstallPath"]);
        return {
          ok: true,
          stdout: `HKEY_LOCAL_MACHINE\\SOFTWARE\\LibreOffice\\UNO\\InstallPath\r\n    (Default)    REG_SZ    ${installPath}\r\n`,
        };
      },
      hasExistingFile: (filePath) => filePath === existingPath,
    });

    const installed = await detector.isDependencyInstalled({
      label: "LibreOffice",
      checkCommands: [],
      win32RegistryKeys: ["HKLM\\SOFTWARE\\LibreOffice\\UNO\\InstallPath"],
    });

    assert.equal(installed, true);
  });
});

test("win32 registry parser supports localized default value names", () => {
  const detector = createDependencyDetector();

  assert.equal(
    detector.parseWindowsRegistryDefaultValue("    默认    REG_SZ    C:\\Program Files\\LibreOffice\r\n"),
    "C:\\Program Files\\LibreOffice",
  );
});
