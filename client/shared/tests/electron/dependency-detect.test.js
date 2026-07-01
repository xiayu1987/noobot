/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { createDependencyDetector } from "../../electron/dependency-detect.js";
import { createDependencyInstaller } from "../../electron/dependency-installer.js";
import { createMacDependencyInstallerTools } from "../../electron/dependency-managed-mac.js";
import { buildDependencyRuntimeEnv, summarizeDependencySources } from "../../electron/dependency-runtime-env.js";
import { getDependencyProxyEnv, getCurlProxyArgs, maskDependencyProxyUrl, normalizeDependencyProxyUrl, validateDependencyProxy } from "../../electron/dependency-proxy.js";

function withPlatform(platform, fn) {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Object.defineProperty(process, "platform", original);
    });
}

function withProcessProperty(name, value, fn) {
  const original = Object.getOwnPropertyDescriptor(process, name);
  Object.defineProperty(process, name, { value });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Object.defineProperty(process, name, original);
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

test("darwin dependency source summary is redacted for model context", async () => {
  await withPlatform("darwin", async () => {
    const summary = summarizeDependencySources({
      platform: "darwin",
      runtimeEnv: {
        LIBRE_OFFICE_EXE: "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        NOOBOT_FFMPEG_PATH: "/Users/me/Library/Application Support/Noobot/managed-dependencies/ffmpeg/bin/ffmpeg",
        PATH: "/Users/me/Library/Application Support/Noobot/managed-dependencies/nodejs/bin:/usr/bin",
      },
      env: {
        NOOBOT_LIBREOFFICE_MAC_DMG_URL: "https://user:secret@example.internal/libreoffice.dmg?token=abc",
        NOOBOT_FFMPEG_MAC_URL: "https://example.internal/ffmpeg.tar.gz?sig=secret",
        NOOBOT_NODEJS_MAC_URL: "https://example.internal/node.tar.xz?token=secret",
        NOOBOT_NODEJS_MAC_VERSION: "v24.0.0",
      },
      exists: (filePath) => filePath.endsWith("/node"),
    });

    const text = JSON.stringify(summary);
    assert.equal(summary.platform, "darwin");
    assert.equal(summary.dependencies.find((item) => item.name === "LibreOffice")?.key, "libreoffice");
    assert.equal(summary.dependencies.find((item) => item.name === "LibreOffice")?.sourceType, "self-hosted");
    assert.equal(summary.dependencies.find((item) => item.name === "FFmpeg")?.hasCustomSource, true);
    assert.equal(summary.dependencies.find((item) => item.name === "Node.js")?.available, true);
    assert.ok(summary.dependencies.find((item) => item.name === "Node.js")?.configKeys.includes("darwinManaged.url"));
    assert.match(text, /NOOBOT_FFMPEG_MAC_URL/);
    assert.doesNotMatch(text, /example\.internal|secret|token=|sig=|\/Users\/me|Application Support/);
  });
});

test("win32 dependency source summary is platform neutral and redacted", async () => {
  await withPlatform("win32", async () => {
    const summary = summarizeDependencySources({
      platform: "win32",
      runtimeEnv: {
        LIBRE_OFFICE_EXE: "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
        NOOBOT_FFMPEG_PATH: "C:\\Users\\me\\AppData\\Local\\Noobot\\managed-dependencies\\ffmpeg\\bin\\ffmpeg.exe",
        PATH: "C:\\Users\\me\\AppData\\Local\\Noobot\\managed-dependencies\\nodejs\\bin;C:\\Windows\\System32",
      },
      env: {
        NOOBOT_LIBREOFFICE_WIN_URL: "https://user:secret@example.internal/libreoffice.exe?token=abc",
        NOOBOT_FFMPEG_WIN_URL: "https://example.internal/ffmpeg.zip?sig=secret",
        NOOBOT_NODEJS_WIN_URL: "https://example.internal/node.zip?token=secret",
        NOOBOT_NODEJS_WIN_VERSION: "v24.0.0",
      },
      exists: (filePath) => String(filePath).endsWith("node.exe"),
    });

    const text = JSON.stringify(summary);
    assert.equal(summary.platform, "win32");
    assert.equal(summary.dependencies.length, 3);
    assert.deepEqual(summary.dependencies.map((item) => item.key), ["libreoffice", "ffmpeg", "nodejs"]);
    assert.equal(summary.dependencies.find((item) => item.key === "libreoffice")?.installMode, "managed");
    assert.equal(summary.dependencies.find((item) => item.key === "ffmpeg")?.sourceType, "self-hosted");
    assert.equal(summary.dependencies.find((item) => item.key === "nodejs")?.available, true);
    assert.ok(summary.dependencies.find((item) => item.key === "nodejs")?.customSourceEnvKeys.includes("NOOBOT_NODEJS_WIN_URL"));
    assert.ok(summary.dependencies.find((item) => item.key === "nodejs")?.configKeys.includes("packages.win32.winget"));
    assert.match(text, /NOOBOT_FFMPEG_WIN_URL/);
    assert.doesNotMatch(text, /example\.internal|secret|token=|sig=|C:\\Users|AppData|Program Files/);
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

test("darwin FFmpeg managed candidates prefer configured URL then GitHub gzip before evermeet zip", async () => {
  await withProcessProperty("arch", "arm64", async () => {
    const tools = createMacDependencyInstallerTools();
    const candidates = tools.getMacFfmpegUrlCandidates({ darwinManaged: { url: "https://mirror.example/ffmpeg.gz" } });

    assert.deepEqual(candidates, [
      "https://mirror.example/ffmpeg.gz",
      "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz",
      "https://evermeet.cx/ffmpeg/getrelease/zip",
      "https://evermeet.cx/ffmpeg/ffmpeg.zip",
    ]);
  });
});

test("darwin FFmpeg managed candidates use x64 GitHub gzip on Intel Macs", async () => {
  await withProcessProperty("arch", "x64", async () => {
    const tools = createMacDependencyInstallerTools();
    assert.equal(
      tools.getMacFfmpegUrlCandidates({ darwinManaged: {} })[0],
      "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-x64.gz",
    );
  });
});

test("darwin FFmpeg managed installer extracts gzip binary archives", async () => {
  await withPlatform("darwin", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "noobot-ffmpeg-managed-gzip-"));
    try {
      const sourceBinary = path.join(rootDir, "ffmpeg-source");
      const sourceArchive = path.join(rootDir, "ffmpeg.gz");
      await writeFile(sourceBinary, "#!/bin/sh\necho ffmpeg version test\n");
      await pipeline(createReadStream(sourceBinary), createGzip(), createWriteStream(sourceArchive));

      const app = {
        isReady: () => true,
        getPath: () => rootDir,
      };
      const logs = [];
      const tools = createMacDependencyInstallerTools({
        app,
        hasExistingFile: (filePath) => {
          return Boolean(filePath) && existsSync(filePath);
        },
        writeDependencyLog: (event, payload) => logs.push({ event, payload }),
        runProcess: async (command, args) => {
          if (command === "curl") {
            await copyFile(sourceArchive, args[args.indexOf("-o") + 1]);
            return { ok: true, code: 0, stdout: "", stderr: "" };
          }
          if (String(command).endsWith("/managed-dependencies/ffmpeg/bin/ffmpeg")) {
            return { ok: true, code: 0, stdout: "ffmpeg version test", stderr: "" };
          }
          return { ok: false, code: 1, stdout: "", stderr: `unexpected command ${command}` };
        },
      });

      const result = await tools.installManagedDependencyMac("ffmpeg", {
        label: "FFmpeg",
        darwinManaged: { url: "https://mirror.example/ffmpeg.gz" },
      });

      const installedPath = path.join(rootDir, "managed-dependencies", "ffmpeg", "bin", "ffmpeg");
      assert.equal(result.ok, true);
      assert.equal(result.path, installedPath);
      assert.equal(await readFile(installedPath, "utf8"), "#!/bin/sh\necho ffmpeg version test\n");
      assert.ok(logs.some((entry) => entry.event === "managed:ffmpeg:extract:finish" && entry.payload.format === "gzip"));
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

test("dependency proxy helpers normalize, mask and build curl/env options", () => {
  const proxyUrl = "http://user:secret@127.0.0.1:7890";
  assert.equal(normalizeDependencyProxyUrl(proxyUrl), "http://user:secret@127.0.0.1:7890/");
  assert.equal(maskDependencyProxyUrl(proxyUrl), "http://***:***@127.0.0.1:7890/");
  assert.deepEqual(getCurlProxyArgs(proxyUrl), ["--proxy", "http://user:secret@127.0.0.1:7890/"]);
  assert.equal(getDependencyProxyEnv(proxyUrl).HTTPS_PROXY, "http://user:secret@127.0.0.1:7890/");
  assert.throws(() => normalizeDependencyProxyUrl("ftp://127.0.0.1:7890"), /must start/);
  assert.throws(() => normalizeDependencyProxyUrl("http://127.0.0.1"), /host and port/);
});

test("dependency proxy validation uses runProcess and reports failures", async () => {
  const calls = [];
  const ok = await validateDependencyProxy({
    proxyUrl: "http://127.0.0.1:7890",
    runProcess: async (command, args, options) => {
      calls.push({ command, args, options });
      return { ok: true, code: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.proxyUrl, "http://127.0.0.1:7890/");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.env.HTTP_PROXY, "http://127.0.0.1:7890/");

  const failed = await validateDependencyProxy({
    proxyUrl: "http://127.0.0.1:7890",
    runProcess: async () => ({ ok: false, code: 7, stdout: "", stderr: "connect failed" }),
  });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /connect failed/);
});

test("darwin curl downloads include configured dependency proxy", async () => {
  await withPlatform("darwin", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "noobot-proxy-curl-"));
    try {
      const sourceBinary = path.join(rootDir, "ffmpeg-source");
      const sourceArchive = path.join(rootDir, "ffmpeg.gz");
      await writeFile(sourceBinary, "#!/bin/sh\necho ffmpeg version test\n");
      await pipeline(createReadStream(sourceBinary), createGzip(), createWriteStream(sourceArchive));
      const curlCalls = [];
      const tools = createMacDependencyInstallerTools({
        app: { isReady: () => true, getPath: () => rootDir },
        hasExistingFile: (filePath) => Boolean(filePath) && existsSync(filePath),
        getDependencyProxyUrl: () => "socks5://127.0.0.1:7890",
        runProcess: async (command, args, options) => {
          if (command === "curl") {
            curlCalls.push({ args, options });
            await copyFile(sourceArchive, args[args.indexOf("-o") + 1]);
            return { ok: true, code: 0, stdout: "", stderr: "" };
          }
          if (String(command).endsWith("/managed-dependencies/ffmpeg/bin/ffmpeg")) return { ok: true, code: 0, stdout: "ffmpeg version test", stderr: "" };
          return { ok: false, code: 1, stdout: "", stderr: `unexpected command ${command}` };
        },
      });

      await tools.installManagedDependencyMac("ffmpeg", { label: "FFmpeg", darwinManaged: { url: "https://mirror.example/ffmpeg.gz" } });
      assert.equal(curlCalls.length, 1);
      assert.ok(curlCalls[0].args.includes("--proxy"));
      assert.ok(curlCalls[0].args.includes("socks5://127.0.0.1:7890"));
      assert.equal(curlCalls[0].options.env.ALL_PROXY, "socks5://127.0.0.1:7890");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

test("darwin FFmpeg managed installer copies ffprobe when archive contains it", async () => {
  await withPlatform("darwin", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "noobot-ffmpeg-managed-ffprobe-"));
    try {
      const app = {
        isReady: () => true,
        getPath: () => rootDir,
      };
      const tools = createMacDependencyInstallerTools({
        app,
        hasExistingFile: (filePath) => Boolean(filePath) && existsSync(filePath),
        runProcess: async (command, args) => {
          if (command === "curl") {
            await writeFile(args[args.indexOf("-o") + 1], "fake zip");
            return { ok: true, code: 0, stdout: "", stderr: "" };
          }
          if (command === "ditto") {
            const extractDir = args[args.length - 1];
            await writeFile(path.join(extractDir, "ffmpeg"), "#!/bin/sh\necho ffmpeg\n");
            await writeFile(path.join(extractDir, "ffprobe"), "#!/bin/sh\necho ffprobe\n");
            return { ok: true, code: 0, stdout: "", stderr: "" };
          }
          if (String(command).endsWith("/managed-dependencies/ffmpeg/bin/ffmpeg")) {
            return { ok: true, code: 0, stdout: "ffmpeg version test", stderr: "" };
          }
          return { ok: false, code: 1, stdout: "", stderr: `unexpected command ${command}` };
        },
      });

      await tools.installManagedDependencyMac("ffmpeg", {
        label: "FFmpeg",
        darwinManaged: { url: "https://mirror.example/ffmpeg.zip" },
      });

      const installedFfprobePath = path.join(rootDir, "managed-dependencies", "ffmpeg", "bin", "ffprobe");
      assert.equal(await readFile(installedFfprobePath, "utf8"), "#!/bin/sh\necho ffprobe\n");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

test("dependency installer injects proxy environment into Windows install commands", async () => {
  await withPlatform("win32", async () => {
    const runs = [];
    const installer = createDependencyInstaller({
      writeDependencyLog: () => {},
      sendStatus: () => {},
      getDependencyProxyUrl: () => "http://127.0.0.1:7890",
      findAvailableCommand: async (commands) => commands.includes("winget"),
      isDependencyInstalled: async () => false,
      waitForDependencyInstalled: async () => true,
      runProcess: async (command, args, options) => {
        runs.push({ command, args, options });
        return { ok: true, code: 0, stdout: "", stderr: "" };
      },
    });

    const result = await installer.ensureSelectedDependencies({ ffmpeg: true });
    assert.equal(result[0].ok, true);
    assert.equal(runs[0].command, "winget");
    assert.deepEqual(runs[0].args.slice(0, 7), ["install", "--id", "Gyan.FFmpeg", "--exact", "--source", "winget", "--accept-package-agreements"]);
    assert.ok(runs[0].args.includes("--accept-source-agreements"));
    assert.ok(runs[0].args.includes("--disable-interactivity"));
    assert.equal(runs[0].options.env.HTTPS_PROXY, "http://127.0.0.1:7890/");
  });
});

test("dependency installer classifies Windows installer cancellation as retryable", async () => {
  const installer = createDependencyInstaller();

  const failure = installer.classifyInstallFailure({
    label: "LibreOffice",
    result: {
      ok: false,
      code: 1602,
      stdout: "你已取消安装。\n安装程序失败，退出代码为: 1602",
      stderr: "",
    },
  });

  assert.equal(failure.failureKind, "user-cancelled");
  assert.equal(failure.retryable, true);
  assert.match(failure.message, /installer was cancelled/);
});

test("dependency installer classifies Windows source agreement failures as retryable", async () => {
  const installer = createDependencyInstaller();

  const failure = installer.classifyInstallFailure({
    label: "LibreOffice",
    result: {
      ok: false,
      code: 1,
      stdout: "msstore source requires agreement before use.",
      stderr: "",
    },
  });

  assert.equal(failure.failureKind, "source-agreement");
  assert.equal(failure.retryable, true);
  assert.match(failure.message, /source requires an agreement/);
});

test("dependency runtime env resolves managed ffmpeg, sibling ffprobe and LibreOffice app", async () => {
  await withPlatform("darwin", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "noobot-runtime-env-"));
    try {
      const ffmpegPath = path.join(rootDir, "managed-dependencies", "ffmpeg", "bin", "ffmpeg");
      const ffprobePath = path.join(rootDir, "managed-dependencies", "ffmpeg", "bin", "ffprobe");
      const sofficePath = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
      const runtimeEnv = buildDependencyRuntimeEnv({
        app: { isReady: () => true, getPath: () => rootDir },
        env: { PATH: "/usr/bin" },
        platform: "darwin",
        exists: (candidatePath) => [ffmpegPath, ffprobePath, sofficePath].includes(candidatePath),
      });

      assert.equal(runtimeEnv.NOOBOT_FFMPEG_PATH, ffmpegPath);
      assert.equal(runtimeEnv.NOOBOT_FFPROBE_PATH, ffprobePath);
      assert.equal(runtimeEnv.LIBRE_OFFICE_EXE, sofficePath);
      assert.ok(runtimeEnv.PATH.startsWith(path.dirname(ffmpegPath)));
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
