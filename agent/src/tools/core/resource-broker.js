/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { stat } from "node:fs/promises";
import { attachmentIdentityKey } from "@noobot/attachment-protocol";
import { locatorKey } from "@noobot/shared/locator";
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
  logical,
  attachment = null,
  origin,
  size = null,
  mimeType,
  capabilities,
  executionPath = "",
}) {
  const resolvedOwner = ownerOf(agentContext);
  const registry = getRegistry(agentContext);

  const draft = createResourceRef({
    owner: resolvedOwner,
    logical,
    attachment,
    origin,
    size,
    mimeType,
    capabilities,
  });
  const resourceIdentity =
    draft.source === "attachment" ? attachmentIdentityKey(attachment) : locatorKey(draft.logical);
  const key = `${resolvedOwner}:${draft.source}:${resourceIdentity}`;
  const previous = registry.get(key);
  const ref = previous
    ? createResourceRef({ ...projectResourceRef(draft), resourceId: previous.ref.resourceId })
    : draft;
  registry.set(key, {
    ref,
    executionPath: text(executionPath || previous?.executionPath),
  });
  return projectResourceRef(ref);
}

export async function registerResource({
  agentContext,
  executionPath,
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
    : attachment
      ? { view: "attachment", path: text(logicalPath || path.basename(absolutePath)) }
      : resolvePathRef({ input: absolutePath, workspaceRoot, owner: ownerOf(agentContext) });
  return registerCanonicalResource({
    agentContext,
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
    logical: { view: "attachment", path: attachment.name },
    attachment: attachment.identity,
    origin: attachment.origin,
    size: attachment.size,
    mimeType: attachment.mimeType,
    capabilities,
  });
}

export function registerTransferAttachmentResources({ agentContext, attachments }) {
  if (!Array.isArray(attachments)) {
    throw new TypeError("registerTransferAttachmentResources requires attachments");
  }
  const resources = attachments.map((attachment) =>
    registerAttachmentResource({ agentContext, attachment }),
  );
  return Array.from(new Map(resources.map((resource) => [resource.resourceId, resource])).values());
}
