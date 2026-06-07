/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function resolveRuntime(ctx = {}) {
  return ctx?.agentContext?.execution?.controllers?.runtime || null;
}

export function resolveAttachmentDisplayPath(meta = {}, ctx = {}) {
  const runtime = resolveRuntime(ctx);
  const semanticDisplay = runtime?.sharedTools?.semanticTransfer?.getTransferDisplayPath;
  if (typeof semanticDisplay === "function") {
    try {
      const resolved = String(
        semanticDisplay(meta, { runtime, agentContext: ctx?.agentContext || null }) || "",
      ).trim();
      if (resolved) return resolved;
    } catch {
      // Fallback to legacy resolver candidates below.
    }
  }

  const primaryFile = Array.isArray(meta?.files) && meta.files.length ? meta.files[0] : null;
  const sourceMeta = primaryFile?.attachmentMeta || meta?.attachmentMeta || meta;
  const directFilePath = String(
    primaryFile?.pathView?.displayPath ||
      primaryFile?.filePath ||
      meta?.pathView?.displayPath ||
      meta?.filePath ||
      "",
  ).trim();
  if (directFilePath) return directFilePath;

  const metaSandboxPath = String(
    sourceMeta?.sandboxPath || sourceMeta?.sandboxViewPath || sourceMeta?.sandbox_file_path || "",
  ).trim();
  if (metaSandboxPath) return metaSandboxPath;

  const semanticResolver = runtime?.sharedTools?.semanticTransfer?.resolveTransferFilePath;
  if (typeof semanticResolver === "function") {
    try {
      const resolved = String(
        semanticResolver({
          attachmentMeta: sourceMeta,
          meta: sourceMeta,
          path: String(sourceMeta?.path || "").trim(),
          hostPath: String(sourceMeta?.path || "").trim(),
          relativePath: String(sourceMeta?.relativePath || "").trim(),
          runtime,
          agentContext: ctx?.agentContext || null,
          purpose: "attachment_display_path",
        }) || "",
      ).trim();
      if (resolved) return resolved;
    } catch {
      // Fallback to legacy resolver candidates below.
    }
  }
  const injectedResolver = runtime?.sharedTools?.resolveAttachmentDisplayPath;
  if (typeof injectedResolver === "function") {
    try {
      const resolved = String(
        injectedResolver({
          meta: sourceMeta,
          path: String(sourceMeta?.path || "").trim(),
          hostPath: String(sourceMeta?.path || "").trim(),
          relativePath: String(sourceMeta?.relativePath || "").trim(),
          runtime,
          agentContext: ctx?.agentContext || null,
          purpose: "attachment_display_path",
        }) || "",
      ).trim();
      if (resolved) return resolved;
    } catch {
      // Fallback to legacy resolver candidates below.
    }
  }
  const hostPath = String(sourceMeta?.path || "").trim();
  const relativePath = String(sourceMeta?.relativePath || "").trim();
  const resolverCandidates = [
    runtime?.sharedTools?.resolveSandboxPath,
    runtime?.sharedTools?.toSandboxPath,
    runtime?.sharedTools?.pathMapper?.toSandboxPath,
  ];
  for (const resolver of resolverCandidates) {
    if (typeof resolver !== "function") continue;
    try {
      const resolved = String(
        resolver({
          path: hostPath,
          hostPath,
          relativePath,
          runtime,
          agentContext: ctx?.agentContext || null,
          purpose: "attachment_display_path",
        }) || "",
      ).trim();
      if (resolved) return resolved;
    } catch {
      // Fallback to meta path below.
    }
  }

  return String(relativePath || hostPath || sourceMeta?.name || "").trim();
}
