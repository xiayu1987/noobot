/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const AGENT_CONFIG_PROTOCOL_NAME = "noobot.agent-config";
export const AGENT_CONFIG_PROTOCOL_VERSION = 1;

export function createConfigSnapshot({
  config = {},
  policies = {},
  scope = {},
  metadata = {},
} = {}) {
  const sourceMetadata =
    metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const normalizedMetadata = {
    ...sourceMetadata,
    migrations: Object.freeze([
      ...(Array.isArray(sourceMetadata.migrations) ? sourceMetadata.migrations : []),
    ]),
    warnings: Object.freeze([
      ...(Array.isArray(sourceMetadata.warnings) ? sourceMetadata.warnings : []),
    ]),
  };
  return Object.freeze({
    protocol: AGENT_CONFIG_PROTOCOL_NAME,
    version: AGENT_CONFIG_PROTOCOL_VERSION,
    scope: Object.freeze({ ...scope }),
    config: Object.freeze({ ...config }),
    policies: Object.freeze({ ...policies }),
    metadata: Object.freeze(normalizedMetadata),
  });
}

export function validateConfigSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("agent config snapshot must be an object");
  }
  if (snapshot.protocol !== AGENT_CONFIG_PROTOCOL_NAME) {
    throw new TypeError(`invalid agent config protocol: ${String(snapshot.protocol || "")}`);
  }
  if (snapshot.version !== AGENT_CONFIG_PROTOCOL_VERSION) {
    throw new TypeError(`unsupported agent config protocol version: ${String(snapshot.version)}`);
  }
  return snapshot;
}
