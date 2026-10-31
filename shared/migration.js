/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction, text } from "./value.js";

export const MIGRATION_UNMAPPABLE_CODE = "MIGRATION_UNMAPPABLE";

export function createMigrationError({ kind = "", fromVersion, reason = "", details = {} } = {}) {
  const source = Number.isInteger(fromVersion) ? `v${fromVersion}` : "unknown version";
  const error = new Error(`${kind} migration from ${source} is unmappable: ${reason}`);
  error.code = MIGRATION_UNMAPPABLE_CODE;
  error.details = { kind, fromVersion, reason, ...details };
  return error;
}

export function defineVersionChain({ kind, currentVersion, readVersion, schemas, steps }) {
  const normalizedKind = text(kind);
  if (!normalizedKind) throw new TypeError("version chain requires kind");
  if (!Number.isInteger(currentVersion)) {
    throw new TypeError(`${normalizedKind} version chain requires integer currentVersion`);
  }
  if (!isFunction(readVersion)) {
    throw new TypeError(`${normalizedKind} version chain requires readVersion`);
  }
  if (!Array.isArray(steps)) throw new TypeError(`${normalizedKind} version chain requires steps`);
  const byFrom = new Map();
  for (const step of steps) {
    if (!Number.isInteger(step?.from) || step.to !== step.from + 1 || !isFunction(step.migrate)) {
      throw new TypeError(`${normalizedKind} version chain step must map vN to vN+1`);
    }
    if (step.to > currentVersion) {
      throw new TypeError(`${normalizedKind} version chain step exceeds v${currentVersion}`);
    }
    if (byFrom.has(step.from)) {
      throw new TypeError(`${normalizedKind} version chain has duplicate step from v${step.from}`);
    }
    byFrom.set(step.from, step);
  }
  const oldest = steps.length ? Math.min(...byFrom.keys()) : currentVersion;
  for (let version = oldest; version <= currentVersion; version += 1) {
    if (!isFunction(schemas?.[version])) {
      throw new TypeError(`${normalizedKind} version chain is missing schema for v${version}`);
    }
  }
  for (let version = oldest; version < currentVersion; version += 1) {
    if (!byFrom.has(version)) {
      throw new TypeError(`${normalizedKind} version chain is missing step from v${version}`);
    }
  }
  return Object.freeze({
    kind: normalizedKind,
    currentVersion,
    readVersion,
    schemas: Object.freeze({ ...schemas }),
    oldest,
    byFrom,
  });
}

function assertVersionSchema(chain, document, { version, fromVersion, stage }) {
  try {
    chain.schemas[version](document);
  } catch (cause) {
    throw Object.assign(
      createMigrationError({
        kind: chain.kind,
        fromVersion,
        reason: "version_schema_rejected",
        details: { version, stage, message: cause.message },
      }),
      { cause },
    );
  }
}

export function runVersionChain(chain, document, context = {}) {
  const fromVersion = chain.readVersion(document);
  if (fromVersion === chain.currentVersion) {
    assertVersionSchema(chain, document, { version: fromVersion, fromVersion, stage: "input" });
    return { document, fromVersion, toVersion: fromVersion, migrated: false };
  }
  if (!Number.isInteger(fromVersion) || fromVersion < chain.oldest) {
    throw createMigrationError({
      kind: chain.kind,
      fromVersion,
      reason: "unsupported_version",
      details: { oldestSupportedVersion: chain.oldest },
    });
  }
  if (fromVersion > chain.currentVersion) {
    throw createMigrationError({ kind: chain.kind, fromVersion, reason: "future_version" });
  }
  let current = document;
  for (let version = fromVersion; version < chain.currentVersion; version += 1) {
    assertVersionSchema(chain, current, { version, fromVersion: version, stage: "input" });
    current = chain.byFrom.get(version).migrate(current, context);
    if (chain.readVersion(current) !== version + 1) {
      throw createMigrationError({
        kind: chain.kind,
        fromVersion: version,
        reason: "step_did_not_advance_version",
      });
    }
    assertVersionSchema(chain, current, {
      version: version + 1,
      fromVersion: version,
      stage: "output",
    });
  }
  return { document: current, fromVersion, toVersion: chain.currentVersion, migrated: true };
}
