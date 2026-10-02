/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKSPACE_OPERATION } from "./sections.js";

export const WORKSPACE_ASSET_STATE_VERSION = 1;

export const WORKSPACE_ASSET_ACTION = Object.freeze({
  INSTALL: "install",
  UPDATE: "update",
  REMOVE: "remove",
  KEEP: "keep",
});

export const WORKSPACE_ASSET_REASON = Object.freeze({
  MISSING: "missing",
  UP_TO_DATE: "up_to_date",
  PRISTINE_OUTDATED: "pristine_outdated",
  USER_MODIFIED: "user_modified",
  RETIRED: "retired",
});

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function stateError(message) {
  const error = new TypeError(message);
  error.code = "WORKSPACE_ASSET_STATE_INVALID";
  return error;
}

function requireHashMap(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object of relative path to sha256`);
  }
  for (const [relativePath, hash] of Object.entries(value)) {
    if (!relativePath || relativePath.startsWith("/") || relativePath.split("/").includes("..")) {
      throw new TypeError(`${label} has invalid relative path: ${relativePath}`);
    }
    if (!SHA256_PATTERN.test(String(hash))) {
      throw new TypeError(`${label} has invalid sha256 at ${relativePath}`);
    }
  }
  return value;
}

export function createEmptyWorkspaceAssetState() {
  return { version: WORKSPACE_ASSET_STATE_VERSION, files: {} };
}

export function parseWorkspaceAssetState(text) {
  let value;
  try {
    value = JSON.parse(String(text ?? ""));
  } catch {
    throw stateError("workspace asset state is not valid JSON");
  }
  if (value?.version !== WORKSPACE_ASSET_STATE_VERSION) {
    throw stateError(`workspace asset state must be version ${WORKSPACE_ASSET_STATE_VERSION}`);
  }
  try {
    requireHashMap(value.files, "workspace asset state files");
  } catch (error) {
    throw stateError(error.message);
  }
  return { version: WORKSPACE_ASSET_STATE_VERSION, files: { ...value.files } };
}

export function renderWorkspaceAssetState(state) {
  const files = requireHashMap(state?.files, "workspace asset state files");
  const sorted = Object.fromEntries(
    Object.keys(files)
      .sort()
      .map((key) => [key, files[key]]),
  );
  return `${JSON.stringify({ version: WORKSPACE_ASSET_STATE_VERSION, files: sorted }, null, 2)}\n`;
}

function entry(relativePath, action, reason) {
  return Object.freeze({ relativePath, action, reason });
}

function planSyncFile(relativePath, packageHash, installedHash, userHash) {
  if (!userHash)
    return entry(relativePath, WORKSPACE_ASSET_ACTION.INSTALL, WORKSPACE_ASSET_REASON.MISSING);
  if (userHash === packageHash) {
    return entry(relativePath, WORKSPACE_ASSET_ACTION.KEEP, WORKSPACE_ASSET_REASON.UP_TO_DATE);
  }
  if (installedHash && userHash === installedHash) {
    return entry(
      relativePath,
      WORKSPACE_ASSET_ACTION.UPDATE,
      WORKSPACE_ASSET_REASON.PRISTINE_OUTDATED,
    );
  }
  return entry(relativePath, WORKSPACE_ASSET_ACTION.KEEP, WORKSPACE_ASSET_REASON.USER_MODIFIED);
}

function planRetiredFile(relativePath, installedHash, userHash) {
  if (!userHash || userHash !== installedHash) return null;
  return entry(relativePath, WORKSPACE_ASSET_ACTION.REMOVE, WORKSPACE_ASSET_REASON.RETIRED);
}

function planFile(operation, relativePath, packageHash, installedHash, userHash) {
  if (operation === WORKSPACE_OPERATION.SYNC) {
    return planSyncFile(relativePath, packageHash, installedHash, userHash);
  }
  if (operation === WORKSPACE_OPERATION.REPAIR && (userHash || installedHash)) return null;
  return entry(relativePath, WORKSPACE_ASSET_ACTION.INSTALL, WORKSPACE_ASSET_REASON.MISSING);
}

function nextInstalledHash(planned, packageHash, installedHash, userHash) {
  if (!planned) return userHash === packageHash ? packageHash : installedHash;
  if (planned.reason === WORKSPACE_ASSET_REASON.USER_MODIFIED) return installedHash;
  return packageHash;
}

export function planWorkspaceAssetSync({
  operation,
  packageFiles = {},
  installedState = createEmptyWorkspaceAssetState(),
  userFiles = {},
} = {}) {
  if (!Object.values(WORKSPACE_OPERATION).includes(operation)) {
    throw new TypeError(`unsupported workspace operation: ${operation}`);
  }
  requireHashMap(packageFiles, "package files");
  requireHashMap(userFiles, "user files");
  const installed = requireHashMap(installedState?.files, "workspace asset state files");
  const actions = [];
  const nextFiles = {};
  for (const relativePath of Object.keys(packageFiles).sort()) {
    const packageHash = packageFiles[relativePath];
    const userHash = userFiles[relativePath];
    const installedHash = installed[relativePath];
    const planned = planFile(operation, relativePath, packageHash, installedHash, userHash);
    if (planned) actions.push(planned);
    const nextHash = nextInstalledHash(planned, packageHash, installedHash, userHash);
    if (nextHash) nextFiles[relativePath] = nextHash;
  }
  if (operation === WORKSPACE_OPERATION.SYNC) {
    for (const relativePath of Object.keys(installed).sort()) {
      if (packageFiles[relativePath]) continue;
      const planned = planRetiredFile(
        relativePath,
        installed[relativePath],
        userFiles[relativePath],
      );
      if (planned) actions.push(planned);
    }
  }
  return Object.freeze({
    actions: Object.freeze(actions),
    nextState: { version: WORKSPACE_ASSET_STATE_VERSION, files: nextFiles },
  });
}
