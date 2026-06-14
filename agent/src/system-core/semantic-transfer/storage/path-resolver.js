/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveAttachmentDisplayPath,
  resolveSandboxPath,
} from "../../utils/sandbox-path-resolver.js";
import { firstNormalizedString } from "../core/compact.js";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value = "") {
  return String(value || "").trim();
}

function resolveSourceMeta(attachmentMeta = null, meta = null) {
  return isPlainObject(attachmentMeta)
    ? attachmentMeta
    : (isPlainObject(meta) ? meta : {});
}

function buildTransferPathResolverPayload({
  runtime = {},
  agentContext = null,
  attachmentMeta = null,
  meta = null,
  path = "",
  hostPath = "",
  relativePath = "",
  purpose = "semantic_transfer_file_path",
} = {}) {
  const sourceMeta = resolveSourceMeta(attachmentMeta, meta);
  const resolvedHostPath = firstNormalizedString(hostPath, path, sourceMeta?.path);
  const resolvedRelativePath = firstNormalizedString(relativePath, sourceMeta?.relativePath);
  return {
    meta: sourceMeta,
    path: resolvedHostPath,
    hostPath: resolvedHostPath,
    relativePath: resolvedRelativePath,
    runtime,
    agentContext,
    purpose,
  };
}

function resolveViaRuntimeTransferPathResolvers(payload = {}) {
  const resolverCandidates = [
    payload?.runtime?.sharedTools?.resolveAttachmentDisplayPath,
  ];

  for (const resolver of resolverCandidates) {
    if (typeof resolver !== "function") continue;
    try {
      const resolved = normalizeString(resolver(payload));
      if (resolved) return resolved;
    } catch {
      // Keep the historical fallback behavior: ignore resolver errors.
    }
  }
  return "";
}

export function resolveTransferFilePath({
  runtime = {},
  agentContext = null,
  attachmentMeta = null,
  meta = null,
  path = "",
  hostPath = "",
  relativePath = "",
  purpose = "semantic_transfer_file_path",
} = {}) {
  const resolverPayload = buildTransferPathResolverPayload({
    runtime,
    agentContext,
    attachmentMeta,
    meta,
    path,
    hostPath,
    relativePath,
    purpose,
  });

  const sandboxPath = resolveSandboxPath(resolverPayload);
  if (sandboxPath) return sandboxPath;

  const runtimeResolvedPath = resolveViaRuntimeTransferPathResolvers(resolverPayload);
  if (runtimeResolvedPath) return runtimeResolvedPath;

  return firstNormalizedString(
    resolveAttachmentDisplayPath(resolverPayload),
    resolverPayload.relativePath,
    resolverPayload.hostPath,
    resolverPayload.meta?.name,
  );
}


export function resolveTransferPathView({
  runtime = {},
  agentContext = null,
  attachmentMeta = null,
  meta = null,
  path = "",
  hostPath = "",
  relativePath = "",
  purpose = "semantic_transfer_file_path",
} = {}) {
  const resolverPayload = buildTransferPathResolverPayload({
    runtime,
    agentContext,
    attachmentMeta,
    meta,
    path,
    hostPath,
    relativePath,
    purpose,
  });
  const sandboxPath = resolveSandboxPath(resolverPayload);
  const displayPath = resolveTransferFilePath({
    ...resolverPayload,
    attachmentMeta: resolverPayload.meta,
  });
  return {
    displayPath,
    ...(sandboxPath ? { sandboxPath } : {}),
    ...(resolverPayload.hostPath ? { hostPath: resolverPayload.hostPath } : {}),
    ...(resolverPayload.relativePath ? { relativePath: resolverPayload.relativePath } : {}),
  };
}

export function buildTransferFileEntry({
  runtime = {},
  agentContext = null,
  attachmentMeta = null,
  meta = null,
  path = "",
  hostPath = "",
  relativePath = "",
  purpose = "semantic_transfer_file_path",
  role = "primary",
} = {}) {
  const sourceMeta = resolveSourceMeta(attachmentMeta, meta);
  const pathView = resolveTransferPathView({
    runtime,
    agentContext,
    attachmentMeta: sourceMeta,
    path: firstNormalizedString(hostPath, path, sourceMeta?.path),
    hostPath: firstNormalizedString(hostPath, path, sourceMeta?.path),
    relativePath: firstNormalizedString(relativePath, sourceMeta?.relativePath),
    purpose,
  });
  const filePath = firstNormalizedString(
    pathView.displayPath,
    pathView.sandboxPath,
    pathView.relativePath,
    pathView.hostPath,
  );
  return {
    ...(filePath ? { filePath } : {}),
    ...(isPlainObject(sourceMeta) ? { attachmentMeta: sourceMeta } : {}),
    ...(Object.keys(pathView).length ? { pathView } : {}),
    role: normalizeString(role) || "primary",
    ...(sourceMeta?.name ? { name: normalizeString(sourceMeta.name) } : {}),
    ...(sourceMeta?.mimeType ? { mimeType: normalizeString(sourceMeta.mimeType) } : {}),
    ...(Number(sourceMeta?.size) > 0 ? { size: Number(sourceMeta.size) } : {}),
  };
}
