/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { onBeforeUnmount } from "vue";
import { attachmentService as defaultAttachmentService } from "../../../../infrastructure/api/attachments/attachmentService.js";
import {
  buildParsedResultPreviewItem,
  resolveAttachmentAccessMeta,
  resolveParsedResultAccessMeta,
} from "../../../../infrastructure/api/attachments/attachmentAccess.js";
import { useLocale } from "../../../../shared/i18n/useLocale.js";
import { triggerBlobDownload } from "./useMessagePreview/file-access-log.js";
import { handleCopyMarkdown } from "./useMessagePreview/markdown-copy.js";
import {
  createAttachmentPreviewState,
  createFilePreviewState,
} from "./useMessagePreview/preview-state.js";
import { createFileDownloadController } from "./useMessagePreview/file-download-controller.js";
import { createFilePreviewController } from "./useMessagePreview/file-preview-controller.js";
import { createAttachmentPreviewController } from "./useMessagePreview/attachment-preview-controller.js";
import { canPreviewFileItem } from "./useMessagePreview/file-preview-capabilities.js";
import { requireFunctionDependencies, text } from "@noobot/shared/value";

export function useMessagePreview({
  userId,
  attachmentService = defaultAttachmentService,
  isImageMime,
  renderMarkdown,
  notify,
}) {
  requireFunctionDependencies("useMessagePreview", { isImageMime, renderMarkdown, notify });
  const { translate } = useLocale();
  const filePreview = createFilePreviewState();
  const attachmentPreview = createAttachmentPreviewState();
  const { onDownloadFile, onDownloadWorkspacePath } = createFileDownloadController({
    userId,
    attachmentService,
    translate,
    notify,
  });
  const { openFilePreview } = createFilePreviewController({
    userId,
    attachmentService,
    translate,
    notify,
    isImageMime,
    filePreview,
  });
  const attachmentController = createAttachmentPreviewController({
    userId,
    attachmentService,
    translate,
    notify,
    isImageMime,
    attachmentPreview,
  });
  const downloadController = createAttachmentDownloadController({
    userId,
    attachmentService,
    translate,
    notify,
  });
  const copyController = createMarkdownCopyController({
    translate,
    notify,
    renderMarkdown,
    filePreview: filePreview.state,
    attachmentPreview: attachmentPreview.state,
  });

  onBeforeUnmount(() => {
    filePreview.cleanupImageUrl();
    attachmentPreview.reset();
  });

  return {
    ...projectPreviewState(filePreview.state, attachmentPreview.state),
    ...attachmentController,
    ...downloadController,
    ...copyController,
    canPreviewFile: (fileItem = {}) => canPreviewFileItem(fileItem, userId, isImageMime),
    openFilePreview,
    closePreviewDialog: filePreview.reset,
    closeAttachmentPreview: attachmentPreview.reset,
    onDownloadFile,
    onDownloadWorkspacePath,
  };
}

function projectPreviewState(filePreview, attachmentPreview) {
  return {
    previewVisible: filePreview.visible,
    previewLoading: filePreview.loading,
    previewError: filePreview.error,
    previewFileName: filePreview.fileName,
    previewMode: filePreview.mode,
    previewTextContent: filePreview.textContent,
    previewImageUrl: filePreview.imageUrl,
    attachmentPreviewVisible: attachmentPreview.visible,
    attachmentPreviewType: attachmentPreview.type,
    attachmentPreviewUrl: attachmentPreview.url,
    attachmentPreviewName: attachmentPreview.name,
    attachmentPreviewLoading: attachmentPreview.loading,
    attachmentPreviewError: attachmentPreview.error,
    attachmentPreviewTextContent: attachmentPreview.textContent,
  };
}

function createAttachmentDownloadController({ userId, attachmentService, translate, notify }) {
  async function downloadFromUrl(url, fileName) {
    if (!url) return;
    try {
      const response = await attachmentService.fetchUrl(url);
      if (!response?.ok) {
        throw new Error(
          translate("message.downloadFailedHttp", { status: response?.status || 500 }),
        );
      }
      await triggerBlobDownload(await response.blob(), fileName);
    } catch (error) {
      notify({ type: "error", message: error?.message || translate("message.downloadFailed") });
    }
  }
  const options = () => ({ userId: text(userId) });
  return {
    async onDownloadAttachment(item = {}) {
      await downloadFromUrl(
        resolveAttachmentAccessMeta(item, options()).url,
        item.name || "attachment",
      );
    },
    async onDownloadParsedResult(item = {}) {
      const parsedItem = buildParsedResultPreviewItem(item);
      await downloadFromUrl(
        resolveParsedResultAccessMeta(item, options())?.url || "",
        parsedItem?.name || translate("message.parsedResultDefaultName"),
      );
    },
  };
}

function createMarkdownCopyController({
  translate,
  notify,
  renderMarkdown,
  filePreview,
  attachmentPreview,
}) {
  const copyRich = (markdownText, renderOptions) =>
    handleCopyMarkdown({
      markdownText,
      html: renderMarkdown(markdownText, renderOptions),
      translate,
      notify,
      rich: true,
    });
  const copyText = (markdownText) =>
    handleCopyMarkdown({ markdownText, html: "", translate, notify, rich: false });
  return {
    onCopyMarkdownRich: () => copyRich(filePreview.textContent.value),
    onCopyMarkdownText: () => copyText(filePreview.textContent.value),
    onCopyAttachmentMarkdownRich: () => copyRich(attachmentPreview.textContent.value),
    onCopyAttachmentMarkdownText: () => copyText(attachmentPreview.textContent.value),
    onCopyMessageMarkdownRich: ({ textContent, attachmentRefIndex }) =>
      copyRich(textContent, { attachmentRefIndex, workspaceFileLinks: true }),
    onCopyMessageMarkdownText: (textContent) => copyText(textContent),
  };
}
