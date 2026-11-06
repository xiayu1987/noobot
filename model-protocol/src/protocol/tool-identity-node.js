/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";

export function createNamespacedToolId(namespace, sourceId, toolId) {
  for (const value of [namespace, sourceId, toolId]) {
    if (typeof value !== "string" || !value.trim())
      throw new TypeError("tool identity requires namespace, sourceId and toolId");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(namespace)) throw new TypeError("invalid tool identity namespace");
  return `${namespace}_${createHash("sha256")
    .update(JSON.stringify([sourceId, toolId]))
    .digest("base64url")}`;
}
