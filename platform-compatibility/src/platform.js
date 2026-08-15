/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const PLATFORM = Object.freeze({
  WINDOWS: "windows",
  MACOS: "macos",
  LINUX: "linux",
});

export const SHELL = Object.freeze({
  BASH: "bash",
  WINDOWS_COMMAND: "cmd.exe",
  POSIX: "/bin/sh",
});

export function normalizePlatform(platform = "") {
  const value = String(platform || "")
    .trim()
    .toLowerCase();
  if (["win", "win32", "windows"].includes(value)) return PLATFORM.WINDOWS;
  if (["mac", "macos", "darwin", "osx"].includes(value)) return PLATFORM.MACOS;
  if (["linux", "posix"].includes(value)) return PLATFORM.LINUX;
  return "";
}

export function isCaseInsensitivePlatform(platform = "") {
  const normalized = normalizePlatform(platform);
  return normalized === PLATFORM.WINDOWS || normalized === PLATFORM.MACOS;
}

export function resolveHostShell(platform = process.platform) {
  return normalizePlatform(platform) === PLATFORM.WINDOWS ? SHELL.WINDOWS_COMMAND : SHELL.POSIX;
}
