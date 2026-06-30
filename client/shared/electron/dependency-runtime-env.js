/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function normalizeString(value = "") {
  return String(value || "").trim();
}

function uniqueTruthyStrings(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function pathExists(filePath = "", exists = fs.existsSync) {
  try {
    return Boolean(filePath) && exists(filePath);
  } catch {
    return false;
  }
}

function splitPathEnv(pathValue = "") {
  return normalizeString(pathValue).split(path.delimiter).map(normalizeString).filter(Boolean);
}

function resolveExecutableName(command = "", platform = process.platform) {
  const normalized = normalizeString(command);
  if (!normalized) return "";
  if (platform !== "win32" || normalized.toLowerCase().endsWith(".exe")) return normalized;
  return `${normalized}.exe`;
}

function findExecutableInPath(command = "", {
  env = process.env,
  platform = process.platform,
  exists = fs.existsSync,
} = {}) {
  const executableName = resolveExecutableName(command, platform);
  if (!executableName) return "";
  for (const directory of splitPathEnv(env.PATH || "")) {
    const candidate = path.join(directory, executableName);
    if (pathExists(candidate, exists)) return candidate;
  }
  return "";
}

function getUserDataPath(app = null) {
  try {
    if (app?.isReady?.()) return app.getPath("userData");
  } catch {
    // Fall back below.
  }
  return process.env.HOME || os.tmpdir();
}

function getManagedDependenciesRoot({ app = null } = {}) {
  return path.join(getUserDataPath(app), "managed-dependencies");
}

function getManagedBinDirs({ app = null } = {}) {
  const root = getManagedDependenciesRoot({ app });
  return [
    path.join(root, "ffmpeg", "bin"),
    path.join(root, "nodejs", "bin"),
  ];
}

function resolveFirstExistingPath(candidates = [], exists = fs.existsSync) {
  return uniqueTruthyStrings(candidates).find((candidate) => pathExists(candidate, exists)) || "";
}

function resolveLibreOfficeExecutable({
  env = process.env,
  platform = process.platform,
  exists = fs.existsSync,
} = {}) {
  const configuredCandidates = [
    env.LIBRE_OFFICE_EXE,
    env.LIBREOFFICE_EXE,
    env.SOFFICE_EXE,
    env.SOFFICE_PATH,
  ];

  if (platform === "darwin") {
    const macCandidates = [
      "/Applications/LibreOffice.app/Contents/MacOS/soffice",
      "/Applications/LibreOffice.app/Contents/MacOS/soffice.bin",
      path.join(env.HOME || "", "Applications", "LibreOffice.app", "Contents", "MacOS", "soffice"),
      path.join(env.HOME || "", "Applications", "LibreOffice.app", "Contents", "MacOS", "soffice.bin"),
    ];
    return (
      resolveFirstExistingPath([...configuredCandidates, ...macCandidates], exists) ||
      findExecutableInPath("soffice", { env, platform, exists }) ||
      findExecutableInPath("libreoffice", { env, platform, exists }) ||
      ""
    );
  }

  if (platform === "win32") {
    const programFiles = env.PROGRAMFILES || "C:\\Program Files";
    const programFilesX86 =
      env["PROGRAMFILES(X86)"] ||
      env.PROGRAMFILES_X86 ||
      "C:\\Program Files (x86)";
    const winCandidates = [
      path.join(programFiles, "LibreOffice", "program", "soffice.exe"),
      path.join(programFiles, "LibreOffice", "program", "libreoffice.exe"),
      path.join(programFilesX86, "LibreOffice", "program", "soffice.exe"),
      path.join(programFilesX86, "LibreOffice", "program", "libreoffice.exe"),
    ];
    return (
      resolveFirstExistingPath([...configuredCandidates, ...winCandidates], exists) ||
      findExecutableInPath("soffice", { env, platform, exists }) ||
      findExecutableInPath("libreoffice", { env, platform, exists }) ||
      ""
    );
  }

  const linuxCandidates = [
    "/usr/bin/libreoffice",
    "/usr/bin/soffice",
    "/snap/bin/libreoffice",
    "/opt/libreoffice/program/soffice",
    "/opt/libreoffice7.6/program/soffice",
  ];
  return (
    resolveFirstExistingPath([...configuredCandidates, ...linuxCandidates], exists) ||
    findExecutableInPath("soffice", { env, platform, exists }) ||
    findExecutableInPath("libreoffice", { env, platform, exists }) ||
    ""
  );
}

function resolveManagedBinaryPath(command = "", {
  app = null,
  platform = process.platform,
  exists = fs.existsSync,
} = {}) {
  if (platform !== "darwin") return "";
  const executableName = resolveExecutableName(command, platform);
  if (!executableName) return "";
  for (const directory of getManagedBinDirs({ app })) {
    const candidate = path.join(directory, executableName);
    if (pathExists(candidate, exists)) return candidate;
  }
  return "";
}

function resolveBinaryPath(command = "", {
  app = null,
  env = process.env,
  platform = process.platform,
  exists = fs.existsSync,
} = {}) {
  const envKey = `NOOBOT_${normalizeString(command).toUpperCase()}_PATH`;
  const configuredPath = normalizeString(env[envKey]);
  if (configuredPath) return configuredPath;
  return (
    resolveManagedBinaryPath(command, { app, platform, exists }) ||
    findExecutableInPath(command, { env, platform, exists }) ||
    ""
  );
}

function prependPathDirs(pathValue = "", dirs = []) {
  const existingParts = splitPathEnv(pathValue);
  const prependParts = uniqueTruthyStrings(dirs).filter((directory) => !existingParts.includes(directory));
  return [...prependParts, ...existingParts].join(path.delimiter);
}

export function buildDependencyRuntimeEnv({
  app = null,
  env = process.env,
  platform = process.platform,
  exists = fs.existsSync,
} = {}) {
  const ffmpegPath = resolveBinaryPath("ffmpeg", { app, env, platform, exists });
  const ffprobePath = resolveBinaryPath("ffprobe", { app, env, platform, exists });
  const libreOfficePath = resolveLibreOfficeExecutable({ env, platform, exists });
  const dependencyDirs = uniqueTruthyStrings([
    ...getManagedBinDirs({ app }).filter((directory) => pathExists(directory, exists)),
    ffmpegPath && path.dirname(ffmpegPath),
    ffprobePath && path.dirname(ffprobePath),
    libreOfficePath && path.dirname(libreOfficePath),
  ]);
  const output = {
    PATH: prependPathDirs(env.PATH || "", dependencyDirs),
  };
  if (ffmpegPath) output.NOOBOT_FFMPEG_PATH = ffmpegPath;
  if (ffprobePath) output.NOOBOT_FFPROBE_PATH = ffprobePath;
  if (libreOfficePath) {
    output.LIBRE_OFFICE_EXE = libreOfficePath;
    output.LIBREOFFICE_EXE = libreOfficePath;
    output.SOFFICE_EXE = libreOfficePath;
    output.SOFFICE_PATH = libreOfficePath;
  }
  return output;
}

export function summarizeDependencyRuntimeEnv(runtimeEnv = {}) {
  return {
    hasFfmpeg: Boolean(runtimeEnv.NOOBOT_FFMPEG_PATH),
    hasFfprobe: Boolean(runtimeEnv.NOOBOT_FFPROBE_PATH),
    hasLibreOffice: Boolean(runtimeEnv.LIBRE_OFFICE_EXE),
    ffmpegPath: runtimeEnv.NOOBOT_FFMPEG_PATH || "",
    ffprobePath: runtimeEnv.NOOBOT_FFPROBE_PATH || "",
    libreOfficePath: runtimeEnv.LIBRE_OFFICE_EXE || "",
    pathPrefix: splitPathEnv(runtimeEnv.PATH || "").slice(0, 5).join(" | "),
  };
}

