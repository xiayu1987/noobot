/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";
import { resolveScopedArtifactPath } from "@noobot/path-resolver";
import { SESSION_REPAIR_ERROR_CODE } from "./errors.js";

export function stableId(prefix, parts) {
  return `${prefix}_${createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32)}`;
}

export function checkpointContentHash(payload) {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

export function resolveRepairArtifactPath(sessionDir, relativeFile, expectedRoot, extensions) {
  return resolveScopedArtifactPath({
    baseDir: sessionDir,
    reference: relativeFile,
    scopeDir: expectedRoot,
    extensions,
    errorCode: SESSION_REPAIR_ERROR_CODE.ARTIFACT_PATH_INVALID,
    errorLabel: "Session repair artifact reference",
  });
}
