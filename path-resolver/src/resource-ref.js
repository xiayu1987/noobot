/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { randomUUID } from "node:crypto";
import { text, isPlainObject, isObjectLike } from "@noobot/shared/value";
import { createLocator, isCanonicalLocator } from "@noobot/shared/locator";

const RESOURCE_REF_VERSION = 1;
const RESOURCE_KINDS = Object.freeze(["file"]);
const RESOURCE_SOURCES = Object.freeze(["workspace", "mount", "attachment", "host"]);

function normalizeLogical(logical = {}) {
  const view = text(logical?.view);
  if (view === "attachment") return { view, path: text(logical?.path) };
  return { ...createLocator(logical) };
}

function clone(value) {
  return value && typeof value === "object" ? structuredClone(value) : value;
}

function createResourceId() {
  return `res_${randomUUID().replaceAll("-", "")}`;
}

function normalizeCapabilities(capabilities = {}) {
  return {
    read: capabilities?.read === true,
    write: capabilities?.write === true,
    scriptInput: capabilities?.scriptInput === true,
  };
}

export function createResourceRef({
  resourceId = createResourceId(),
  kind = "file",
  owner = "",
  logical = {},
  attachment = null,
  origin,
  size = null,
  mimeType,
  capabilities = {},
} = {}) {
  const normalizedLogical = normalizeLogical(logical);
  const result = {
    version: RESOURCE_REF_VERSION,
    resourceId: text(resourceId),
    kind: text(kind),
    owner: text(owner),
    source: normalizedLogical.view,
    logical: normalizedLogical,
    attachment: attachment ? clone(attachment) : null,
    ...(origin === undefined ? {} : { origin: clone(origin) }),
    size: Number.isFinite(Number(size)) ? Number(size) : null,
    mimeType: text(mimeType),
    capabilities: normalizeCapabilities(capabilities),
  };
  assertResourceRef(result);
  return Object.freeze(result);
}

function assertResourceRef(value = {}) {
  if (!isPlainObject(value)) throw new TypeError("resource reference must be an object");
  if (value.version !== RESOURCE_REF_VERSION)
    throw new TypeError("unsupported resource reference version");
  if (!text(value.resourceId) || !/^res_[A-Za-z0-9]+$/.test(text(value.resourceId)))
    throw new TypeError("resourceId is required");
  if (!RESOURCE_KINDS.includes(text(value.kind))) throw new TypeError("invalid resource kind");
  if (!text(value.owner)) throw new TypeError("resource owner is required");
  if (!RESOURCE_SOURCES.includes(text(value.source)))
    throw new TypeError("invalid resource source");
  if (!isPlainObject(value.logical) || text(value.logical.view) !== text(value.source))
    throw new TypeError("resource logical view must match source");
  if (value.source === "attachment") {
    if (!text(value.logical.path)) throw new TypeError("resource logical path is required");
  } else if (!isCanonicalLocator(value.logical)) {
    throw new TypeError("resource logical must be a canonical locator");
  }
  if (value.source === "attachment" && !isObjectLike(value.attachment))
    throw new TypeError("attachment resource identity is required");
  if (value.origin !== undefined) {
    if (value.source !== "attachment")
      throw new TypeError("resource origin is only allowed on attachment resources");
    if (!isCanonicalLocator(value.origin))
      throw new TypeError("resource origin must be a canonical locator");
  }
  if (!text(value.mimeType)) throw new TypeError("resource mimeType is required");
  return value;
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
    ...(value.origin === undefined ? {} : { origin: clone(value.origin) }),
    size: value.size,
    mimeType: value.mimeType,
    capabilities: clone(value.capabilities),
  };
}
