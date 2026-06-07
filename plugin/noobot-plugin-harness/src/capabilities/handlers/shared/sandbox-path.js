/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function resolveRuntime(ctx = {}) {
  return ctx?.agentContext?.execution?.controllers?.runtime || null;
}

export function resolveAttachmentDisplayPath(meta = {}, ctx = {}) {
  const metaSandboxPath = String(
    meta?.sandboxPath || meta?.sandboxViewPath || meta?.sandbox_file_path || "",
  ).trim();
  if (metaSandboxPath) return metaSandboxPath;

  const runtime = resolveRuntime(ctx);
  const injectedResolver = runtime?.sharedTools?.resolveAttachmentDisplayPath;
  if (typeof injectedResolver === "function") {
    try {
      const resolved = String(
        injectedResolver({
          meta,
          path: String(meta?.path || "").trim(),
          hostPath: String(meta?.path || "").trim(),
          relativePath: String(meta?.relativePath || "").trim(),
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
  const hostPath = String(meta?.path || "").trim();
  const relativePath = String(meta?.relativePath || "").trim();
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

  return String(relativePath || hostPath || meta?.name || "").trim();
}
