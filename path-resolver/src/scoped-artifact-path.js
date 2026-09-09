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

export function isScopedArtifactReferenceValid({
  baseDir = "",
  reference = "",
  scopeDir = "",
  extensions = [],
} = {}) {
  const normalizedReference = normalizeScopedArtifactReference(reference);
  if (!normalizedReference) return false;
  if (filePath.isAbsolute(normalizedReference)) return false;
  if (normalizedReference.includes("\0")) return false;
  const normalized = filePath.normalize(normalizedReference);
  if (normalized === "." || normalized.startsWith(`..${filePath.sep}`)) return false;
  const scopeRoot = filePath.resolve(baseDir, scopeDir);
  const resolved = filePath.resolve(baseDir, normalized);
  if (!isPathWithinRoot(scopeRoot, resolved)) return false;
  if (extensions.length && !extensions.includes(filePath.extname(resolved))) return false;
  return true;
}

export function resolveScopedArtifactPath({
  baseDir = "",
  reference = "",
  scopeDir = "",
  extensions = [],
  errorCode = SCOPED_ARTIFACT_PATH_ERROR,
  errorLabel = "scoped artifact reference",
} = {}) {
  const normalizedReference = normalizeScopedArtifactReference(reference);
  if (!isScopedArtifactReferenceValid({ baseDir, reference, scopeDir, extensions })) {
    const error = new Error(`invalid ${errorLabel}: ${normalizedReference}`);
    error.code = errorCode;
    throw error;
  }
  return filePath.resolve(baseDir, filePath.normalize(normalizedReference));
}
