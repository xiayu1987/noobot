/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { normalizePlatform, PLATFORM } from "./platform.js";
import { text } from "@noobot/shared/value";
import { forceStopWindowsTree } from "./windows-process-tree.js";

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
const BROWSER_PROFILE_ROOT_ENV_KEYS = Object.freeze(["NOOBOT_BROWSER_PROFILE_ROOT"]);
const HEADED_DISPLAY_ENV_KEYS = Object.freeze(["DISPLAY", "WAYLAND_DISPLAY"]);
const BROWSER_PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const WINDOWS_OUTPUT_ENCODINGS = Object.freeze({
  ja: "shift_jis",
  ko: "euc-kr",
});

export function usesDetachedProcessGroup(platform = process.platform) {
  return normalizePlatform(platform) !== PLATFORM.WINDOWS;
}

export function resolveCommandLookupExecutable(platform = process.platform) {
  return normalizePlatform(platform) === PLATFORM.WINDOWS ? "where" : "which";
}

export function decodeCommandOutput(
  value,
  { platform = process.platform, locale = Intl.DateTimeFormat().resolvedOptions().locale } = {},
) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || "");
  if (!bytes.length) return "";
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    void 0;
  }
  if (normalizePlatform(platform) !== PLATFORM.WINDOWS) return bytes.toString("utf8");
  const normalizedLocale = text(locale).toLowerCase().replaceAll("_", "-");
  const language = normalizedLocale.split("-")[0];
  const encoding =
    language === "zh"
      ? /^zh-(tw|hk|mo)(-|$)/.test(normalizedLocale)
        ? "big5"
        : "gbk"
      : WINDOWS_OUTPUT_ENCODINGS[language] || "windows-1252";
  return new TextDecoder(encoding).decode(bytes);
}

export function resolveLibreOfficeExecutable({
  platform = process.platform,
  sourceEnv = process.env,
} = {}) {
  for (const key of LIBREOFFICE_EXECUTABLE_ENV_KEYS) {
    const value = text(sourceEnv[key]);
    if (value) return value;
  }
  return normalizePlatform(platform) === PLATFORM.WINDOWS ? "soffice.com" : "libreoffice";
}

export function resolveBrowserExecutable({
  playwrightExecutable = "",
  sourceEnv = process.env,
} = {}) {
  return text(
    sourceEnv.NOOBOT_PLAYWRIGHT_CHROMIUM_PATH ||
      sourceEnv.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      playwrightExecutable,
  );
}

export function buildRestrictedProcessEnv({
  home = "",
  temp = "",
  platform = process.platform,
  sourceEnv = process.env,
  runElectronAsNode = true,
} = {}) {
  return buildRestrictedProcessEnvironment({
    home,
    temp,
    platform,
    sourceEnv,
    runElectronAsNode,
  });
}

export function resolveBrowserProfileRoot({ sourceEnv = process.env } = {}) {
  for (const key of BROWSER_PROFILE_ROOT_ENV_KEYS) {
    const value = text(sourceEnv[key]);
    if (value) return value;
  }
  return "";
}

export function isBrowserProfileNameAllowed(value) {
  return BROWSER_PROFILE_NAME_PATTERN.test(String(value || ""));
}

export function supportsHeadedBrowser({
  platform = process.platform,
  sourceEnv = process.env,
} = {}) {
  if (normalizePlatform(platform) !== PLATFORM.LINUX) return true;
  return HEADED_DISPLAY_ENV_KEYS.some((key) => text(sourceEnv[key]).length > 0);
}

function buildRestrictedProcessEnvironment({ home, temp, platform, sourceEnv, runElectronAsNode }) {
  const environment = {
    PATH: sourceEnv.PATH || "",
    HOME: home,
    TMPDIR: temp,
    LANG: "C.UTF-8",
    ...(runElectronAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
  };
  for (const key of NETWORK_PROXY_ENV_KEYS) {
    if (text(sourceEnv[key])) environment[key] = sourceEnv[key];
  }
  if (normalizePlatform(platform) === PLATFORM.WINDOWS) {
    for (const key of WINDOWS_PROCESS_ENV_KEYS) {
      if (text(sourceEnv[key])) environment[key] = sourceEnv[key];
    }
    environment.USERPROFILE = home;
    environment.TEMP = temp;
    environment.TMP = temp;
  }
  return environment;
}

function signalProcessGroup(target, signal, processKill) {
  try {
    processKill(target, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function processTargetExists(target, processKill) {
  try {
    processKill(target, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

export function isProcessAlive(pid) {
  return Number.isInteger(pid) && pid > 0 && processTargetExists(pid, process.kill);
}

async function waitForProcessRemoval(target, timeoutMs, processKill) {
  const deadline = performance.now() + timeoutMs;
  while (processTargetExists(target, processKill)) {
    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0) return false;
    await delay(Math.min(10, remainingMs));
  }
  return true;
}

export async function terminateProcessTree(
  pid,
  {
    graceMs,
    settleMs,
    controlTimeoutMs,
    platform = process.platform,
    execFileImpl = execFile,
    processKill = process.kill,
  },
) {
  if (!Number.isInteger(pid) || pid <= 0) throw new TypeError("Process tree PID is required");
  if (!Number.isFinite(graceMs) || graceMs < 0 || !Number.isFinite(settleMs) || settleMs <= 0) {
    throw new TypeError("Process tree termination requires valid graceMs and settleMs");
  }
  if (!Number.isFinite(controlTimeoutMs) || controlTimeoutMs <= 0) {
    throw new TypeError("Process tree termination requires a positive controlTimeoutMs");
  }
  if (!usesDetachedProcessGroup(platform)) {
    return forceStopWindowsTree(pid, { execFileImpl, settleMs, controlTimeoutMs });
  }
  const target = -pid;
  if (graceMs > 0) {
    signalProcessGroup(target, "SIGTERM", processKill);
    if (await waitForProcessRemoval(target, graceMs, processKill)) return;
  }
  signalProcessGroup(target, "SIGKILL", processKill);
  if (!(await waitForProcessRemoval(target, settleMs, processKill))) {
    throw new Error(`Process tree ${pid} did not exit after forced termination`);
  }
}

export function createProcessTreeTerminator(
  child,
  { graceMs, settleMs, controlTimeoutMs, onTerminate, terminateProcess = terminateProcessTree },
) {
  let operation = null;
  let retry = false;

  return {
    terminate() {
      if (retry) operation = null;
      retry = false;
      operation ??= Promise.allSettled([
        Promise.resolve().then(() => onTerminate?.()),
        Promise.resolve().then(() => {
          if (child.pid === undefined) return;
          return terminateProcess(child.pid, { graceMs, settleMs, controlTimeoutMs });
        }),
      ])
        .then((results) => {
          const errors = results
            .filter((result) => result.status === "rejected")
            .map((r) => r.reason);
          if (errors.length === 1) throw errors[0];
          if (errors.length > 1) throw new AggregateError(errors, "Process tree cleanup failed");
        })
        .catch((error) => {
          retry = true;
          throw error;
        });
      return operation;
    },
    wait() {
      return operation;
    },
  };
}
