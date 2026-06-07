/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveAttachmentDisplayPath,
  resolveSandboxPath,
} from "../utils/sandbox-path-resolver.js";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value = "") {
  return String(value || "").trim();
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
  const sourceMeta = isPlainObject(attachmentMeta)
    ? attachmentMeta
    : (isPlainObject(meta) ? meta : {});
  const resolvedHostPath = normalizeString(hostPath || path || sourceMeta?.path);
  const resolvedRelativePath = normalizeString(relativePath || sourceMeta?.relativePath);

  const resolverPayload = {
    meta: sourceMeta,
    path: resolvedHostPath,
    hostPath: resolvedHostPath,
    relativePath: resolvedRelativePath,
    runtime,
    agentContext,
    purpose,
  };

  const resolverCandidates = [
    runtime?.sharedTools?.resolveAttachmentDisplayPath,
    runtime?.sharedTools?.resolveSandboxPath,
    runtime?.sharedTools?.toSandboxPath,
    runtime?.sharedTools?.pathMapper?.toSandboxPath,
  ];

  for (const resolver of resolverCandidates) {
    if (typeof resolver !== "function") continue;
    try {
      const resolved = normalizeString(resolver(resolverPayload));
      if (resolved) return resolved;
    } catch {
      // Keep the historical fallback behavior: ignore resolver errors.
    }
  }

  return normalizeString(
    resolveAttachmentDisplayPath({
      ...resolverPayload,
      runtime,
      agentContext,
    }) ||
      resolveSandboxPath({
        path: resolvedHostPath,
        hostPath: resolvedHostPath,
        relativePath: resolvedRelativePath,
        runtime,
        agentContext,
      }) ||
      resolvedRelativePath ||
      resolvedHostPath ||
      sourceMeta?.name,
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
  const sourceMeta = isPlainObject(attachmentMeta)
    ? attachmentMeta
    : (isPlainObject(meta) ? meta : {});
  const resolvedHostPath = normalizeString(hostPath || path || sourceMeta?.path);
  const resolvedRelativePath = normalizeString(relativePath || sourceMeta?.relativePath);
  const sandboxPath = normalizeString(
    sourceMeta?.sandboxPath || sourceMeta?.sandboxViewPath || sourceMeta?.sandbox_file_path ||
      resolveSandboxPath({
        path: resolvedHostPath,
        hostPath: resolvedHostPath,
        relativePath: resolvedRelativePath,
        runtime,
        agentContext,
      }),
  );
  const displayPath = resolveTransferFilePath({
    runtime,
    agentContext,
    attachmentMeta: sourceMeta,
    path: resolvedHostPath,
    hostPath: resolvedHostPath,
    relativePath: resolvedRelativePath,
    purpose,
  });
  return {
    displayPath,
    ...(sandboxPath ? { sandboxPath } : {}),
    ...(resolvedHostPath ? { hostPath: resolvedHostPath } : {}),
    ...(resolvedRelativePath ? { relativePath: resolvedRelativePath } : {}),
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
  const sourceMeta = isPlainObject(attachmentMeta)
    ? attachmentMeta
    : (isPlainObject(meta) ? meta : {});
  const pathView = resolveTransferPathView({
    runtime,
    agentContext,
    attachmentMeta: sourceMeta,
    path: hostPath || path || sourceMeta?.path || "",
    hostPath: hostPath || path || sourceMeta?.path || "",
    relativePath: relativePath || sourceMeta?.relativePath || "",
    purpose,
  });
  const filePath = normalizeString(pathView.displayPath || pathView.sandboxPath || pathView.relativePath || pathView.hostPath);
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
