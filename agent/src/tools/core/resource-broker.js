/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { stat } from "node:fs/promises";
import { attachmentIdentityKey } from "@noobot/attachment-protocol";
import {
  createResourceRef,
  filePath as path,
  projectResourceRef,
  resolvePathRef,
} from "@noobot/path-resolver";
import {
  getBasePathFromAgentContext,
  getRuntimeFromAgentContext,
} from "../../context/agent-context-accessor.js";
import { EXTENSION_TO_MIME, DEFAULT_MIME_TYPE } from "../../shared/constants/index.js";

const registries = new WeakMap();

function resolveRuntime(agentContext = null, runtime = null) {
  if (runtime && typeof runtime === "object" && !Array.isArray(runtime)) return runtime;
  return getRuntimeFromAgentContext(agentContext);
}

function getRegistry(agentContext = null, runtime = null) {
  const resolvedRuntime = resolveRuntime(agentContext, runtime);
  let registry = registries.get(resolvedRuntime);
  if (!registry) {
    registry = new Map();
    registries.set(resolvedRuntime, registry);
  }
  return registry;
}

function ownerOf(agentContext = null, runtime = null, explicitOwner = "") {
  const resolvedRuntime = resolveRuntime(agentContext, runtime);
  return String(
    explicitOwner ||
      resolvedRuntime?.userId ||
      resolvedRuntime?.systemRuntime?.userId ||
      agentContext?.context?.identity?.userId ||
      agentContext?.userId ||
      "",
  ).trim();
}

function registerCanonicalResource({
  agentContext,
  source,
  logical,
  attachment = null,
  size = null,
  mimeType = DEFAULT_MIME_TYPE,
  capabilities,
  executionPath = "",
  runtime = null,
  owner = "",
}) {
  const resolvedSource = source === "workspace" && logical.view === "host" ? "host" : source;
  const resourceIdentity = attachment ? attachmentIdentityKey(attachment) : logical.path;
  const resolvedOwner = ownerOf(agentContext, runtime, owner);
  const key = `${resolvedSource}:${resolvedOwner}:${resourceIdentity}`;
  const registry = getRegistry(agentContext, runtime);
  const previous = registry.get(key);
  const ref = createResourceRef({
    resourceId: previous?.ref?.resourceId || undefined,
    owner: resolvedOwner,
    source: resolvedSource,
    logical: { view: logical.view, path: logical.path },
    attachment,
    size,
    mimeType,
    capabilities,
  });
  registry.set(key, {
    ref,
    executionPath: String(executionPath || previous?.executionPath || "").trim(),
  });
  return projectResourceRef(ref);
}

export async function registerResource({
  agentContext,
  executionPath,
  source = "workspace",
  attachment = null,
  logicalPath = "",
  logicalPathRef = null,
  capabilities = { read: true, write: false, scriptInput: true },
} = {}) {
  const absolutePath = path.resolve(String(executionPath || ""));
  const workspaceRoot = path.resolve(getBasePathFromAgentContext(agentContext));
  const info = await stat(absolutePath);
  const logical = logicalPathRef
    ? resolvePathRef({ input: logicalPathRef, owner: ownerOf(agentContext) })
    : source === "attachment"
      ? {
          view: "attachment",
          path: String(logicalPath || attachment?.name || path.basename(absolutePath)).trim(),
        }
      : resolvePathRef({ input: absolutePath, workspaceRoot, owner: ownerOf(agentContext) });
  return registerCanonicalResource({
    agentContext,
    source,
    logical,
    attachment,
    size: info.size,
    mimeType: EXTENSION_TO_MIME[path.extname(absolutePath).toLowerCase()] || DEFAULT_MIME_TYPE,
    capabilities,
    executionPath: absolutePath,
  });
}

export function registerAttachmentResource({
  agentContext,
  runtime = null,
  owner = "",
  attachment,
  capabilities = { read: true, write: false, scriptInput: true },
} = {}) {
  const identity = attachment?.identity || attachment;
  const logicalPath = String(attachment?.name || "").trim();
  if (!logicalPath) throw new TypeError("attachment resource name is required");
  return registerCanonicalResource({
    agentContext,
    source: "attachment",
    logical: { view: "attachment", path: logicalPath },
    attachment: identity,
    size: attachment?.size,
    mimeType: String(attachment?.mimeType || DEFAULT_MIME_TYPE).trim() || DEFAULT_MIME_TYPE,
    capabilities,
    runtime,
    owner,
  });
}

export function registerTransferAttachmentResources({
  agentContext = null,
  runtime = null,
  owner = "",
  transferEnvelopes = [],
} = {}) {
  const attachments = (Array.isArray(transferEnvelopes) ? transferEnvelopes : []).flatMap(
    (envelope) =>
      envelope?.payload?.mode === "attachment" ? envelope.payload.attachments || [] : [],
  );
  const resources = attachments.map((attachment) =>
    registerAttachmentResource({ agentContext, runtime, owner, attachment }),
  );
  return Array.from(new Map(resources.map((resource) => [resource.resourceId, resource])).values());
}
