/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import {
  resolveBrowserExecutable,
  resolveLibreOfficeExecutable,
} from "@noobot/platform-compatibility/process";

export const IDENTITY = Object.freeze({
  transferId: "transfer:native-script:output",
  messageId: "message:native-script",
  sessionId: "session-1",
  turnScopeId: "turn:native-script",
  runId: "run:native-script",
  producer: { type: "tool", id: "call:native-script" },
});

export function createRuntime(basePath, patch = {}) {
  return {
    basePath,
    userId: "admin",
    globalConfig: { tools: { execute_native_script: { enabled: true } } },
    userConfig: {},
    systemRuntime: {
      sessionId: "session-1",
      rootSessionId: "session-1",
      config: { safeConfirm: false },
    },
    ...patch,
  };
}

async function canRun(executable, args) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
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
  return canRun(resolveLibreOfficeExecutable(), ["--version"]);
}

export async function hasChromiumCapability() {
  const playwright = await import("playwright");
  const executable = resolveBrowserExecutable({
    playwrightExecutable: playwright.chromium.executablePath(),
  });
  const executableStat = await stat(executable).catch(() => null);
  return Boolean(executableStat?.isFile());
}
