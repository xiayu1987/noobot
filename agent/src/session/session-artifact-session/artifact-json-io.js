/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireStorageService } from "../storage-service.js";

const OWNER = "session artifact JSON io";

export async function writeJsonWithStorage({ storageService, artifactPath, payload, atomic }) {
  const storage = requireStorageService(storageService, OWNER);
  if (atomic === true) return storage.writeJsonAtomic(artifactPath, payload);
  if (atomic === false) return storage.writeJson(artifactPath, payload);
  throw new TypeError("session artifact JSON write requires boolean atomic");
}

export async function readJsonWithStorage({ storageService, artifactPath }) {
  return requireStorageService(storageService, OWNER).readJson(artifactPath);
}

export async function readOptionalJsonWithStorage({ storageService, artifactPath }) {
  return requireStorageService(storageService, OWNER).readOptionalJson(artifactPath);
}
