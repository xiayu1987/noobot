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
import { buildNoCopyableSet, handleCopyMarkdown } from "./useMessagePreview/markdown-copy.js";
import {
  createAttachmentPreviewState,
  createFilePreviewState,
} from "./useMessagePreview/preview-state.js";
import { createFileDownloadController } from "./useMessagePreview/file-download-controller.js";
import { createFilePreviewController } from "./useMessagePreview/file-preview-controller.js";
import { createAttachmentPreviewController } from "./useMessagePreview/attachment-preview-controller.js";
import { canPreviewFileItem } from "./useMessagePreview/file-preview-capabilities.js";

export function useMessagePreview({
  userId = "",
  attachmentService = defaultAttachmentService,
  isImageMime = () => false,
  renderMarkdown = () => "",
  notify = () => {},
} = {}) {
  const { translate } = useLocale();
  const filePreview = createFilePreviewState();
  const attachmentPreview = createAttachmentPreviewState();
  const { onDownloadFile } = createFileDownloadController({
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
  const options = () => ({ userId: String(userId || "").trim() });
  return {
    async onDownloadAttachment(item = {}) {
      await downloadFromUrl(
        resolveAttachmentAccessMeta(item, options()).url,
        item.name || "attachment",
      );
    },
    async onDownloadParsedResult(item = {}) {
      const parsedItem = buildParsedResultPreviewItem(item, options());
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
  const noCopyableContentTexts = buildNoCopyableSet(translate, "noCopyableContent");
  const noCopyableTextTexts = buildNoCopyableSet(translate, "noCopyableText");
  const copy = ({ textContent = "", renderedPreviewHtml = "", rich = false } = {}) =>
    handleCopyMarkdown({
      textContent: rich
        ? renderedPreviewHtml || renderMarkdown(String(textContent || ""))
        : String(textContent || ""),
      renderMarkdown,
      translate,
      notify,
      noCopyableContentTexts,
      noCopyableTextTexts,
      rich,
    });
  return {
    onCopyMarkdownRich: (html = "") =>
      copy({ textContent: filePreview.textContent.value, renderedPreviewHtml: html, rich: true }),
    onCopyMarkdownText: () => copy({ textContent: filePreview.textContent.value }),
    onCopyAttachmentMarkdownRich: (html = "") =>
      copy({
        textContent: attachmentPreview.textContent.value,
        renderedPreviewHtml: html,
        rich: true,
      }),
    onCopyAttachmentMarkdownText: () => copy({ textContent: attachmentPreview.textContent.value }),
    onCopyMessageMarkdownRich: ({ textContent = "", renderedPreviewHtml = "" } = {}) =>
      copy({ textContent, renderedPreviewHtml, rich: true }),
    onCopyMessageMarkdownText: (textContent = "") => copy({ textContent }),
  };
}
