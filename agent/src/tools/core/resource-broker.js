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
  resolveRuntimeUserId,
} from "../../context/agent-context-accessor.js";
import { resolveMimeTypeFromFileName } from "@noobot/attachment-protocol/mime";
import { TRANSFER_MODE } from "@noobot/semantic-transfer-protocol";
import { text } from "@noobot/shared/value";

const registries = new WeakMap();

function getRegistry(agentContext) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  let registry = registries.get(runtime);
  if (!registry) {
    registry = new Map();
    registries.set(runtime, registry);
  }
  return registry;
}

function ownerOf(agentContext) {
  return resolveRuntimeUserId(getRuntimeFromAgentContext(agentContext));
}

function registerCanonicalResource({
  agentContext,
  source,
  logical,
  attachment = null,
  size = null,
  mimeType,
  capabilities,
  executionPath = "",
}) {
  const resolvedSource = source === "workspace" && logical.view === "host" ? "host" : source;
  const resourceIdentity = attachment ? attachmentIdentityKey(attachment) : logical.path;
  const resolvedOwner = ownerOf(agentContext);
  const key = `${resolvedSource}:${resolvedOwner}:${resourceIdentity}`;
  const registry = getRegistry(agentContext);
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
    executionPath: text(executionPath || previous?.executionPath),
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
    mimeType: resolveMimeTypeFromFileName(absolutePath),
    capabilities,
    executionPath: absolutePath,
  });
}

export function registerAttachmentResource({
  agentContext,
  attachment,
  capabilities = { read: true, write: false, scriptInput: true },
}) {
  return registerCanonicalResource({
    agentContext,
    source: "attachment",
    logical: { view: "attachment", path: attachment.name },
    attachment: attachment.identity,
    size: attachment.size,
    mimeType: attachment.mimeType,
    capabilities,
  });
}

export function registerTransferAttachmentResources({ agentContext, transferEnvelopes }) {
  const attachments = transferEnvelopes.flatMap((envelope) =>
    envelope.payload.mode === TRANSFER_MODE.ATTACHMENT ? envelope.payload.attachments : [],
  );
  const resources = attachments.map((attachment) =>
    registerAttachmentResource({ agentContext, attachment }),
  );
  return Array.from(new Map(resources.map((resource) => [resource.resourceId, resource])).values());
}
