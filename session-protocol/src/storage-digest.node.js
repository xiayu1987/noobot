/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash, hash } from "node:crypto";

export function storageDigest(serialized) {
  return hash("sha256", serialized, "hex");
}

export function createStorageDigest() {
  return createHash("sha256");
}
