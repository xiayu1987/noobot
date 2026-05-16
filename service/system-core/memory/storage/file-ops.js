/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  access,
  appendFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";

export async function fileExists(filePath = "") {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(filePath, fallback = {}) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function writeJson(filePath, payload = {}) {
  await writeFile(filePath, JSON.stringify(payload, null, 2));
}

export async function readText(filePath, fallback = "") {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

export async function appendText(filePath, content = "") {
  await appendFile(filePath, String(content || ""), "utf8");
}

export async function ensureDir(dirPath = "") {
  await mkdir(dirPath, { recursive: true });
}

export async function safeReadDirEntries(dirPath = "") {
  try {
    return await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function removeDir(dirPath = "") {
  await rm(dirPath, { recursive: true, force: true });
}

