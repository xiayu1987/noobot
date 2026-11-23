/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { normalizeConnectorSecretEnvelope } from "./secrets.js";

export const CONNECTOR_INSTANCE_REGISTRY_VERSION = 3;
export const LEGACY_CONNECTOR_INSTANCE_REGISTRY_VERSION = 2;

const identityFields = [
  "connectorId",
  "ownerUserId",
  "name",
  "instanceType",
  "createdAt",
  "updatedAt",
];

function requireRecordIdentity(record, ownerUserId) {
  if (!isPlainObject(record) || !identityFields.every((field) => isCanonicalText(record[field])))
    throw new TypeError("Invalid connector instance registry record");
  if (!isCanonicalText(ownerUserId) || record.ownerUserId !== ownerUserId)
    throw new TypeError("Connector instance registry owner mismatch");
  return Object.fromEntries(identityFields.map((field) => [field, record[field]]));
}

export function requireConnectorInstanceRecord(record, ownerUserId) {
  return Object.freeze({
    ...requireRecordIdentity(record, ownerUserId),
    sealedParameters: normalizeConnectorSecretEnvelope(record.sealedParameters),
  });
}

function requireRegistry(payload, ownerUserId, version, readRecord) {
  if (!isPlainObject(payload) || payload.version !== version)
    throw new TypeError(`unsupported connector instance registry version: ${payload?.version}`);
  if (!Array.isArray(payload.connectors))
    throw new TypeError("Connector instance registry connectors must be an array");
  const ids = new Set();
  const names = new Set();
  const connectors = Array.from(payload.connectors, (source) => {
    const record = readRecord(source, ownerUserId);
    if (ids.has(record.connectorId))
      throw new TypeError(`connectorId already exists: ${record.connectorId}`);
    if (names.has(record.name))
      throw new TypeError(`connector name already exists: ${record.name}`);
    ids.add(record.connectorId);
    names.add(record.name);
    return record;
  });
  return { version, connectors };
}

export function requireConnectorInstanceRegistry(payload, ownerUserId) {
  return requireRegistry(
    payload,
    ownerUserId,
    CONNECTOR_INSTANCE_REGISTRY_VERSION,
    requireConnectorInstanceRecord,
  );
}

export function requireLegacyConnectorInstanceRegistry(payload, ownerUserId) {
  return requireRegistry(
    payload,
    ownerUserId,
    LEGACY_CONNECTOR_INSTANCE_REGISTRY_VERSION,
    (record, owner) => {
      const identity = requireRecordIdentity(record, owner);
      if (!isPlainObject(record.parameters))
        throw new TypeError("Legacy connector parameters must be an object");
      return Object.freeze({ ...identity, parameters: Object.freeze({ ...record.parameters }) });
    },
  );
}

export function requireConnectorInstanceRegistryMigration(legacy, connectors, ownerUserId) {
  const target = requireConnectorInstanceRegistry(
    { version: CONNECTOR_INSTANCE_REGISTRY_VERSION, connectors },
    ownerUserId,
  );
  const sources = new Map(legacy.connectors.map((record) => [record.connectorId, record]));
  if (
    sources.size !== target.connectors.length ||
    target.connectors.some((record) => {
      const source = sources.get(record.connectorId);
      return !source || identityFields.some((field) => record[field] !== source[field]);
    })
  )
    throw new TypeError("Connector registry migration must preserve every source identity");
  return target.connectors;
}
