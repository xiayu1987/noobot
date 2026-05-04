/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { onBeforeUnmount, ref } from "vue";
import {
  buildAttachmentUrl,
  downloadWorkspaceFileApi,
  getWorkspaceFileApi,
} from "../../services/api/chatApi";
import {
  copyMarkdownRichAsHtmlPage,
  copyMarkdownText,
} from "../../shared/utils/markdown-copy";
import { useLocale } from "../../shared/i18n/useLocale";
import { zhCNMessages } from "../../shared/i18n/locales/zh-CN";
import { enUSMessages } from "../../shared/i18n/locales/en-US";

export function useMessagePreview({
  userId = "",
  authFetch = null,
  isImageMime = () => false,
  renderMarkdown = () => "",
  notify = () => {},
} = {}) {
  const { translate } = useLocale();
  const noCopyableContentTexts = new Set([
    "NO_COPYABLE_CONTENT",
    String(zhCNMessages?.message?.noCopyableContent || "").trim(),
    String(enUSMessages?.message?.noCopyableContent || "").trim(),
    String(translate("message.noCopyableContent") || "").trim(),
  ]);
  const noCopyableTextTexts = new Set([
    "NO_COPYABLE_TEXT",
    String(zhCNMessages?.message?.noCopyableText || "").trim(),
    String(enUSMessages?.message?.noCopyableText || "").trim(),
    String(translate("message.noCopyableText") || "").trim(),
  ]);
  const matchesAnyText = (messageText = "", textSet = new Set()) =>
    [...textSet].filter(Boolean).some((candidateText) =>
      String(messageText || "").includes(candidateText),
    );
  const previewVisible = ref(false);
  const previewLoading = ref(false);
  const previewError = ref("");
  const previewFileName = ref("");
  const previewMode = ref("text");
  const previewTextContent = ref("");
  const previewImageUrl = ref("");
  const attachmentPreviewVisible = ref(false);
  const attachmentPreviewType = ref("");
  const attachmentPreviewUrl = ref("");
  const attachmentPreviewName = ref("");
  const attachmentPreviewLoading = ref(false);
  const attachmentPreviewError = ref("");
  const attachmentPreviewTextContent = ref("");

  function getFileExtension(fileName = "") {
    const normalized = String(fileName || "").trim().toLowerCase();
    const idx = normalized.lastIndexOf(".");
    if (idx < 0) return "";
    return normalized.slice(idx + 1);
  }

  function isMarkdownFile(fileName = "") {
    return new Set(["md", "markdown", "mdx"]).has(getFileExtension(fileName));
  }

  function isImageFile(fileName = "") {
    return new Set([
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "bmp",
      "svg",
      "ico",
      "avif",
    ]).has(getFileExtension(fileName));
  }

  function isMarkdownMime(mimeType = "", fileName = "") {
    const normalizedMimeType = String(mimeType || "").trim().toLowerCase();
    const normalizedFileName = String(fileName || "").trim().toLowerCase();
    return (
      normalizedMimeType === "text/markdown" ||
      normalizedMimeType === "text/x-markdown" ||
      normalizedMimeType === "application/markdown" ||
      normalizedMimeType === "application/x-markdown" ||
      normalizedFileName.endsWith(".md") ||
      normalizedFileName.endsWith(".markdown") ||
      normalizedFileName.endsWith(".mdx")
    );
  }

  function isTextPreviewMime(mimeType = "") {
    const normalizedMimeType = String(mimeType || "").trim().toLowerCase();
    return (
      normalizedMimeType.startsWith("text/") ||
      normalizedMimeType.includes("json") ||
      normalizedMimeType.includes("xml") ||
      normalizedMimeType.includes("yaml") ||
      normalizedMimeType.includes("javascript")
    );
  }

  function canPreviewAttachment(attachmentItem = {}) {
    const attachmentMimeType = String(attachmentItem?.mimeType || "").trim();
    const attachmentName = String(attachmentItem?.name || "").trim();
    return (
      isImageMime(attachmentMimeType) ||
      attachmentMimeType.startsWith("video/") ||
      isTextPreviewMime(attachmentMimeType) ||
      isMarkdownMime(attachmentMimeType, attachmentName)
    );
  }

  async function onDownloadFile(fileItem = {}) {
    const normalizedUserId = String(userId || "").trim();
    const relativePath = String(fileItem?.relativePath || "").trim();
    if (!normalizedUserId || !relativePath) return;
    try {
      const res = await downloadWorkspaceFileApi(
        { userId: normalizedUserId, path: relativePath },
        { fetcher: authFetch || undefined },
      );
      if (!res.ok) {
        let errorText = translate("message.downloadFailedHttp", { status: res.status });
        try {
          const data = await res.json();
          if (data?.error) errorText = String(data.error);
        } catch {}
        throw new Error(errorText);
      }
      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = String(fileItem?.fileName || "download");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      notify({ type: "error", message: error?.message || translate("message.downloadFailed") });
    }
  }

  async function onDownloadAttachment(attachmentItem = {}) {
    const attachmentUrl = String(
      attachmentItem?.previewUrl ||
        buildAttachmentUrl({
          userId: String(userId || "").trim(),
          attachmentId: String(attachmentItem?.attachmentId || "").trim(),
          sessionId: String(attachmentItem?.sessionId || "").trim(),
          attachmentSource: String(attachmentItem?.attachmentSource || "").trim(),
        }) ||
        "",
    ).trim();
    if (!attachmentUrl) return;
    try {
      const runFetch = authFetch || fetch;
      const res = await runFetch(attachmentUrl);
      if (!res?.ok) {
        throw new Error(translate("message.downloadFailedHttp", { status: res?.status || 500 }));
      }
      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = String(attachmentItem?.name || "attachment");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      notify({ type: "error", message: error?.message || translate("message.downloadFailed") });
    }
  }

  function cleanupPreviewImageUrl() {
    if (!previewImageUrl.value) return;
    URL.revokeObjectURL(previewImageUrl.value);
    previewImageUrl.value = "";
  }

  async function openAttachmentPreview(attachmentItem = {}) {
    const attachmentMimeType = String(attachmentItem?.mimeType || "").trim();
    const attachmentName = String(attachmentItem?.name || "").trim();
    const attachmentPreviewSourceUrl = String(
      attachmentItem?.previewUrl ||
        buildAttachmentUrl({
          userId: String(userId || "").trim(),
          attachmentId: String(attachmentItem?.attachmentId || "").trim(),
          sessionId: String(attachmentItem?.sessionId || "").trim(),
          attachmentSource: String(attachmentItem?.attachmentSource || "").trim(),
        }) ||
        "",
    ).trim();
    if (!attachmentPreviewSourceUrl) return;
    const isImageAttachment = isImageMime(attachmentMimeType);
    const isVideoAttachment = attachmentMimeType.startsWith("video/");
    if (isImageAttachment || isVideoAttachment) {
      attachmentPreviewType.value = isImageAttachment ? "image" : "video";
      attachmentPreviewUrl.value = attachmentPreviewSourceUrl;
      attachmentPreviewName.value = attachmentName;
      attachmentPreviewError.value = "";
      attachmentPreviewTextContent.value = "";
      attachmentPreviewLoading.value = false;
      attachmentPreviewVisible.value = true;
      return;
    }
    if (
      !isTextPreviewMime(attachmentMimeType) &&
      !isMarkdownMime(attachmentMimeType, attachmentName)
    ) {
      return;
    }
    attachmentPreviewVisible.value = true;
    attachmentPreviewLoading.value = true;
    attachmentPreviewError.value = "";
    attachmentPreviewTextContent.value = "";
    attachmentPreviewUrl.value = "";
    attachmentPreviewName.value = attachmentName;
    attachmentPreviewType.value = isMarkdownMime(attachmentMimeType, attachmentName)
      ? "markdown"
      : "text";
    try {
      const runFetch = authFetch || fetch;
      const response = await runFetch(attachmentPreviewSourceUrl);
      if (!response?.ok) {
        throw new Error(translate("message.previewFailedHttp", { status: response?.status || 500 }));
      }
      attachmentPreviewTextContent.value = String(await response.text());
    } catch (error) {
      attachmentPreviewError.value = error?.message || translate("message.attachmentPreviewFailed");
    } finally {
      attachmentPreviewLoading.value = false;
    }
    attachmentPreviewVisible.value = true;
  }

  function closeAttachmentPreview() {
    attachmentPreviewVisible.value = false;
    attachmentPreviewType.value = "";
    attachmentPreviewUrl.value = "";
    attachmentPreviewName.value = "";
    attachmentPreviewLoading.value = false;
    attachmentPreviewError.value = "";
    attachmentPreviewTextContent.value = "";
  }

  async function openFilePreview(fileItem = {}) {
    const normalizedUserId = String(userId || "").trim();
    const relativePath = String(fileItem?.relativePath || "").trim();
    const fileName = String(fileItem?.fileName || "").trim();
    if (!normalizedUserId || !relativePath || !fileName) return;

    previewVisible.value = true;
    previewLoading.value = true;
    previewError.value = "";
    previewFileName.value = fileName;
    previewMode.value = "text";
    previewTextContent.value = "";
    cleanupPreviewImageUrl();

    try {
      if (isImageFile(fileName)) {
        const downloadRes = await downloadWorkspaceFileApi(
          { userId: normalizedUserId, path: relativePath },
          { fetcher: authFetch || undefined },
        );
        if (!downloadRes.ok) {
          let errorText = translate("message.previewFailedHttp", { status: downloadRes.status });
          try {
            const data = await downloadRes.json();
            if (data?.error) errorText = String(data.error);
          } catch {}
          throw new Error(errorText);
        }
        const blob = await downloadRes.blob();
        previewImageUrl.value = URL.createObjectURL(blob);
        previewMode.value = "image";
        return;
      }

      const res = await getWorkspaceFileApi(
        { userId: normalizedUserId, path: relativePath },
        { fetcher: authFetch || undefined },
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || translate("message.previewFailed"));
      }
      if (data.isText === false) {
        throw new Error(translate("message.fileTypeNotSupported"));
      }
      previewTextContent.value = String(data.content || "");
      previewMode.value = isMarkdownFile(fileName) ? "markdown" : "text";
    } catch (error) {
      previewError.value = error?.message || translate("message.previewFailed");
    } finally {
      previewLoading.value = false;
    }
  }

  function closePreviewDialog() {
    previewVisible.value = false;
    previewLoading.value = false;
    previewError.value = "";
    previewFileName.value = "";
    previewMode.value = "text";
    previewTextContent.value = "";
    cleanupPreviewImageUrl();
  }

  async function onCopyMarkdownRich(renderedPreviewHtml = "") {
    try {
      const rawHtmlContent = String(
        renderedPreviewHtml || renderMarkdown(previewTextContent.value) || "",
      ).trim();
      await copyMarkdownRichAsHtmlPage(rawHtmlContent);
      notify({ type: "success", message: translate("message.copiedHtml") });
    } catch (error) {
      const errorMessage = String(error?.message || translate("message.copyFormatFailed"));
      if (matchesAnyText(errorMessage, noCopyableContentTexts)) {
        notify({ type: "warning", message: errorMessage });
        return;
      }
      notify({ type: "error", message: errorMessage });
    }
  }

  async function onCopyMarkdownText() {
    try {
      await copyMarkdownText(String(previewTextContent.value || ""));
      notify({ type: "success", message: translate("message.copiedMarkdown") });
    } catch (error) {
      const errorMessage = String(error?.message || translate("message.copyTextFailed"));
      if (matchesAnyText(errorMessage, noCopyableTextTexts)) {
        notify({ type: "warning", message: errorMessage });
        return;
      }
      notify({ type: "error", message: errorMessage });
    }
  }

  async function onCopyAttachmentMarkdownRich(renderedPreviewHtml = "") {
    try {
      const rawHtmlContent = String(
        renderedPreviewHtml || renderMarkdown(attachmentPreviewTextContent.value) || "",
      ).trim();
      await copyMarkdownRichAsHtmlPage(rawHtmlContent);
      notify({ type: "success", message: translate("message.copiedHtml") });
    } catch (error) {
      const errorMessage = String(error?.message || translate("message.copyFormatFailed"));
      if (matchesAnyText(errorMessage, noCopyableContentTexts)) {
        notify({ type: "warning", message: errorMessage });
        return;
      }
      notify({ type: "error", message: errorMessage });
    }
  }

  async function onCopyAttachmentMarkdownText() {
    try {
      await copyMarkdownText(String(attachmentPreviewTextContent.value || ""));
      notify({ type: "success", message: translate("message.copiedMarkdown") });
    } catch (error) {
      const errorMessage = String(error?.message || translate("message.copyTextFailed"));
      if (matchesAnyText(errorMessage, noCopyableTextTexts)) {
        notify({ type: "warning", message: errorMessage });
        return;
      }
      notify({ type: "error", message: errorMessage });
    }
  }

  onBeforeUnmount(() => {
    cleanupPreviewImageUrl();
    closeAttachmentPreview();
  });

  return {
    previewVisible,
    previewLoading,
    previewError,
    previewFileName,
    previewMode,
    previewTextContent,
    previewImageUrl,
    attachmentPreviewVisible,
    attachmentPreviewType,
    attachmentPreviewUrl,
    attachmentPreviewName,
    attachmentPreviewLoading,
    attachmentPreviewError,
    attachmentPreviewTextContent,
    canPreviewAttachment,
    openAttachmentPreview,
    closeAttachmentPreview,
    openFilePreview,
    closePreviewDialog,
    onDownloadFile,
    onDownloadAttachment,
    onCopyMarkdownRich,
    onCopyMarkdownText,
    onCopyAttachmentMarkdownRich,
    onCopyAttachmentMarkdownText,
  };
}
