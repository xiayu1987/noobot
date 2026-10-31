/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "./value.js";

export const LOCATOR_VIEW = Object.freeze({
  WORKSPACE: "workspace",
  HOST: "host",
  MOUNT: "mount",
});
export const LOCATOR_VIEWS = Object.freeze(Object.values(LOCATOR_VIEW));

export const LOCATOR_ERROR_CODE = Object.freeze({
  INVALID_VIEW: "locator_invalid_view",
  INVALID_PATH: "locator_invalid_path",
  INVALID_ENCODING: "locator_invalid_encoding",
  INVALID_SEGMENT: "locator_invalid_segment",
  UNC_UNSUPPORTED: "locator_unc_unsupported",
  HOST_NOT_ABSOLUTE: "locator_host_path_not_absolute",
  WORKSPACE_ABSOLUTE: "locator_workspace_path_absolute",
  MOUNT_NOT_POSIX_ABSOLUTE: "locator_mount_not_posix_absolute",
});

export class LocatorError extends TypeError {
  constructor(code, details = {}) {
    super(code);
    this.name = "LocatorError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const BACKSLASH = String.fromCharCode(92);
const FILE_URI_PREFIX = "file://";

function hasDriveRoot(path) {
  return path.length >= 3 && /[A-Za-z]/.test(path[0]) && path[1] === ":" && path[2] === "/";
}

function assertPathText(value) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new LocatorError(LOCATOR_ERROR_CODE.INVALID_PATH);
  }
}

function canonicalSegments(rest) {
  const segments = rest.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0) throw new LocatorError(LOCATOR_ERROR_CODE.INVALID_PATH);
  if (segments.includes("..")) throw new LocatorError(LOCATOR_ERROR_CODE.INVALID_SEGMENT);
  return segments.join("/");
}

export function normalizeHostPath(value) {
  assertPathText(value);
  let path = value;
  if (path.toLowerCase().startsWith(FILE_URI_PREFIX)) {
    try {
      path = decodeURIComponent(path.slice(FILE_URI_PREFIX.length));
    } catch {
      throw new LocatorError(LOCATOR_ERROR_CODE.INVALID_ENCODING);
    }
    if (path[0] === "/" && hasDriveRoot(path.slice(1))) path = path.slice(1);
  }
  path = path.split(BACKSLASH).join("/");
  if (path.startsWith("//")) throw new LocatorError(LOCATOR_ERROR_CODE.UNC_UNSUPPORTED);
  if (hasDriveRoot(path)) return `${path[0].toUpperCase()}:/${canonicalSegments(path.slice(3))}`;
  if (path[0] === "/") return `/${canonicalSegments(path.slice(1))}`;
  throw new LocatorError(LOCATOR_ERROR_CODE.HOST_NOT_ABSOLUTE);
}

export function normalizeWorkspacePath(value) {
  assertPathText(value);
  const path = value.split(BACKSLASH).join("/");
  if (path[0] === "/" || /^[A-Za-z]:/.test(path) || /^file:/i.test(path)) {
    throw new LocatorError(LOCATOR_ERROR_CODE.WORKSPACE_ABSOLUTE);
  }
  return canonicalSegments(path);
}

export function normalizeMountPath(value) {
  assertPathText(value);
  if (value[0] !== "/" || value.includes(BACKSLASH)) {
    throw new LocatorError(LOCATOR_ERROR_CODE.MOUNT_NOT_POSIX_ABSOLUTE);
  }
  return `/${canonicalSegments(value.slice(1))}`;
}

function normalizeLocatorFields(value) {
  if (!isPlainObject(value)) throw new LocatorError(LOCATOR_ERROR_CODE.INVALID_VIEW);
  const { view } = value;
  if (view === LOCATOR_VIEW.HOST) return { view, path: normalizeHostPath(value.path) };
  if (view === LOCATOR_VIEW.WORKSPACE) return { view, path: normalizeWorkspacePath(value.path) };
  if (view === LOCATOR_VIEW.MOUNT) {
    return {
      view,
      mount: normalizeMountPath(value.mount),
      path: normalizeWorkspacePath(value.path),
    };
  }
  throw new LocatorError(LOCATOR_ERROR_CODE.INVALID_VIEW, { view });
}

export function createLocator(value) {
  return Object.freeze(normalizeLocatorFields(value));
}

export function isCanonicalLocator(value) {
  let canonical;
  try {
    canonical = normalizeLocatorFields(value);
  } catch (error) {
    if (error instanceof LocatorError) return false;
    throw error;
  }
  const keys = Object.keys(value);
  return (
    keys.length === Object.keys(canonical).length &&
    keys.every((key) => value[key] === canonical[key])
  );
}

export function locatorKey(locator) {
  if (!isCanonicalLocator(locator)) throw new LocatorError(LOCATOR_ERROR_CODE.INVALID_PATH);
  if (locator.view === LOCATOR_VIEW.MOUNT) return `mount:${locator.mount}:${locator.path}`;
  return `${locator.view}:${locator.path}`;
}

export function locatorDisplayPath(locator) {
  if (!isCanonicalLocator(locator)) throw new LocatorError(LOCATOR_ERROR_CODE.INVALID_PATH);
  if (locator.view === LOCATOR_VIEW.MOUNT) return `${locator.mount}/${locator.path}`;
  return locator.path;
}
