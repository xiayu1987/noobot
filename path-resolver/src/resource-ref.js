/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { randomUUID } from "node:crypto";

export const RESOURCE_REF_VERSION = 1;
export const RESOURCE_KINDS = Object.freeze(["file"]);
export const RESOURCE_SOURCES = Object.freeze(["workspace", "attachment", "host"]);

function text(value = "") {
  return String(value ?? "").trim();
}

function clone(value) {
  return value && typeof value === "object" ? structuredClone(value) : value;
}

export function createResourceId() {
  return `res_${randomUUID().replaceAll("-", "")}`;
}

export function createResourceRef({
  resourceId = createResourceId(),
  kind = "file",
  owner = "",
  source = "workspace",
  logical = {},
  attachment = null,
  size = null,
  mimeType = "application/octet-stream",
  capabilities = {},
} = {}) {
  const result = {
    version: RESOURCE_REF_VERSION,
    resourceId: text(resourceId),
    kind: text(kind),
    owner: text(owner),
    source: text(source),
    logical: {
      view: text(logical?.view || source),
      path: text(logical?.path || ""),
    },
    attachment: attachment ? clone(attachment) : null,
    size: Number.isFinite(Number(size)) ? Number(size) : null,
    mimeType: text(mimeType) || "application/octet-stream",
    capabilities: {
      read: capabilities?.read === true,
      write: capabilities?.write === true,
      scriptInput: capabilities?.scriptInput === true,
    },
  };
  assertResourceRef(result);
  return Object.freeze(result);
}

export function assertResourceRef(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("resource reference must be an object");
  if (Number(value.version || RESOURCE_REF_VERSION) !== RESOURCE_REF_VERSION)
    throw new TypeError("unsupported resource reference version");
  if (!text(value.resourceId) || !/^res_[A-Za-z0-9]+$/.test(text(value.resourceId)))
    throw new TypeError("resourceId is required");
  if (!RESOURCE_KINDS.includes(text(value.kind))) throw new TypeError("invalid resource kind");
  if (!text(value.owner)) throw new TypeError("resource owner is required");
  if (!RESOURCE_SOURCES.includes(text(value.source)))
    throw new TypeError("invalid resource source");
  if (!value.logical || text(value.logical.view) !== text(value.source))
    throw new TypeError("resource logical view must match source");
  if (!text(value.logical.path)) throw new TypeError("resource logical path is required");
  if (value.source === "attachment" && (!value.attachment || typeof value.attachment !== "object"))
    throw new TypeError("attachment resource identity is required");
  return value;
}

export function isResourceRef(value = null) {
  try {
    assertResourceRef(value);
    return true;
  } catch {
    return false;
  }
}

export function projectResourceRef(value = {}) {
  assertResourceRef(value);
  return {
    version: RESOURCE_REF_VERSION,
    resourceId: value.resourceId,
    kind: value.kind,
    owner: value.owner,
    source: value.source,
    logical: clone(value.logical),
    attachment: clone(value.attachment),
    size: value.size,
    mimeType: value.mimeType,
    capabilities: clone(value.capabilities),
  };
}
