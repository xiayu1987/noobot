/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createLocator, locatorKey, locatorDisplayPath } from "@noobot/shared/locator";
import { PATCH_SHA256_PATTERN } from "./patch.js";

export const PATCH_READ_VERSIONS = Symbol("patchReadVersions");

export function createPatchReadVersions(observations) {
  const versions = new Map();
  for (const { locator, sha256, batch } of observations) {
    if (locator?.view === "attachment") continue;
    if (!PATCH_SHA256_PATTERN.test(sha256) || !Number.isSafeInteger(batch) || batch < 0) {
      throw new TypeError("invalid patch read observation");
    }
    const canonical = createLocator(locator);
    const key = locatorKey(canonical);
    const previous = versions.get(key);
    if (!previous || batch > previous.batch) {
      versions.set(key, { locator: canonical, batch, hashes: new Set([sha256]) });
    } else if (batch === previous.batch) {
      previous.hashes.add(sha256);
    }
  }
  return Object.freeze(
    [...versions.values()].map(({ locator, hashes }) =>
      Object.freeze({ locator, hashes: Object.freeze([...hashes]) }),
    ),
  );
}

export function resolvePatchReadVersions(targets, readVersions = []) {
  const reads = new Map(readVersions.map((entry) => [locatorKey(entry.locator), entry.hashes]));
  const missing = [];
  const versions = targets.map(({ locator, absent }) => {
    const filePath = locatorDisplayPath(locator);
    const hashes = reads.get(locatorKey(locator));
    if (absent === "required") return { filePath, sha256: null };
    if (hashes?.length === 1) return { filePath, sha256: hashes[0] };
    if (!hashes && absent === "allowed") return { filePath, sha256: null };
    missing.push(filePath);
    return null;
  });
  if (missing.length) {
    const error = new TypeError(`read these files again before patching: ${missing.join(", ")}`);
    error.details = { pathsToRead: missing };
    throw error;
  }
  return versions;
}
