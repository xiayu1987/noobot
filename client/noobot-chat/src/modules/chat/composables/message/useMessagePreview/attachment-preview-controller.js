/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildParsedResultPreviewItem,
  resolveAttachmentAccessMeta,
  resolveParsedResultAccessMeta,
} from "../../../../../infrastructure/api/attachments/attachmentAccess.js";
import {
  isAudioPreviewMime,
  isImagePreviewType,
  isMarkdownMime,
  isNonImagePreviewOverSizeLimit,
  isOfficeFile,
  isOfficeMime,
  isTextPreviewFile,
  isTextPreviewMime,
} from "./file-type.js";

export function createAttachmentPreviewController({
  userId,
  attachmentService,
  translate,
  notify,
  isImageMime,
  attachmentPreview,
}) {
  const normalizedUserId = () => String(userId || "").trim();
  const accessOptions = () => ({ userId: normalizedUserId() });
  const resolveAttachmentUrl = (item) => resolveAttachmentAccessMeta(item, accessOptions()).url;
  const resolveParsedResultUrl = (item) =>
    resolveParsedResultAccessMeta(item, accessOptions())?.url || "";

  async function openResolvedAttachmentPreview(attachmentItem = {}) {
    attachmentPreview.reset();
    const descriptor = createAttachmentDescriptor(attachmentItem, isImageMime);
    if (descriptor.overLimit) {
      notify({ type: "warning", message: translate("message.previewFileTooLarge") });
      return;
    }
    const targetUrl = resolveAttachmentUrl(attachmentItem);
    if (!targetUrl || !descriptor.previewType) return;
    if (["image", "video", "audio"].includes(descriptor.previewType)) {
      await openMediaPreview(
        targetUrl,
        descriptor,
        attachmentService,
        translate,
        attachmentPreview,
      );
      return;
    }
    await openTextPreview(targetUrl, descriptor, attachmentService, translate, attachmentPreview);
  }

  async function openParsedResultPreview(attachmentItem = {}) {
    const parsedItem = buildParsedResultPreviewItem(attachmentItem, accessOptions());
    if (!parsedItem) return;
    await openResolvedAttachmentPreview({
      ...parsedItem,
      previewUrl: resolveParsedResultUrl(attachmentItem),
    });
  }

  async function openAttachmentPreview(attachmentItem = {}) {
    if (isOfficeAttachmentWithParsedResult(attachmentItem, accessOptions())) {
      await openParsedResultPreview(attachmentItem);
      return;
    }
    await openResolvedAttachmentPreview(attachmentItem);
  }

  function canPreviewAttachment(attachmentItem = {}) {
    const descriptor = createAttachmentDescriptor(attachmentItem, isImageMime);
    if (descriptor.overLimit) return false;
    if (descriptor.officeLike)
      return Boolean(resolveParsedResultAccessMeta(attachmentItem, accessOptions()));
    return Boolean(descriptor.previewType);
  }

  function canPreviewParsedResult(attachmentItem = {}) {
    const parsedMeta = resolveParsedResultAccessMeta(attachmentItem, accessOptions());
    if (!parsedMeta) return false;
    const parsedItem = buildParsedResultPreviewItem(attachmentItem, accessOptions());
    return !createAttachmentDescriptor(parsedItem, isImageMime).overLimit;
  }

  return {
    openResolvedAttachmentPreview,
    openParsedResultPreview,
    openAttachmentPreview,
    canPreviewAttachment,
    canPreviewParsedResult,
  };
}

function createAttachmentDescriptor(item, isImageMime) {
  const mimeType = String(item?.mimeType || "").trim();
  const name = String(item?.name || "").trim();
  const officeLike = isOfficeMime(mimeType) || isOfficeFile(name);
  return {
    name,
    officeLike,
    overLimit: isNonImagePreviewOverSizeLimit({
      fileItem: item,
      mimeType,
      fileName: name,
      isImageMimeChecker: isImageMime,
    }),
    previewType: resolveAttachmentPreviewType({ mimeType, name, officeLike, isImageMime }),
  };
}

function resolveAttachmentPreviewType({ mimeType, name, officeLike, isImageMime }) {
  if (!officeLike && isImagePreviewType(mimeType, name, isImageMime)) return "image";
  if (!officeLike && mimeType.startsWith("video/")) return "video";
  if (!officeLike && isAudioPreviewMime(mimeType)) return "audio";
  if (officeLike || isMarkdownMime(mimeType, name)) return "markdown";
  if (isTextPreviewMime(mimeType) || isTextPreviewFile(name)) return "text";
  return "";
}

async function openMediaPreview(url, descriptor, attachmentService, translate, preview) {
  beginAttachmentPreview(preview.state, descriptor);
  try {
    const response = await fetchPreview(url, attachmentService, translate);
    preview.setObjectUrl(await response.blob());
  } catch (error) {
    preview.state.error.value = error?.message || translate("message.attachmentPreviewFailed");
  } finally {
    preview.state.loading.value = false;
  }
}

async function openTextPreview(url, descriptor, attachmentService, translate, preview) {
  beginAttachmentPreview(preview.state, descriptor);
  try {
    const response = await fetchPreview(url, attachmentService, translate);
    preview.state.textContent.value = String(await response.text());
  } catch (error) {
    preview.state.error.value = error?.message || translate("message.attachmentPreviewFailed");
  } finally {
    preview.state.loading.value = false;
  }
}

function beginAttachmentPreview(state, descriptor) {
  state.visible.value = true;
  state.loading.value = true;
  state.error.value = "";
  state.textContent.value = "";
  state.url.value = "";
  state.name.value = descriptor.name;
  state.type.value = descriptor.previewType;
}

async function fetchPreview(url, attachmentService, translate) {
  const response = await attachmentService.fetchUrl(url);
  if (response?.ok) return response;
  throw new Error(translate("message.previewFailedHttp", { status: response?.status || 500 }));
}

function isOfficeAttachmentWithParsedResult(attachmentItem, accessOptions) {
  const mimeType = String(attachmentItem?.mimeType || "").trim();
  const name = String(attachmentItem?.name || "").trim();
  return (
    (isOfficeMime(mimeType) || isOfficeFile(name)) &&
    Boolean(resolveParsedResultAccessMeta(attachmentItem, accessOptions))
  );
}
