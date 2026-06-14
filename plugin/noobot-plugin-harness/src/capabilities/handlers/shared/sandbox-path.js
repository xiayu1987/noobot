/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function resolveRuntime(ctx = {}) {
  return ctx?.agentContext?.execution?.controllers?.runtime || null;
}

function callResolver(resolver, ...args) {
  if (typeof resolver !== "function") return "";
  try {
    return String(resolver(...args) || "").trim();
  } catch {
    return "";
  }
}

function buildResolverPayload(meta = {}, sourceMeta = {}, runtime = null, ctx = {}) {
  const path = String(sourceMeta?.path || meta?.path || "").trim();
  return {
    ...(meta && typeof meta === "object" ? meta : {}),
    attachmentMeta: sourceMeta,
    meta: sourceMeta,
    path,
    hostPath: path,
    relativePath: String(sourceMeta?.relativePath || "").trim(),
    runtime,
    agentContext: ctx?.agentContext || null,
    purpose: "attachment_display_path",
  };
}

function resolveViaRuntimeResolvers(sourceMeta = {}, runtime = null, ctx = {}) {
  const payload = buildResolverPayload(sourceMeta, sourceMeta, runtime, ctx);
  const resolvers = [
    runtime?.sharedTools?.resolveAttachmentDisplayPath,
    runtime?.sharedTools?.resolveSandboxPath,
    runtime?.sharedTools?.toSandboxPath,
    runtime?.sharedTools?.pathMapper?.toSandboxPath,
  ];
  for (const resolver of resolvers) {
    const resolved = callResolver(resolver, payload);
    if (resolved) return resolved;
  }
  return "";
}

export function resolveAttachmentDisplayPath(meta = {}, ctx = {}) {
  const runtime = resolveRuntime(ctx);
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

  const resolved = resolveViaRuntimeResolvers(sourceMeta, runtime, ctx);
  if (resolved) return resolved;

  return String(sourceMeta?.relativePath || sourceMeta?.path || sourceMeta?.name || "").trim();
}
