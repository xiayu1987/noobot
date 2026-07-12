/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * 编辑重发场景的附件编辑态 composable。
 * 统一管理历史附件回填、新增文件、移除记录、预览 URL 生命周期与提交 payload 构建。
 *
 * @param {object} options
 * @param {() => object} options.getMessageItem 读取当前消息对象（含 attachments）
 * @param {import("vue").Ref<boolean>} options.operating 操作进行中标志，用于阻止并发编辑
 */
import { computed, onBeforeUnmount, ref } from "vue";
import {
  attachmentKey,
  attachmentMime,
  attachmentName,
  cloneHistoryAttachment,
  createClientAttachmentId,
  isImageMime,
  rawFileKey,
} from "./attachmentFormat.js";

export function useMonotonicEditAttachments({ getMessageItem, operating }) {
  const editAttachments = ref([]);
  const removedHistoryAttachmentKeys = ref([]);

  const attachmentStats = computed(() => {
    const items = Array.isArray(editAttachments.value) ? editAttachments.value : [];
    return {
      total: items.length,
      history: items.filter((item) => item?.kind === "history").length,
      added: items.filter((item) => item?.kind === "new").length,
    };
  });

  function revokeEditAttachmentUrls(items = editAttachments.value) {
    for (const item of Array.isArray(items) ? items : []) {
      if (item?.kind === "new" && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
  }

  function resetEditAttachments(nextItems = []) {
    revokeEditAttachmentUrls();
    editAttachments.value = nextItems;
  }

  function initEditAttachments() {
    const messageItem = getMessageItem?.() || {};
    const source = Array.isArray(messageItem?.attachments) ? messageItem.attachments : [];
    const seen = new Set();
    const next = [];
    removedHistoryAttachmentKeys.value = [];
    for (const attachment of source) {
      if (!attachment || typeof attachment !== "object") continue;
      const meta = cloneHistoryAttachment(attachment);
      const key = attachmentKey(meta);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      next.push({
        kind: "history",
        key: key || `history:${next.length}`,
        name: attachmentName(meta),
        mimeType: attachmentMime(meta),
        size: Number(meta?.size || 0) || 0,
        meta,
        previewUrl: isImageMime(attachmentMime(meta)) ? String(meta?.previewUrl || meta?.url || "") : "",
      });
    }
    resetEditAttachments(next);
  }

  function addFiles(files = []) {
    const incoming = Array.from(files || []).filter(Boolean);
    if (!incoming.length) return;
    const seen = new Set(editAttachments.value.map((item) => item.key).filter(Boolean));
    const next = [...editAttachments.value];
    for (const file of incoming) {
      const key = `new:${rawFileKey(file)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const mimeType = file.type || "application/octet-stream";
      next.push({
        kind: "new",
        key,
        clientAttachmentId: createClientAttachmentId(),
        name: file.name,
        mimeType,
        size: file.size || 0,
        raw: file,
        previewUrl: isImageMime(mimeType) ? URL.createObjectURL(file) : "",
      });
    }
    editAttachments.value = next;
  }

  function removeEditAttachment(index) {
    if (operating?.value) return;
    const targetIndex = Number(index);
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= editAttachments.value.length) return;
    const next = [...editAttachments.value];
    const [removed] = next.splice(targetIndex, 1);
    if (removed?.kind === "history" && removed.key) {
      removedHistoryAttachmentKeys.value = [
        ...new Set([...removedHistoryAttachmentKeys.value, removed.key]),
      ];
    }
    revokeEditAttachmentUrls([removed]);
    editAttachments.value = next;
  }

  function buildEditAttachmentPayload() {
    return {
      attachments: editAttachments.value
        .filter((item) => item?.kind === "history")
        .map((item) => cloneHistoryAttachment(item.meta || {})),
      attachmentFiles: editAttachments.value
        .filter((item) => item?.kind === "new" && item.raw)
        .map((item) => ({
          raw: item.raw,
          clientAttachmentId: item.clientAttachmentId,
          name: item.name,
          mimeType: item.mimeType,
          size: item.size,
        })),
      removedAttachmentKeys: [...removedHistoryAttachmentKeys.value],
    };
  }

  function clearEditAttachments() {
    resetEditAttachments();
    removedHistoryAttachmentKeys.value = [];
  }

  onBeforeUnmount(() => revokeEditAttachmentUrls());

  return {
    editAttachments,
    removedHistoryAttachmentKeys,
    attachmentStats,
    initEditAttachments,
    addFiles,
    removeEditAttachment,
    buildEditAttachmentPayload,
    clearEditAttachments,
  };
}
