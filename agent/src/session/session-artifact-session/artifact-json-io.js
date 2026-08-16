/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { rename } from "node:fs/promises";
import {
  readJsonArtifactFile,
  writeJsonArtifactFile,
} from "../session-artifact-files.js";

export async function writeJsonWithStorage({
  storageService = null,
  artifactPath = "",
  payload = {},
  atomic = false,
} = {}) {
  if (storageService && typeof storageService.writeJsonAtomic === "function" && atomic) {
    return storageService.writeJsonAtomic(artifactPath, payload);
  }
  if (storageService && typeof storageService.writeJson === "function") {
    return storageService.writeJson(artifactPath, payload);
  }
  if (atomic) {
    const temp = `${artifactPath}.tmp-${process.pid}-${Date.now()}`;
    await writeJsonArtifactFile(temp, payload);
    await rename(temp, artifactPath);
    return;
  }
  return writeJsonArtifactFile(artifactPath, payload);
}

export async function readJsonWithStorage({
  storageService = null,
  artifactPath = "",
  fallback = null,
} = {}) {
  if (storageService && typeof storageService.readJson === "function") {
    return storageService.readJson(artifactPath, fallback);
  }
  return readJsonArtifactFile(artifactPath, fallback);
}
