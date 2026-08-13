/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";

const WINDOWS_PROCESS_ENV_KEYS = Object.freeze([
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
  "SystemDrive",
]);

export function buildNativeProcessEnv({
  home = "",
  temp = "",
  platform = process.platform,
  sourceEnv = process.env,
} = {}) {
  const environment = {
    PATH: sourceEnv.PATH || "",
    HOME: home,
    TMPDIR: temp,
    LANG: "C.UTF-8",
    ELECTRON_RUN_AS_NODE: "1",
  };
  if (platform === "win32") {
    for (const key of WINDOWS_PROCESS_ENV_KEYS) {
      if (String(sourceEnv[key] || "").trim()) environment[key] = sourceEnv[key];
    }
    environment.USERPROFILE = home;
    environment.TEMP = temp;
    environment.TMP = temp;
  }
  return environment;
}

export function terminateNativeProcessTree(
  child,
  signal = "SIGTERM",
  { platform = process.platform, execFileImpl = execFile, processKill = process.kill } = {},
) {
  const pid = Number(child?.pid || 0);
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve();
  if (platform === "win32") {
    return new Promise((resolve) => {
      execFileImpl("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () =>
        resolve(),
      );
    });
  }
  try {
    processKill(-pid, signal);
  } catch {
    child.kill(signal);
  }
  return Promise.resolve();
}

export async function cleanupNativeTaskDirectory(directory, { rmImpl = rm } = {}) {
  if (!String(directory || "").trim()) return;
  await rmImpl(directory, {
    recursive: true,
    force: true,
    maxRetries: TURN_THRESHOLDS.tools.nativeTaskCleanupMaxRetries,
    retryDelay: TIME_THRESHOLDS.tools.nativeTaskCleanupRetryDelayMs,
  });
}
