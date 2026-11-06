/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildParsedResultPreviewItem,
  resolveAttachmentAccessMeta,
  resolveParsedResultRelation,
} from "../../../../../infrastructure/api/attachments/attachmentAccess.js";
import { describeFilePreview, FILE_PREVIEW_URL_TYPES } from "@noobot/attachment-protocol/preview";
import { text } from "@noobot/shared/value";
import { authenticatedResourceAccess } from "../../../../../infrastructure/http/authenticatedHttpService.js";
import { readFilePreviewText } from "../../../../../shared/composables/useFilePreview.js";

export function createAttachmentPreviewController({
  userId,
  attachmentService,
  translate,
  notify,
  attachmentPreview,
}) {
  const options = () => ({ userId: text(userId) });
  function descriptor(item) {
    return describeFilePreview({
      name: text(item.name),
      mimeType: text(item.mimeType),
      size: item.size ?? null,
    });
  }
  async function openResolvedAttachmentPreview(item = {}) {
    const file = descriptor(item);
    if (file.overLimit) {
      attachmentPreview.reset();
      notify({ type: "warning", message: translate("message.previewFileTooLarge") });
      return;
    }
    const { url } = resolveAttachmentAccessMeta(item, options());
    await attachmentPreview.load(async () => ({
      descriptor: file,
      readText: async (signal) =>
        readFilePreviewText(await attachmentService.fetchUrl(url, { signal }), file),
      editable: false,
      authorizeResource: FILE_PREVIEW_URL_TYPES.has(file.type)
        ? (signal) => authenticatedResourceAccess(url, signal)
        : undefined,
    }));
  }
  async function openParsedResultPreview(item = {}) {
    const parsed = buildParsedResultPreviewItem(item);
    if (!parsed) return;
    await openResolvedAttachmentPreview(parsed);
  }
  function openAttachmentPreview(item = {}) {
    return descriptor(item).type === "office" && resolveParsedResultRelation(item)
      ? openParsedResultPreview(item)
      : openResolvedAttachmentPreview(item);
  }
  function canPreviewAttachment(item = {}) {
    const file = descriptor(item);
    if (file.overLimit) return false;
    return file.type === "office"
      ? Boolean(resolveParsedResultRelation(item))
      : file.type !== "unsupported";
  }
  function canPreviewParsedResult(item = {}) {
    const parsed = buildParsedResultPreviewItem(item);
    return Boolean(parsed) && !descriptor(parsed).overLimit;
  }
  return {
    openResolvedAttachmentPreview,
    openParsedResultPreview,
    openAttachmentPreview,
    canPreviewAttachment,
    canPreviewParsedResult,
  };
}
