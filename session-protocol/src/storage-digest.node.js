/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";

export function storageDigest(serialized) {
  return createHash("sha256").update(serialized).digest("hex");
}
