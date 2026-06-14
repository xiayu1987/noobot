/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_ATTACHMENT_SCOPE } from "../constants.js";
import { resolveWorkflowAgentContext, resolveWorkflowRuntimeFromContext } from "./runtime.js";

export function mergeAttachmentMetas(existing = [], incoming = []) {
  const merged = Array.isArray(existing) ? existing.slice() : [];
  const seen = new Set(
    merged
      .map((item = {}) => String(item?.attachmentId || item?.path || item?.relativePath || "").trim())
      .filter(Boolean),
  );
  for (const item of Array.isArray(incoming) ? incoming : []) {
    if (!item || typeof item !== "object") continue;
    const key = String(item?.attachmentId || item?.path || item?.relativePath || "").trim();
    if (key && seen.has(key)) continue;
    merged.push(item);
    if (key) seen.add(key);
  }
  return merged;
}

export function resolveWorkflowInputAttachmentMetas(ctx = {}) {
  const agentContext = resolveWorkflowAgentContext(ctx);
  const candidates = [
    ctx?.attachmentMetas,
    ctx?.userMessageAttachmentMetas,
    agentContext?.session?.current?.attachments,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }
  return [];
}

export function normalizeAttachmentRefs(input = []) {
  const source = Array.isArray(input) ? input : String(input || "").split(/[,;，；]/);
  return source.map((item) => String(item || "").trim()).filter(Boolean);
}

export function isAllUserAttachmentRef(ref = "") {
  const normalized = String(ref || "").trim().toLowerCase();
  return WORKFLOW_ATTACHMENT_SCOPE.USER_ALL_TOKENS.includes(normalized);
}

export function resolveSemanticAttachmentDeclarationMap(semantic = {}) {
  if (semantic?.attachmentMap && typeof semantic.attachmentMap === "object") {
    return semantic.attachmentMap;
  }
  const map = {};
  for (const item of Array.isArray(semantic?.attachments) ? semantic.attachments : []) {
    const id = String(item?.id || item?.attachmentId || "").trim();
    if (!id) continue;
    map[id] = item;
  }
  return map;
}

export function resolveNodeInputAttachmentMetas({ ctx = {}, semanticNode = {}, semantic = {} } = {}) {
  const userAttachmentMetas = resolveWorkflowInputAttachmentMetas(ctx);
  if (!userAttachmentMetas.length) return [];
  const refs = normalizeAttachmentRefs(
    semanticNode?.attachments || semanticNode?.inputAttachments || semanticNode?.attachmentIds || [],
  );
  if (!refs.length) return [];
  if (refs.some(isAllUserAttachmentRef)) return userAttachmentMetas;
  const semanticAttachmentMap = resolveSemanticAttachmentDeclarationMap(semantic);
  const expandedRefs = refs.flatMap((ref) => {
    const normalizedRef = String(ref || "").trim();
    const declared = semanticAttachmentMap[normalizedRef] || null;
    if (!declared || typeof declared !== "object") return [normalizedRef];
    return [
      normalizedRef,
      declared?.id,
      declared?.attachmentId,
      declared?.name,
      declared?.fileName,
      declared?.path,
      declared?.relativePath,
    ];
  });
  const refSet = new Set(expandedRefs.map((item) => String(item || "").trim()).filter(Boolean));
  if (!refSet.size) return [];
  return userAttachmentMetas.filter((meta = {}) => {
    const keys = [
      meta?.attachmentId,
      meta?.id,
      meta?.name,
      meta?.fileName,
      meta?.path,
      meta?.relativePath,
      resolveAttachmentDisplayPath(meta, ctx),
      meta?.parsedResultAttachmentId,
      meta?.parsedResultPath,
      meta?.parsedResultRelativePath,
    ]
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    return keys.some((key) => refSet.has(key));
  });
}

