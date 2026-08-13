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
const NETWORK_PROXY_ENV_KEYS = Object.freeze([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
]);
const LIBREOFFICE_EXECUTABLE_ENV_KEYS = Object.freeze([
  "LIBRE_OFFICE_EXE",
  "LIBREOFFICE_EXE",
  "SOFFICE_EXE",
  "SOFFICE_PATH",
]);

export function resolveNativeLibreOfficeExecutable({
  platform = process.platform,
  sourceEnv = process.env,
} = {}) {
  for (const key of LIBREOFFICE_EXECUTABLE_ENV_KEYS) {
    const value = String(sourceEnv[key] || "").trim();
    if (value) return value;
  }
  return platform === "win32" ? "soffice.exe" : "libreoffice";
}

export function resolveNativeBrowserExecutable({
  playwrightExecutable = "",
  sourceEnv = process.env,
} = {}) {
  return String(
    sourceEnv.NOOBOT_PLAYWRIGHT_CHROMIUM_PATH ||
      sourceEnv.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      playwrightExecutable ||
      "",
  ).trim();
}

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
  for (const key of NETWORK_PROXY_ENV_KEYS) {
    if (String(sourceEnv[key] || "").trim()) environment[key] = sourceEnv[key];
  }
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
