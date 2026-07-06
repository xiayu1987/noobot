/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { DEFAULT_ATTACHMENT_SESSION_ID, DEFAULT_ATTACHMENT_SOURCE, DEFAULT_MIME_TYPE } from "./constants.js";
import { safeStr, safeNum } from "../utils/shared-utils.js";

const SEMANTIC_TRANSFER_GENERATION_SOURCE_PREFIXES = [
  "semantic_transfer_",
  "plugin_",
  "bot_plugin_",
  "agent_plugin_",
];

const SEMANTIC_TRANSFER_GENERATION_SOURCE_EXACT = new Set([
  "tool_result_overflow",
  "execute_script_input_too_long",
  "write_file_input_too_long",
  "read_file_overflow_original_file",
]);

export function isSemanticTransferAttachmentMeta(attachmentMeta = {}) {
  const generationSource = safeStr(attachmentMeta?.generationSource);
  if (!generationSource) return false;
  if (SEMANTIC_TRANSFER_GENERATION_SOURCE_EXACT.has(generationSource)) return true;
  return SEMANTIC_TRANSFER_GENERATION_SOURCE_PREFIXES.some((prefix) =>
    generationSource.startsWith(prefix),
  );
}

export function filterSemanticTransferAttachmentMetas(attachmentMetas = []) {
  return (Array.isArray(attachmentMetas) ? attachmentMetas : []).filter(
    isSemanticTransferAttachmentMeta,
  );
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanPlainObject(value = {}) {
  if (!isPlainObject(value)) return null;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined || child === null) continue;
    if (typeof child === "string") {
      const normalized = safeStr(child);
      if (normalized) out[key] = normalized;
      continue;
    }
    if (isPlainObject(child)) {
      const nested = cleanPlainObject(child);
      if (nested) out[key] = nested;
      continue;
    }
    if (Array.isArray(child)) {
      if (child.length) out[key] = child;
      continue;
    }
    out[key] = child;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * 归一化附件 owner 元数据。
 * owner 是唯一承载入口，结构为 { type, id, ... }。
 */
export function normalizeAttachmentOwnerMeta(attachmentItem = {}) {
  const explicitOwner = isPlainObject(attachmentItem?.owner) ? attachmentItem.owner : null;
  const baseOwner = cleanPlainObject(explicitOwner) || {};
  const type = safeStr(baseOwner.type);
  const id = safeStr(baseOwner.id);
  const normalized = {
    ...baseOwner,
    ...(type ? { type } : {}),
    ...(id ? { id } : {}),
  };
  return cleanPlainObject(normalized);
}

/**
 * 归一化附件 turn scope 元数据。
 * turnScope 是唯一承载入口。
 */
export function normalizeAttachmentTurnScopeMeta(attachmentItem = {}, normalizedOwner = null) {
  const owner = isPlainObject(normalizedOwner) ? normalizedOwner : normalizeAttachmentOwnerMeta(attachmentItem);
  const explicitTurnScope = isPlainObject(attachmentItem?.turnScope) ? attachmentItem.turnScope : null;
  const ownerTurnScope = isPlainObject(owner?.turnScope) ? owner.turnScope : null;
  const baseTurnScope = cleanPlainObject(explicitTurnScope || ownerTurnScope) || {};
  const normalized = {
    ...baseTurnScope,
    turnScopeId: safeStr(baseTurnScope.turnScopeId),
    dialogProcessId: safeStr(baseTurnScope.dialogProcessId || baseTurnScope.dialog_process_id),
    sessionId: safeStr(baseTurnScope.sessionId),
  };
  return cleanPlainObject(normalized);
}

/**
 * 归一化附件解析结果元数据。
 * parsedResult 是唯一承载入口。
 */
export function normalizeAttachmentParsedResultMeta(attachmentItem = {}) {
  const explicitParsedResult = isPlainObject(attachmentItem?.parsedResult)
    ? attachmentItem.parsedResult
    : null;
  const baseParsedResult = cleanPlainObject(explicitParsedResult) || {};
  const normalized = {
    ...baseParsedResult,
    attachmentId: safeStr(baseParsedResult.attachmentId || baseParsedResult.id),
    path: safeStr(baseParsedResult.path),
    relativePath: safeStr(baseParsedResult.relativePath),
    tool: safeStr(baseParsedResult.tool),
    updatedAt: safeStr(baseParsedResult.updatedAt || baseParsedResult.updated_at),
  };
  return cleanPlainObject(normalized);
}

/**
 * 合并附件元数据（去重）
 */
export function mergeAttachmentMetas(existing = [], incoming = []) {
  const existingList = Array.isArray(existing) ? existing : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  if (!incomingList.length) return existingList;

  const merged = [...existingList];
  const idSet = new Set(
    existingList.map((item) => safeStr(item?.attachmentId)).filter(Boolean),
  );

  for (const item of incomingList) {
    const id = safeStr(item?.attachmentId);
    if (id && idSet.has(id)) continue;
    merged.push(item);
    if (id) idSet.add(id);
  }
  return merged;
}

export function attachmentMatchKeys(item = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return [];
  const name = safeStr(item?.name || item?.fileName || item?.filename);
  const mimeType = safeStr(item?.mimeType || item?.type || item?.mime);
  const size = Number(item?.size || 0);
  const finiteSize = Number.isFinite(size) && size > 0 ? String(size) : "";
  return [
    safeStr(item?.attachmentId || item?.id) ? `id:${safeStr(item?.attachmentId || item?.id)}` : "",
    safeStr(item?.path || item?.filePath) ? `path:${safeStr(item?.path || item?.filePath)}` : "",
    safeStr(item?.relativePath) ? `rel:${safeStr(item?.relativePath)}` : "",
    safeStr(item?.sandboxPath || item?.sandboxViewPath) ? `sandbox:${safeStr(item?.sandboxPath || item?.sandboxViewPath)}` : "",
    name && mimeType && finiteSize ? `name-mime-size:${name}|${mimeType}|${finiteSize}` : "",
    name && finiteSize ? `name-size:${name}|${finiteSize}` : "",
    name && mimeType ? `name-mime:${name}|${mimeType}` : "",
  ].filter(Boolean);
}

export function findMatchingAttachmentMeta(source = {}, candidates = []) {
  const sourceKeys = new Set(attachmentMatchKeys(source));
  if (!sourceKeys.size) return null;
  return (Array.isArray(candidates) ? candidates : []).find((candidate) =>
    attachmentMatchKeys(candidate).some((key) => sourceKeys.has(key)),
  ) || null;
}

export function hasAttachmentMetaValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return safeStr(value).length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function mergeAttachmentMetaPreferRich(rich = {}, raw = {}) {
  const out = { ...(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) };
  for (const [key, value] of Object.entries(rich && typeof rich === "object" && !Array.isArray(rich) ? rich : {})) {
    if (hasAttachmentMetaValue(value)) out[key] = value;
  }
  return out;
}

export function mergeAttachmentListsPreferRich(existing = [], incoming = []) {
  if (!Array.isArray(incoming)) return undefined;
  if (incoming.length === 0) return [];
  const existingList = Array.isArray(existing) ? existing : [];
  return incoming.map((incomingItem) => {
    const match = findMatchingAttachmentMeta(incomingItem, existingList);
    return match ? mergeAttachmentMetaPreferRich(match, incomingItem) : incomingItem;
  });
}

/**
 * 规范化附件元数据（用于系统提示格式化显示）
 * - 将字符串路径转为 { path } 对象
 * - 清理对象字段，移除空值
 */
export function normalizeAttachmentMetas(attachmentMetas = []) {
  const source = Array.isArray(attachmentMetas) ? attachmentMetas : [];
  return source
    .map((attachmentItem) => {
      if (typeof attachmentItem === "string") {
        const pathStr = String(attachmentItem || "").trim();
        return pathStr ? { path: pathStr } : null;
      }
      if (!attachmentItem || typeof attachmentItem !== "object") return null;
      const normalized = {
        attachmentId: safeStr(attachmentItem?.attachmentId),
        name: safeStr(attachmentItem?.name),
        mimeType: safeStr(attachmentItem?.mimeType || attachmentItem?.type),
        size: safeNum(attachmentItem?.size),
        path: safeStr(attachmentItem?.path),
        ...(typeof attachmentItem?.isSandbox === "boolean" ? { isSandbox: attachmentItem.isSandbox } : {}),
      };
      if (!normalized.attachmentId) delete normalized.attachmentId;
      if (!normalized.name) delete normalized.name;
      if (!normalized.mimeType) delete normalized.mimeType;
      if (!normalized.size) delete normalized.size;
      if (!normalized.path) delete normalized.path;
      return Object.keys(normalized).length > 0 ? normalized : null;
    })
    .filter(Boolean);
}

/**
 * 将附件记录映射为元数据
 */
export function mapAttachmentRecordsToMetas(
  records = [],
  { fallbackMimeType = DEFAULT_MIME_TYPE, fallbackGenerationSource = "" } = {},
) {
  const list = Array.isArray(records) ? records : [];
  return list.map((item) => {
    const owner = normalizeAttachmentOwnerMeta(item);
    const turnScope = normalizeAttachmentTurnScopeMeta(item, owner);
    const parsedResult = normalizeAttachmentParsedResultMeta(item);
    return {
      attachmentId: safeStr(item?.attachmentId),
      sessionId: safeStr(item?.sessionId, DEFAULT_ATTACHMENT_SESSION_ID),
      attachmentSource: safeStr(item?.attachmentSource, DEFAULT_ATTACHMENT_SOURCE),
      name: safeStr(item?.name),
      mimeType: safeStr(item?.mimeType, fallbackMimeType),
      size: safeNum(item?.size),
      path: safeStr(item?.path),
      relativePath: safeStr(item?.relativePath),
      sandboxPath: safeStr(item?.sandboxPath || item?.sandboxViewPath),
      downloadUrl: safeStr(item?.downloadUrl),
      previewUrl: safeStr(item?.previewUrl),
      parsedResultUrl: safeStr(item?.parsedResultUrl),
      parsedResultName: safeStr(item?.parsedResultName),
      parsedResultAttachmentId: safeStr(item?.parsedResultAttachmentId),
      transferFilePath: safeStr(item?.transferFilePath),
      generatedByModel: item?.generatedByModel === true,
      generationSource: safeStr(item?.generationSource, fallbackGenerationSource),
      ...(typeof item?.isSandbox === "boolean" ? { isSandbox: item.isSandbox } : {}),
      ...(owner ? { owner } : {}),
      ...(turnScope ? { turnScope } : {}),
      ...(parsedResult ? { parsedResult } : {}),
    };
  });
}

/**
 * 将附件元数据转换为标准 semantic-transfer payload。
 * 仅用于把 legacy attachmentMetas 适配进标准 transferEnvelopes(s) 流转；
 * 调用方不应再把 attachmentMetas 作为新的标准输出 mirror。
 */
export function buildTransferPayloadFromAttachmentMetas(attachmentMetas = []) {
  const metas = (Array.isArray(attachmentMetas) ? attachmentMetas : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item));
  if (!metas.length) {
    return { transferEnvelopes: [] };
  }
  const files = metas.map((meta = {}, index) => ({
    filePath: safeStr(
      meta?.sandboxPath ||
        meta?.sandboxViewPath ||
        meta?.relativePath ||
        meta?.path ||
        meta?.name,
    ),
    attachmentMeta: meta,
    role: index === 0 ? "primary" : "secondary",
  }));
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    files,
  };
  return {
    transferEnvelopes: [envelope],
  };
}
