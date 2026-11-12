/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath } from "./platform.js";
import { isPathWithinRoot } from "./path-contract.js";

export const SCOPED_ARTIFACT_PATH_ERROR = "SCOPED_ARTIFACT_PATH_INVALID";

export function normalizeScopedArtifactReference(reference = "") {
  return String(reference || "").replaceAll("\\", "/");
}

function resolveValidScopedArtifactPath({ baseDir, reference, scopeDir, extensions }) {
  const normalizedReference = normalizeScopedArtifactReference(reference);
  if (!normalizedReference) return null;
  if (filePath.isAbsolute(normalizedReference)) return null;
  if (normalizedReference.includes("\0")) return null;
  const normalized = filePath.normalize(normalizedReference);
  if (normalized === "." || normalized.startsWith(`..${filePath.sep}`)) return null;
  const resolved = filePath.resolve(baseDir, normalized);
  if (!isPathWithinRoot(filePath.resolve(baseDir, scopeDir), resolved)) return null;
  if (extensions.length && !extensions.includes(filePath.extname(resolved))) return null;
  return resolved;
}

export function isScopedArtifactReferenceValid({
  baseDir = "",
  reference = "",
  scopeDir = "",
  extensions = [],
} = {}) {
  return resolveValidScopedArtifactPath({ baseDir, reference, scopeDir, extensions }) !== null;
}

export function resolveScopedArtifactPath({
  baseDir = "",
  reference = "",
  scopeDir = "",
  extensions = [],
  errorCode = SCOPED_ARTIFACT_PATH_ERROR,
  errorLabel = "scoped artifact reference",
} = {}) {
  const resolved = resolveValidScopedArtifactPath({ baseDir, reference, scopeDir, extensions });
  if (resolved === null) {
    const error = new Error(
      `invalid ${errorLabel}: ${normalizeScopedArtifactReference(reference)}`,
    );
    error.code = errorCode;
    throw error;
  }
  return resolved;
}
