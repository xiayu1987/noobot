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
import { createAttachmentPreviewState } from "./useMessagePreview/preview-state.js";
import { createAttachmentPreviewController } from "./useMessagePreview/attachment-preview-controller.js";
import { outOfSessionRenderContext } from "./useMarkdownRenderer.js";
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
  const attachmentPreview = createAttachmentPreviewState();
  const attachmentController = createAttachmentPreviewController({
    userId,
    attachmentService,
    translate,
    notify,
    isImageMime,
    attachmentPreview,
  });
  const downloadController = createDownloadController({
    userId,
    attachmentService,
    translate,
    notify,
  });
  const copyController = createMarkdownCopyController({
    translate,
    notify,
    renderMarkdown,
    attachmentPreview: attachmentPreview.state,
  });

  onBeforeUnmount(() => {
    attachmentPreview.reset();
  });

  return {
    ...projectPreviewState(attachmentPreview.state),
    ...attachmentController,
    ...downloadController,
    ...copyController,
    closeAttachmentPreview: attachmentPreview.reset,
  };
}

function projectPreviewState(attachmentPreview) {
  return {
    attachmentPreviewVisible: attachmentPreview.visible,
    attachmentPreviewType: attachmentPreview.type,
    attachmentPreviewUrl: attachmentPreview.url,
    attachmentPreviewName: attachmentPreview.name,
    attachmentPreviewLoading: attachmentPreview.loading,
    attachmentPreviewError: attachmentPreview.error,
    attachmentPreviewTextContent: attachmentPreview.textContent,
  };
}

function createDownloadController({ userId, attachmentService, translate, notify }) {
  function assertOk(response) {
    if (!response?.ok) {
      throw new Error(translate("message.downloadFailedHttp", { status: response?.status }));
    }
  }
  async function runDownload(task) {
    try {
      await task();
    } catch (error) {
      notify({ type: "error", message: error?.message || translate("message.downloadFailed") });
    }
  }
  async function downloadFromUrl(url, fileName) {
    const response = await attachmentService.fetchUrl(url);
    assertOk(response);
    await triggerBlobDownload(await response.blob(), fileName);
  }
  const options = () => ({ userId: text(userId) });
  return {
    onDownloadAttachment(item = {}) {
      return runDownload(() =>
        downloadFromUrl(resolveAttachmentAccessMeta(item, options()).url, item.name),
      );
    },
    onDownloadParsedResult(item = {}) {
      return runDownload(async () => {
        const meta = resolveParsedResultAccessMeta(item, options());
        if (!meta) throw new Error(translate("message.downloadFailed"));
        const parsedItem = buildParsedResultPreviewItem(item);
        await downloadFromUrl(
          meta.url,
          parsedItem?.name || translate("message.parsedResultDefaultName"),
        );
      });
    },
  };
}

function createMarkdownCopyController({ translate, notify, renderMarkdown, attachmentPreview }) {
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
    onCopyAttachmentMarkdownRich: () =>
      copyRich(attachmentPreview.textContent.value, outOfSessionRenderContext(translate)),
    onCopyAttachmentMarkdownText: () => copyText(attachmentPreview.textContent.value),
    onCopyMessageMarkdownRich: ({
      textContent,
      attachmentRefIndex,
      linkSnapshots,
      messageIndex,
      workspaceRootDirectory,
    }) =>
      copyRich(textContent, {
        attachmentRefIndex,
        linkSnapshots,
        messageIndex,
        workspaceRootDirectory,
        translate,
      }),
    onCopyMessageMarkdownText: (textContent) => copyText(textContent),
  };
}
