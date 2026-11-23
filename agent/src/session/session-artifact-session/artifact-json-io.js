/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { SESSION_ARTIFACT_FILE_NAMES } from "../session-artifact-files.js";
import { requireStorageService } from "../storage-service.js";
import { invalidateSessionRead, memoizeSessionRead } from "../session-read-cache.js";
import { recordStorageWork } from "../session-storage-observation.js";

const OWNER = "session artifact JSON io";

function observeJsonBytes(artifactPath, operation) {
  const manifest = path.basename(artifactPath) === SESSION_ARTIFACT_FILE_NAMES.session;
  return (bytes) => {
    recordStorageWork(`json${operation}Bytes`, bytes);
    if (manifest) recordStorageWork(`manifest${operation}Bytes`, bytes);
  };
}

export async function writeJsonWithStorage({ storageService, artifactPath, payload, atomic }) {
  const storage = requireStorageService(storageService, OWNER);
  invalidateSessionRead(artifactPath);
  const options = { onWrite: observeJsonBytes(artifactPath, "Write") };
  if (atomic === true) return storage.writeJsonAtomic(artifactPath, payload, options);
  if (atomic === false) return storage.writeJson(artifactPath, payload, options);
  throw new TypeError("session artifact JSON write requires boolean atomic");
}

export async function readJsonWithStorage({
  storageService,
  artifactPath,
  immutable,
  previousValue,
}) {
  return requireStorageService(storageService, OWNER).readJson(artifactPath, {
    immutable,
    previousValue,
    onRead: observeJsonBytes(artifactPath, "Read"),
  });
}

export async function readOptionalJsonWithStorage({ storageService, artifactPath }) {
  const snapshot = await memoizeSessionRead("json", artifactPath, async () => {
    recordStorageWork("optionalJsonReads");
    const observe = observeJsonBytes(artifactPath, "Read");
    let source;
    const value = await requireStorageService(storageService, OWNER).readOptionalJson(
      artifactPath,
      {
        onRead: (bytes, content) => {
          observe(bytes);
          source = content;
        },
      },
    );
    return { source, value };
  });
  if (typeof snapshot.source !== "string") return structuredClone(snapshot.value);
  if (Object.hasOwn(snapshot, "value")) {
    const value = snapshot.value;
    delete snapshot.value;
    return value;
  }
  return JSON.parse(snapshot.source);
}
