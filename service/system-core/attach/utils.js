/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { DEFAULT_ATTACHMENT_SESSION_ID, DEFAULT_ATTACHMENT_SOURCE, DEFAULT_MIME_TYPE } from "./constants.js";
import { safeStr, safeNum } from "../utils/shared-utils.js";

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
  }));
}

/**
 * 将附件元数据追加到 runtime 和 turn 消息
 */
export function appendAttachmentMetasToRuntimeAndTurn({
  runtime = {},
  turnMessageStore = null,
  attachmentMetas = [],
} = {}) {
  const metas = Array.isArray(attachmentMetas) ? attachmentMetas : [];
  if (!metas.length) return;

  if (!Array.isArray(runtime.attachmentMetas)) {
    runtime.attachmentMetas = [];
  }
  runtime.attachmentMetas = mergeAttachmentMetas(runtime.attachmentMetas, metas);

  if (!turnMessageStore || typeof turnMessageStore.updateLast !== "function") {
    return;
  }

  let latestAssistantMessage = null;
  turnMessageStore.updateLast(
    {},
    (msg) => {
      if (safeStr(msg?.role) !== "assistant") return false;
      latestAssistantMessage = msg;
      return true;
    },
  );

  const merged = mergeAttachmentMetas(
    latestAssistantMessage?.attachmentMetas || [],
    metas,
  );
  turnMessageStore.updateLast(
    { attachmentMetas: merged },
    (msg) => safeStr(msg?.role) === "assistant",
  );
}

export { safeStr, safeNum };
