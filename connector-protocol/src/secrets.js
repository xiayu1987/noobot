/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CONNECTOR_SECRET_ENVELOPE_VERSION = 1;
export const CONNECTOR_SECRET_ALGORITHM = "aes-256-gcm";
export const CONNECTOR_SECRET_KDF = "scrypt";

const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
};

export function createConnectorSecretAad({ userId, connectorId, instanceType } = {}) {
  return JSON.stringify({
    protocol: "noobot.connector.parameters",
    version: CONNECTOR_SECRET_ENVELOPE_VERSION,
    userId: requiredText(userId, "connector secret userId"),
    connectorId: requiredText(connectorId, "connector secret connectorId"),
    instanceType: requiredText(instanceType, "connector secret instanceType"),
  });
}

export function normalizeConnectorSecretEnvelope(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const envelope = {
    version: Number(source.version),
    algorithm: String(source.algorithm || "").trim(),
    iv: requiredText(source.iv, "connector secret iv"),
    tag: requiredText(source.tag, "connector secret authentication tag"),
    ciphertext: requiredText(source.ciphertext, "connector secret ciphertext"),
  };
  if (envelope.version !== CONNECTOR_SECRET_ENVELOPE_VERSION) {
    throw new TypeError(`unsupported connector secret envelope version: ${source.version}`);
  }
  if (envelope.algorithm !== CONNECTOR_SECRET_ALGORITHM) {
    throw new TypeError(`unsupported connector secret algorithm: ${envelope.algorithm}`);
  }
  return Object.freeze(envelope);
}

export function isConnectorSecretEnvelope(input) {
  try {
    normalizeConnectorSecretEnvelope(input);
    return true;
  } catch {
    return false;
  }
}
