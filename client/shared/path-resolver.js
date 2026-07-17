/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

// The default facade is the only Node-filesystem path API exposed to client
// code. Keeping it here makes local filesystem operations auditable while the
// explicit helpers below handle paths originating on another platform.
export const clientFilePath = Object.freeze({
  basename: (...args) => path.basename(...args),
  dirname: (...args) => path.dirname(...args),
  extname: (...args) => path.extname(...args),
  format: (...args) => path.format(...args),
  isAbsolute: (...args) => path.isAbsolute(...args),
  join: (...args) => path.join(...args),
  normalize: (...args) => path.normalize(...args),
  parse: (...args) => path.parse(...args),
  relative: (...args) => path.relative(...args),
  resolve: (...args) => path.resolve(...args),
  delimiter: path.delimiter,
  sep: path.sep,
});

export default clientFilePath;

export const CLIENT_PATH_PLATFORMS = Object.freeze({ WINDOWS: "windows", MACOS: "macos", LINUX: "linux" });
export const CLIENT_PATH_VIEWS = Object.freeze({ HOST: "host", SANDBOX: "sandbox", CLIENT: "client" });

export function normalizeClientPath(value = "", { platform = "" } = {}) {
  const api = platform === CLIENT_PATH_PLATFORMS.WINDOWS ? path.win32 : path.posix;
  return api.normalize(String(value || "")).replaceAll("\\", "/");
}

export function joinClientPath(basePath = "", ...segments) {
  const platform = /^[a-z]:[\\/]|^\\\\/i.test(String(basePath)) ? CLIENT_PATH_PLATFORMS.WINDOWS : "";
  const api = platform === CLIENT_PATH_PLATFORMS.WINDOWS ? path.win32 : path.posix;
  return api.join(basePath, ...segments).replaceAll("\\", "/");
}

export function isAbsoluteClientPath(value = "", { platform = "" } = {}) {
  const detected = platform || (/^[a-z]:[\\/]|^\\\\/i.test(String(value)) ? CLIENT_PATH_PLATFORMS.WINDOWS : "");
  return (detected === CLIENT_PATH_PLATFORMS.WINDOWS ? path.win32 : path.posix).isAbsolute(String(value || ""));
}

export function clientPathBasename(value = "", { platform = "" } = {}) {
  const detected = platform || (/^[a-z]:[\\/]|^\\\\/i.test(String(value)) ? CLIENT_PATH_PLATFORMS.WINDOWS : "");
  return (detected === CLIENT_PATH_PLATFORMS.WINDOWS ? path.win32 : path.posix).basename(String(value || ""));
}

export function clientPathDirname(value = "", { platform = "" } = {}) {
  const detected = platform || (/^[a-z]:[\\/]|^\\\\/i.test(String(value)) ? CLIENT_PATH_PLATFORMS.WINDOWS : "");
  return (detected === CLIENT_PATH_PLATFORMS.WINDOWS ? path.win32 : path.posix).dirname(String(value || "")).replaceAll("\\", "/");
}

export function clientPathDelimiter(platform = "") {
  return platform === CLIENT_PATH_PLATFORMS.WINDOWS || platform === "win32" ? ";" : ":";
}

export function createDesktopPathEnvironment({ entryUrl, platform, iconName }) {
  const filename = fileURLToPath(entryUrl);
  const dirname = path.dirname(filename);
  return {
    projectDir: path.resolve(dirname, "..", ".."),
    repoRoot: path.resolve(dirname, "..", "..", "..", ".."),
    windowIcon: path.join(dirname, "..", "..", "assets", iconName),
    pathSemantic: { sourcePlatform: platform, sourceView: CLIENT_PATH_VIEWS.CLIENT },
  };
}

export function applyDesktopPathEnvironment(options) {
  const resolved = createDesktopPathEnvironment(options);
  process.env.NOOBOT_DESKTOP_PROJECT_DIR ||= resolved.projectDir;
  process.env.NOOBOT_DESKTOP_REPO_ROOT ||= resolved.repoRoot;
  process.env.NOOBOT_DESKTOP_WINDOW_ICON ||= resolved.windowIcon;
  process.env.NOOBOT_CLIENT_PATH_PLATFORM ||= resolved.pathSemantic.sourcePlatform;
  process.env.NOOBOT_CLIENT_PATH_VIEW ||= resolved.pathSemantic.sourceView;
  return resolved;
}