export function resolveAttachmentDisplayPath(meta = {}, ctx = {}) {
  const agentContext = resolveWorkflowAgentContext(ctx);
  const runtime = resolveWorkflowRuntimeFromContext(ctx);
  const semanticDisplay = callAttachmentPathResolver(
    runtime?.sharedTools?.semanticTransfer?.getTransferDisplayPath,
    meta,
    { runtime, agentContext },
  );
  if (semanticDisplay) return semanticDisplay;

  const primaryFile = Array.isArray(meta?.files) && meta.files.length ? meta.files[0] : null;
  const sourceMeta = primaryFile?.attachmentMeta || meta?.attachmentMeta || meta;
  const directFilePath = String(
    primaryFile?.pathView?.displayPath ||
      primaryFile?.filePath ||
      meta?.pathView?.displayPath ||
      "",
  ).trim();
  if (directFilePath) return directFilePath;

  const resolved = resolveViaRuntimeAttachmentPathResolvers(sourceMeta, runtime, agentContext);
  if (resolved) return resolved;
  return String(sourceMeta?.relativePath || sourceMeta?.path || sourceMeta?.name || "").trim();
}

function callAttachmentPathResolver(resolver, ...args) {
  if (typeof resolver !== "function") return "";
  try {
    return String(resolver(...args) || "").trim();
  } catch {
    return "";
  }
}

function buildAttachmentPathResolverPayload(sourceMeta = {}, runtime = null, agentContext = null) {
  const path = String(sourceMeta?.path || "").trim();
  return {
    ...(sourceMeta && typeof sourceMeta === "object" ? sourceMeta : {}),
    attachmentMeta: sourceMeta,
    meta: sourceMeta,
    path,
    hostPath: path,
    relativePath: String(sourceMeta?.relativePath || "").trim(),
    runtime,
    agentContext,
    purpose: "workflow_attachment_display_path",
  };
}

function resolveViaRuntimeAttachmentPathResolvers(sourceMeta = {}, runtime = null, agentContext = null) {
  const payload = buildAttachmentPathResolverPayload(sourceMeta, runtime, agentContext);
  const resolvers = [
    runtime?.sharedTools?.semanticTransfer?.resolveTransferFilePath,
    runtime?.sharedTools?.resolveAttachmentDisplayPath,
    runtime?.sharedTools?.resolveSandboxPath,
    runtime?.sharedTools?.toSandboxPath,
    runtime?.sharedTools?.pathMapper?.toSandboxPath,
  ];
  for (const resolver of resolvers) {
    const resolved = callAttachmentPathResolver(resolver, payload);
    if (resolved) return resolved;
  }
  return "";
}

export function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeWorkflowTransferPayload(payload = {}) {
  const source = isPlainObject(payload) ? payload : {};
  const transferResult = isPlainObject(source.transferResult)
    ? source.transferResult
    : isPlainObject(source.result)
      ? source.result
      : null;
  const transferEnvelope = isPlainObject(source.transferEnvelope)
    ? source.transferEnvelope
    : isPlainObject(source.envelope)
      ? source.envelope
      : isPlainObject(transferResult?.envelope)
        ? transferResult.envelope
        : null;
  const transferEnvelopes = Array.isArray(source.transferEnvelopes)
    ? source.transferEnvelopes.filter(isPlainObject)
    : transferEnvelope
      ? [transferEnvelope]
      : [];
  return { transferResult, transferEnvelope, transferEnvelopes };
}

export function getWorkflowTransferPayloadFromResult(result = {}) {
  if (!isPlainObject(result)) return normalizeWorkflowTransferPayload();
  return normalizeWorkflowTransferPayload({
    transferResult: result.transferResult || result.result || null,
    transferEnvelope: result.transferEnvelope || result.envelope || null,
    transferEnvelopes: result.transferEnvelopes || [],
  });
}

export function applyWorkflowTransferPayload(target = {}, payload = {}) {
  if (!target || typeof target !== "object") return target;
  const transferPayload = normalizeWorkflowTransferPayload(payload);
  if (transferPayload.transferResult) {
    target.transferResult = transferPayload.transferResult;
  }
  if (transferPayload.transferEnvelope) {
    target.transferEnvelope = transferPayload.transferEnvelope;
  }
  if (transferPayload.transferEnvelopes.length) {
    const existing = Array.isArray(target.transferEnvelopes) ? target.transferEnvelopes : [];
    const merged = [...existing];
    for (const envelope of transferPayload.transferEnvelopes) {
      if (!merged.includes(envelope)) merged.push(envelope);
    }
    target.transferEnvelopes = merged;
  }
  return target;
}

