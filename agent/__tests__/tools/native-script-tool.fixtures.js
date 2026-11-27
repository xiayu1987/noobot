/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildLibreOfficeUserInstallationUrl } from "../../src/tools/execution/native-script-runtime.js";
import {
  resolveBrowserExecutable,
  resolveLibreOfficeExecutable,
  terminateProcessTree,
  usesDetachedProcessGroup,
} from "@noobot/platform-compatibility/process";

export const IDENTITY = Object.freeze({
  transferId: "transfer:native-script:output",
  presentationMessageId: "message:native-script",
  sessionId: "session-1",
  turnScopeId: "turn:native-script",
  runId: "run:native-script",
  producer: { type: "tool", id: "call:native-script" },
});

export function createRuntime(basePath, patch = {}) {
  return createTestRuntimeContext({
    basePath,
    globalConfig: { tools: { execute_native_script: { enabled: true } } },
    userConfig: {},
    identity: { userId: "admin", sessionId: "session-1" },
    systemRuntime: {
      persistenceScope: null,
      config: { safeConfirm: false },
    },
    ...patch,
  });
}

async function canRun(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: "ignore",
      windowsHide: true,
      detached: usesDetachedProcessGroup(),
    });
    const timer = setTimeout(() => {
      void terminateProcessTree(child.pid, {
        graceMs: 0,
        settleMs: 5000,
        controlTimeoutMs: 30000,
      }).then(() => reject(new Error(`Capability probe timed out: ${executable}`)), reject);
    }, 15000);
    child.once("error", (error) => {
      clearTimeout(timer);
      if (error.code === "ENOENT") resolve(false);
      else reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(true);
      else reject(new Error(`Capability probe exited with code ${code}: ${executable}`));
    });
  });
}

export async function hasFfmpegCapabilities() {
  const [ffmpeg, ffprobe] = await Promise.all([
    canRun("ffmpeg", ["-version"]),
    canRun("ffprobe", ["-version"]),
  ]);
  return ffmpeg && ffprobe;
}

export async function hasLibreOfficeCapability() {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-libreoffice-probe-"));
  try {
    return await canRun(resolveLibreOfficeExecutable(), [
      "--headless",
      `-env:UserInstallation=${buildLibreOfficeUserInstallationUrl(root)}`,
      "--version",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function hasChromiumCapability() {
  const playwright = await import("playwright");
  const executable = resolveBrowserExecutable({
    playwrightExecutable: playwright.chromium.executablePath(),
  });
  const executableStat = await stat(executable).catch(() => null);
  return Boolean(executableStat?.isFile());
}
