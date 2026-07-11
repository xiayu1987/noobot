/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  PATH_VIEWS,
  convertPathView,
  detectPathPlatform,
  resolveAttachmentDisplayPath,
  resolveSandboxPath,
} from "../../utils/path-resolver.js";
import { firstNormalizedString } from "../core/compact.js";

// Transfer path views keep multiple path roles explicit:
// - path follows targetView and is the canonical path for that view.
// - hostPath, sandboxPath, and relativePath preserve their named meanings.
// - displayPath is the model/user-facing fallback and may differ from path.
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
  const isSandbox = typeof sourceMeta?.isSandbox === "boolean"
    ? sourceMeta.isSandbox
    : sourceMeta?.sandboxEnabled;
  return {
    meta: sourceMeta,
    path: resolvedHostPath,
    hostPath: resolvedHostPath,
    relativePath: resolvedRelativePath,
    ...(typeof isSandbox === "boolean" ? { isSandbox } : {}),
    sourcePlatform: normalizeString(sourceMeta?.sourcePlatform || sourceMeta?.pathPlatform),
    sourceView: normalizeString(sourceMeta?.sourceView || sourceMeta?.pathView) || (isSandbox === true ? PATH_VIEWS.HOST : ""),
    runtime,
    agentContext,
    purpose,
  };
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
  const payload = buildTransferPathResolverPayload({
    runtime, agentContext, attachmentMeta, meta, path, hostPath, relativePath, purpose,
  });
  if (payload.isSandbox === true) {
    const sandboxPath = resolveSandboxPath(payload);
    if (sandboxPath) return sandboxPath;
  }
  if (payload.isSandbox === false) {
    return firstNormalizedString(
      payload.relativePath,
      payload.hostPath,
      payload.meta?.name,
    );
  }
  const runtimeResolver = runtime?.sharedTools?.resolveAttachmentDisplayPath;
  if (typeof runtimeResolver === "function") {
    try {
      const resolved = normalizeString(runtimeResolver(payload));
      if (resolved) return resolved;
    } catch {
      // Preserve fallback behavior when an optional runtime resolver fails.
    }
  }
  return resolveAttachmentDisplayPath(payload);
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
  const sourcePath = resolverPayload.hostPath || resolverPayload.relativePath;
  const sourcePlatform = resolverPayload.sourcePlatform || detectPathPlatform(sourcePath);
  const sourceView = resolverPayload.sourceView || PATH_VIEWS.HOST;
  const targetView = sandboxPath ? PATH_VIEWS.SANDBOX : sourceView;
  const semanticView = convertPathView({
    path: sourcePath,
    sourcePlatform,
    sourceView,
    targetPlatform: sandboxPath ? "linux" : sourcePlatform,
    targetView,
    runtime,
    agentContext,
  });
  const targetPath = sandboxPath || semanticView.path;
  return {
    displayPath,
    path: targetPath,
    sourcePlatform: semanticView.sourcePlatform,
    sourceView: semanticView.sourceView,
    targetPlatform: semanticView.targetPlatform,
    targetView: semanticView.targetView,
    ...(sandboxPath ? { sandboxPath } : {}),
    ...(resolverPayload.hostPath ? { hostPath: resolverPayload.hostPath } : {}),
    ...(resolverPayload.relativePath ? { relativePath: resolverPayload.relativePath } : {}),
    ...(typeof resolverPayload.isSandbox === "boolean" ? { isSandbox: resolverPayload.isSandbox } : {}),
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
    ...(typeof sourceMeta?.isSandbox === "boolean" ? { isSandbox: sourceMeta.isSandbox } : {}),
    role: normalizeString(role) || "primary",
    ...(sourceMeta?.name ? { name: normalizeString(sourceMeta.name) } : {}),
    ...(sourceMeta?.mimeType ? { mimeType: normalizeString(sourceMeta.mimeType) } : {}),
    ...(Number(sourceMeta?.size) > 0 ? { size: Number(sourceMeta.size) } : {}),
  };
}