export function resolveWorkflowTransferFilesFromPayload(payload = {}, ctx = {}) {
  const transferPayload = normalizeWorkflowTransferPayload(payload);
  if (!transferPayload.transferEnvelopes.length && !transferPayload.transferEnvelope) return [];
  const agentContext = resolveWorkflowAgentContext(ctx);
  const runtime = resolveWorkflowRuntimeFromContext(ctx);
  const getTransferFiles = runtime?.sharedTools?.semanticTransfer?.getTransferFiles;
  const source = transferPayload.transferEnvelopes.length
    ? transferPayload.transferEnvelopes
    : [transferPayload.transferEnvelope];
  if (typeof getTransferFiles === "function") {
    try {
      const files = getTransferFiles(source, { runtime, agentContext });
      if (Array.isArray(files) && files.length) return files;
    } catch {
      // Fallback to transfer-envelope-only parsing below.
    }
  }
  return source.flatMap((envelope = {}) => {
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return [];
    if (Array.isArray(envelope.files) && envelope.files.length) {
      return envelope.files.filter((item) => item && typeof item === "object" && !Array.isArray(item));
    }
    if (envelope.filePath || envelope.attachmentMeta || envelope.pathView) {
      return [
        {
          filePath: String(envelope.filePath || "").trim(),
          ...(envelope.attachmentMeta && typeof envelope.attachmentMeta === "object"
            ? { attachmentMeta: envelope.attachmentMeta }
            : {}),
          ...(envelope.pathView && typeof envelope.pathView === "object"
            ? { pathView: envelope.pathView }
            : {}),
          role: "primary",
        },
      ];
    }
    return [];
  });
}

export function resolveWorkflowAttachmentMetasFromTransferPayload(payload = {}, ctx = {}) {
  const transferPayload = normalizeWorkflowTransferPayload(payload);
  const runtime = resolveWorkflowRuntimeFromContext(ctx);
  const getTransferAttachmentMetas = runtime?.sharedTools?.semanticTransfer?.getTransferAttachmentMetas;
  if (typeof getTransferAttachmentMetas === "function") {
    try {
      const metas = getTransferAttachmentMetas(
        transferPayload.transferEnvelopes.length
          ? transferPayload.transferEnvelopes
          : transferPayload.transferEnvelope || [],
      );
      if (Array.isArray(metas) && metas.length) return metas;
    } catch {
      // Fallback below.
    }
  }
  return resolveWorkflowTransferFilesFromPayload(transferPayload, ctx)
    .map((item = {}) => item?.attachmentMeta)
    .filter((item) => item && typeof item === "object" && !Array.isArray(item));
}

export function resolveWorkflowCompatAttachmentMetas({
  workflowPayload = null,
  attachmentMetas = [],
  ctx = {},
} = {}) {
  const transferMetas = resolveWorkflowAttachmentMetasFromTransferPayload(
    workflowPayload && typeof workflowPayload === "object" ? workflowPayload : {},
    ctx,
  );
  if (transferMetas.length) return transferMetas;
  return Array.isArray(attachmentMetas) ? attachmentMetas : [];
}

export function resolveWorkflowTransferFileDisplayPath(file = {}, ctx = {}) {
  const agentContext = resolveWorkflowAgentContext(ctx);
  const runtime = resolveWorkflowRuntimeFromContext(ctx);
  const semanticDisplay = callAttachmentPathResolver(
    runtime?.sharedTools?.semanticTransfer?.getTransferDisplayPath,
    file,
    { runtime, agentContext },
  );
  if (semanticDisplay) return semanticDisplay;
  return String(
    file?.pathView?.displayPath ||
      file?.filePath ||
      resolveAttachmentDisplayPath(
        {
          ...(file?.attachmentMeta && typeof file.attachmentMeta === "object" ? file.attachmentMeta : {}),
          pathView: file?.pathView,
          path: file?.attachmentMeta?.path || file?.pathView?.hostPath,
          relativePath: file?.attachmentMeta?.relativePath || file?.pathView?.relativePath,
          sandboxPath: file?.attachmentMeta?.sandboxPath || file?.pathView?.sandboxPath,
        },
        ctx,
      ) ||
      "",
  ).trim();
}
