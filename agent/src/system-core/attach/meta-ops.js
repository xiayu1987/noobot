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
  return list.map((item) => ({
    attachmentId: safeStr(item?.attachmentId),
    sessionId: safeStr(item?.sessionId, DEFAULT_ATTACHMENT_SESSION_ID),
    attachmentSource: safeStr(item?.attachmentSource, DEFAULT_ATTACHMENT_SOURCE),
    name: safeStr(item?.name),
    mimeType: safeStr(item?.mimeType, fallbackMimeType),
    size: safeNum(item?.size),
    path: safeStr(item?.path),
    relativePath: safeStr(item?.relativePath),
    generatedByModel: item?.generatedByModel === true,
    generationSource: safeStr(item?.generationSource, fallbackGenerationSource),
    parsedResultAttachmentId: safeStr(item?.parsedResultAttachmentId),
    parsedResultPath: safeStr(item?.parsedResultPath),
    parsedResultRelativePath: safeStr(item?.parsedResultRelativePath),
    parsedResultTool: safeStr(item?.parsedResultTool),
    parsedResultUpdatedAt: safeStr(item?.parsedResultUpdatedAt),
  }));
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
    return { transferResult: null, transferEnvelopes: [] };
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
    filePath: safeStr(files[0]?.filePath),
    files,
  };
  return {
    transferResult: { ok: true, status: "file", envelope },
    transferEnvelopes: [envelope],
  };
}
