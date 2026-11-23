/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { storageDigest } from "#storage-digest";

export const SESSION_REQUEST_DIGEST_BYTES = storageDigest("").length / 2;

export function requireSessionRequestDigest(digest) {
  if (
    typeof digest !== "string" ||
    digest.length !== SESSION_REQUEST_DIGEST_BYTES * 2 ||
    /[^a-f0-9]/.test(digest)
  )
    throw new TypeError("Invalid transaction request digest");
}

export function sessionRequestDigest(expectedGeneration, input) {
  return storageDigest(JSON.stringify({ expectedGeneration, input }));
}
