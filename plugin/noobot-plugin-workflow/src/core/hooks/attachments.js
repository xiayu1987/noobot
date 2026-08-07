/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_ATTACHMENT_SCOPE } from "../constants.js";
import { resolveWorkflowAgentContext, resolveWorkflowRuntimeFromContext } from "./runtime.js";
import {
  attachmentIdentityKey,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";

function canonicalAttachmentKey(attachment = {}) {
  return attachmentIdentityKey(projectAttachmentIdentity(attachment));
}

function assertTransferAttachmentMeta(meta = {}) {
  projectAttachmentIdentity(meta);
  return meta;
}

export function mergeAttachments(existing = [], incoming = []) {
  const merged = Array.isArray(existing) ? existing.slice() : [];
  const indexByKey = new Map();
  merged.forEach((item, index) => indexByKey.set(canonicalAttachmentKey(item), index));
  for (const item of Array.isArray(incoming) ? incoming : []) {
    if (!item || typeof item !== "object") continue;
    const key = canonicalAttachmentKey(item);
    if (indexByKey.has(key)) {
      const index = indexByKey.get(key);
      merged[index] = { ...merged[index], ...item };
      continue;
    }
    merged.push(item);
    indexByKey.set(key, merged.length - 1);
  }
  return merged;
}

export function resolveWorkflowInputAttachments(ctx = {}) {
  const agentContext = resolveWorkflowAgentContext(ctx);
  const candidates = [
    ctx?.attachments,
    ctx?.userMessageAttachments,
    agentContext?.bindings?.runtime?.userMessageAttachments,
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

export function resolveNodeInputAttachments({ ctx = {}, semanticNode = {}, semantic = {} } = {}) {
  const userAttachments = resolveWorkflowInputAttachments(ctx);
  if (!userAttachments.length) return [];
  const canonicalUserAttachments = userAttachments.map((attachment) => ({
    attachment,
    key: canonicalAttachmentKey(attachment),
  }));
  const refs = normalizeAttachmentRefs(
    semanticNode?.attachments || semanticNode?.inputAttachments || semanticNode?.attachmentIds || [],
  );
  if (!refs.length) return [];
  if (refs.some(isAllUserAttachmentRef)) return canonicalUserAttachments.map(({ attachment }) => attachment);
  const semanticAttachmentMap = resolveSemanticAttachmentDeclarationMap(semantic);
  const declaredIdentityKeys = refs.map((ref) => {
    const normalizedRef = String(ref || "").trim();
    const declared = semanticAttachmentMap[normalizedRef] || null;
    if (!declared || typeof declared !== "object") return "";
    return canonicalAttachmentKey(declared);
  }).filter(Boolean);
  const identityKeySet = new Set(declaredIdentityKeys);
  if (!identityKeySet.size) return [];
  return canonicalUserAttachments
    .filter(({ key }) => identityKeySet.has(key))
    .map(({ attachment }) => attachment);
}

export function resolveAttachmentDisplayPath(meta = {}, ctx = {}) {
  const agentContext = resolveWorkflowAgentContext(ctx);
  const runtime = resolveWorkflowRuntimeFromContext(ctx);
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
  const transferEnvelopes = Array.isArray(source.transferEnvelopes)
    ? source.transferEnvelopes.filter(isPlainObject)
    : [];
  return { transferEnvelopes };
}

export function getWorkflowTransferPayloadFromResult(result = {}) {
  if (!isPlainObject(result)) return normalizeWorkflowTransferPayload();
  return normalizeWorkflowTransferPayload({
    transferEnvelopes: result.transferEnvelopes || [],
  });
}

export function applyWorkflowTransferPayload(target = {}, payload = {}) {
  if (!target || typeof target !== "object") return target;
  const transferPayload = normalizeWorkflowTransferPayload(payload);
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

export function buildWorkflowTransferPayloadFromAttachments(attachments = []) {
  const metas = (Array.isArray(attachments) ? attachments : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item));
  if (!metas.length) return normalizeWorkflowTransferPayload();
  const files = metas.map((meta = {}, index) => ({
    filePath: String(
      meta?.sandboxPath ||
        meta?.sandboxViewPath ||
        meta?.relativePath ||
        meta?.path ||
        meta?.name ||
        "",
    ).trim(),
    attachmentMeta: assertTransferAttachmentMeta(meta),
    role: index === 0 ? "primary" : "secondary",
  }));
  const primaryEnvelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    filePath: String(files[0]?.filePath || "").trim(),
    files,
  };
  return normalizeWorkflowTransferPayload({
    transferEnvelopes: [primaryEnvelope],
  });
}

export function resolveWorkflowTransferFilesFromPayload(payload = {}, ctx = {}) {
  const transferPayload = normalizeWorkflowTransferPayload(payload);
  if (!transferPayload.transferEnvelopes.length) return [];
  const source = transferPayload.transferEnvelopes;
  return source.flatMap((envelope = {}) => {
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return [];
    if (Array.isArray(envelope.files) && envelope.files.length) {
      return envelope.files
        .filter((item) => item && typeof item === "object" && !Array.isArray(item))
        .map((item) => ({
          ...item,
          ...(item.attachmentMeta
            ? { attachmentMeta: assertTransferAttachmentMeta(item.attachmentMeta) }
            : {}),
        }));
    }
    if (envelope.filePath || envelope.attachmentMeta || envelope.pathView) {
      if (envelope.attachmentMeta) assertTransferAttachmentMeta(envelope.attachmentMeta);
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

export function resolveWorkflowAttachmentsFromTransferPayload(payload = {}, ctx = {}) {
  const transferPayload = normalizeWorkflowTransferPayload(payload);
  return resolveWorkflowTransferFilesFromPayload(transferPayload, ctx)
    .map((item = {}) => item?.attachmentMeta)
    .filter((item) => item && typeof item === "object" && !Array.isArray(item));
}

export function resolveWorkflowAttachments({
  workflowPayload = null,
  attachments = [],
  ctx = {},
} = {}) {
  const transferAttachments = resolveWorkflowAttachmentsFromTransferPayload(
    workflowPayload && typeof workflowPayload === "object" ? workflowPayload : {},
    ctx,
  );
  if (transferAttachments.length) return transferAttachments;
  return Array.isArray(attachments) ? attachments : [];
}

export function resolveWorkflowTransferFileDisplayPath(file = {}, ctx = {}) {
  return String(
    file?.pathView?.displayPath ||
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
      file?.filePath ||
      "",
  ).trim();
}
