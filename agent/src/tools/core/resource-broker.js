/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { stat } from "node:fs/promises";
import {
  createResourceRef,
  filePath as path,
  isResourceRef,
  projectResourceRef,
  resolvePathRef,
} from "@noobot/path-resolver";
import {
  getBasePathFromAgentContext,
  getRuntimeFromAgentContext,
} from "../../context/agent-context-accessor.js";
import { EXTENSION_TO_MIME, DEFAULT_MIME_TYPE } from "../../shared/constants/index.js";

const registries = new WeakMap();

function getRegistry(agentContext = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  if (!runtime || typeof runtime !== "object") throw new Error("runtime context required");
  let registry = registries.get(runtime);
  if (!registry) {
    registry = { byId: new Map(), byKey: new Map() };
    registries.set(runtime, registry);
  }
  return registry;
}

function ownerOf(agentContext = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  return String(runtime?.userId || agentContext?.userId || "").trim();
}

export async function registerResource({
  agentContext,
  executionPath,
  resourceId = "",
  source = "workspace",
  attachment = null,
  logicalPath = "",
  capabilities = { read: true, write: false, scriptInput: true },
} = {}) {
  const absolutePath = path.resolve(String(executionPath || ""));
  const workspaceRoot = path.resolve(getBasePathFromAgentContext(agentContext));
  const info = await stat(absolutePath);
  const logical =
    source === "attachment"
      ? {
          view: "attachment",
          path: String(logicalPath || attachment?.name || path.basename(absolutePath)).trim(),
        }
      : resolvePathRef({ input: absolutePath, workspaceRoot, owner: ownerOf(agentContext) });
  const resolvedSource = source === "workspace" && logical.view === "host" ? "host" : source;
  const key = `${resolvedSource}:${ownerOf(agentContext)}:${logical.path}`;
  const registry = getRegistry(agentContext);
  const previous = resourceId ? registry.byId.get(resourceId) : registry.byKey.get(key);
  const ref = createResourceRef({
    resourceId: resourceId || previous?.ref?.resourceId || undefined,
    owner: ownerOf(agentContext),
    source: resolvedSource,
    logical: { view: logical.view, path: logical.path },
    attachment,
    size: info.size,
    mimeType: EXTENSION_TO_MIME[path.extname(absolutePath).toLowerCase()] || DEFAULT_MIME_TYPE,
    capabilities,
  });
  registry.byId.set(ref.resourceId, { ref, executionPath: absolutePath });
  registry.byKey.set(key, { ref, executionPath: absolutePath });
  return projectResourceRef(ref);
}

export function getRegisteredResource({ agentContext, resourceId = "" } = {}) {
  const item = getRegistry(agentContext).byId.get(String(resourceId || "").trim());
  return item ? { ref: projectResourceRef(item.ref), executionPath: item.executionPath } : null;
}

export function isCanonicalResourceInput(value = null) {
  return isResourceRef(value);
}

export function registerResolvedResource({ agentContext, resourceRef, executionPath }) {
  if (!isResourceRef(resourceRef)) throw new TypeError("invalid resource reference");
  const absolutePath = path.resolve(String(executionPath || ""));
  getRegistry(agentContext).byId.set(resourceRef.resourceId, {
    ref: projectResourceRef(resourceRef),
    executionPath: absolutePath,
  });
  getRegistry(agentContext).byKey.set(
    `${resourceRef.source}:${resourceRef.owner}:${resourceRef.logical.path}`,
    { ref: projectResourceRef(resourceRef), executionPath: absolutePath },
  );
  return resourceRef;
}
