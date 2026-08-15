/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFile } from "node:child_process";
import { normalizePlatform, PLATFORM } from "./platform.js";

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

export function resolveCommandShimExecutable(command = "", platform = process.platform) {
  const executable = String(command || "").trim();
  if (!executable) throw new TypeError("command is required");
  return normalizePlatform(platform) === PLATFORM.WINDOWS ? `${executable}.cmd` : executable;
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
    // Fall through to the platform locale used by legacy command-line programs.
  }
  if (normalizePlatform(platform) !== PLATFORM.WINDOWS) return bytes.toString("utf8");
  const normalizedLocale = String(locale || "")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-");
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
    const value = String(sourceEnv[key] || "").trim();
    if (value) return value;
  }
  return normalizePlatform(platform) === PLATFORM.WINDOWS ? "soffice.exe" : "libreoffice";
}

export function resolveBrowserExecutable({
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

export function buildRestrictedProcessEnv({
  home = "",
  temp = "",
  platform = process.platform,
  sourceEnv = process.env,
  runElectronAsNode = true,
} = {}) {
  const environment = {
    PATH: sourceEnv.PATH || "",
    HOME: home,
    TMPDIR: temp,
    LANG: "C.UTF-8",
    ...(runElectronAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
  };
  for (const key of NETWORK_PROXY_ENV_KEYS) {
    if (String(sourceEnv[key] || "").trim()) environment[key] = sourceEnv[key];
  }
  if (normalizePlatform(platform) === PLATFORM.WINDOWS) {
    for (const key of WINDOWS_PROCESS_ENV_KEYS) {
      if (String(sourceEnv[key] || "").trim()) environment[key] = sourceEnv[key];
    }
    environment.USERPROFILE = home;
    environment.TEMP = temp;
    environment.TMP = temp;
  }
  return environment;
}

export function terminateProcessTree(
  child,
  signal = "SIGTERM",
  {
    platform = process.platform,
    processGroup = usesDetachedProcessGroup(platform),
    execFileImpl = execFile,
    processKill = process.kill,
  } = {},
) {
  const pid = Number(child?.pid || 0);
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve();
  if (normalizePlatform(platform) === PLATFORM.WINDOWS) {
    return new Promise((resolve) => {
      execFileImpl("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () =>
        resolve(),
      );
    });
  }
  if (processGroup) {
    try {
      processKill(-pid, signal);
      return Promise.resolve();
    } catch {
      // Fall back to the direct child when its process group no longer exists.
    }
  }
  child.kill(signal);
  return Promise.resolve();
}
