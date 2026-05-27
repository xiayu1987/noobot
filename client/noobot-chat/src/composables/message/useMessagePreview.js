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
import { zhCNMessages } from "noobot-i18n/client/locales/zh-CN";
import { enUSMessages } from "noobot-i18n/client/locales/en-US";

// --- 常量集合（避免每次调用 new Set） ---
const MARKDOWN_EXTS = new Set(["md", "markdown", "mdx"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif"]);
const OFFICE_EXTS = new Set([
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "rtf",
  "odt",
  "ods",
  "odp",
]);
const MARKDOWN_MIMES = new Set(["text/markdown", "text/x-markdown", "application/markdown", "application/x-markdown"]);

// --- 通用工具函数 ---

function buildNoCopyableSet(translate, key) {
  return new Set([
    key,
    String(zhCNMessages?.message?.[key] || "").trim(),
    String(enUSMessages?.message?.[key] || "").trim(),
    String(translate(`message.${key}`) || "").trim(),
  ]);
}

function matchesAnyText(messageText = "", textSet) {
  return [...textSet].filter(Boolean).some((candidateText) =>
    String(messageText || "").includes(candidateText),
  );
}

function getFileExtension(fileName = "") {
  const normalized = String(fileName || "").trim().toLowerCase();
  const idx = normalized.lastIndexOf(".");
  return idx < 0 ? "" : normalized.slice(idx + 1);
}

function isMarkdownFile(fileName = "") {
  return MARKDOWN_EXTS.has(getFileExtension(fileName));
}

function isImageFile(fileName = "") {
  return IMAGE_EXTS.has(getFileExtension(fileName));
}

function isOfficeFile(fileName = "") {
  return OFFICE_EXTS.has(getFileExtension(fileName));
}

function isMarkdownMime(mimeType = "", fileName = "") {
  const mime = String(mimeType || "").trim().toLowerCase();
  const name = String(fileName || "").trim().toLowerCase();
  return MARKDOWN_MIMES.has(mime) || name.endsWith(".md") || name.endsWith(".markdown") || name.endsWith(".mdx");
}

function isTextPreviewMime(mimeType = "") {
  const mime = String(mimeType || "").trim().toLowerCase();
  return mime.startsWith("text/") || ["json", "xml", "yaml", "javascript"].some((kw) => mime.includes(kw));
}

function isAudioPreviewMime(mimeType = "") {
  const mime = String(mimeType || "").trim().toLowerCase();
  return mime.startsWith("audio/");
}

function isOfficeMime(mimeType = "") {
  const mime = String(mimeType || "").trim().toLowerCase();
  return (
    mime.includes("msword") ||
    mime.includes("officedocument") ||
    mime.includes("ms-excel") ||
    mime.includes("ms-powerpoint") ||
    mime.includes("opendocument") ||
    mime.includes("rtf")
  );
}

function hasParsedResult(attachmentItem = {}) {
  return Boolean(
    String(attachmentItem?.parsedResultAttachmentId || "").trim() ||
      String(attachmentItem?.parsedResultUrl || "").trim(),
  );
}

function parseContentDisposition(contentDisposition = "") {
  if (!contentDisposition) return "";
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try { return decodeURIComponent(String(utf8Match[1]).trim()); } catch { return String(utf8Match[1]).trim(); }
  }
  const basicMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return String(basicMatch?.[1] || "").trim();
}

async function triggerBlobDownload(blob, fileName, translate, notify) {
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = String(fileName || "download");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(downloadUrl);
}

async function handleCopyMarkdown({ textContent, renderMarkdown, translate, notify, noCopyableContentTexts, noCopyableTextTexts, rich = true }) {
  try {
    if (rich) {
      const rawHtmlContent = String(textContent || renderMarkdown(textContent) || "").trim();
      await copyMarkdownRichAsHtmlPage(rawHtmlContent);
      notify({ type: "success", message: translate("message.copiedHtml") });
    } else {
      await copyMarkdownText(String(textContent || ""));
      notify({ type: "success", message: translate("message.copiedMarkdown") });
    }
  } catch (error) {
    const errorMessage = String(error?.message || translate(rich ? "message.copyFormatFailed" : "message.copyTextFailed"));
    const targetSet = rich ? noCopyableContentTexts : noCopyableTextTexts;
    if (matchesAnyText(errorMessage, targetSet)) {
      notify({ type: "warning", message: errorMessage });
      return;
    }
    notify({ type: "error", message: errorMessage });
  }
}

export function useMessagePreview({
  userId = "",
  authFetch = null,
  isImageMime = () => false,
  renderMarkdown = () => "",
  notify = () => {},
} = {}) {
  const { translate } = useLocale();
  const noCopyableContentTexts = buildNoCopyableSet(translate, "noCopyableContent");
  const noCopyableTextTexts = buildNoCopyableSet(translate, "noCopyableText");

  // --- 预览状态（统一结构） ---
  const filePreview = {
    visible: ref(false),
    loading: ref(false),
    error: ref(""),
    fileName: ref(""),
    mode: ref("text"),
    textContent: ref(""),
    imageUrl: ref(""),
  };
  const attachmentPreview = {
    visible: ref(false),
    type: ref(""),
    url: ref(""),
    name: ref(""),
    loading: ref(false),
    error: ref(""),
    textContent: ref(""),
  };

  function cleanupPreviewImageUrl() {
    if (!filePreview.imageUrl.value) return;
    URL.revokeObjectURL(filePreview.imageUrl.value);
    filePreview.imageUrl.value = "";
  }

  function resetPreviewState() {
    filePreview.visible.value = false;
    filePreview.loading.value = false;
    filePreview.error.value = "";
    filePreview.fileName.value = "";
    filePreview.mode.value = "text";
    filePreview.textContent.value = "";
    cleanupPreviewImageUrl();
  }

  function resetAttachmentPreviewState() {
    attachmentPreview.visible.value = false;
    attachmentPreview.type.value = "";
    attachmentPreview.url.value = "";
    attachmentPreview.name.value = "";
    attachmentPreview.loading.value = false;
    attachmentPreview.error.value = "";
    attachmentPreview.textContent.value = "";
  }

  function resolveAttachmentUrl(attachmentItem = {}) {
    return String(
      attachmentItem?.previewUrl ||
        buildAttachmentUrl({
          userId: String(userId || "").trim(),
          attachmentId: String(attachmentItem?.attachmentId || "").trim(),
          sessionId: String(attachmentItem?.sessionId || "").trim(),
          attachmentSource: String(attachmentItem?.attachmentSource || "").trim(),
        }) || "",
    ).trim();
  }

  async function runDownloadFromUrl({
    url = "",
    fileName = "download",
    errorI18nKey = "message.downloadFailed",
  } = {}) {
    if (!url) return;
    try {
      const runFetch = authFetch || fetch;
      const response = await runFetch(url);
      if (!response?.ok) {
        throw new Error(
          translate("message.downloadFailedHttp", { status: response?.status || 500 }),
        );
      }
      const blob = await response.blob();
      await triggerBlobDownload(blob, fileName, translate, notify);
    } catch (error) {
      notify({ type: "error", message: error?.message || translate(errorI18nKey) });
    }
  }

  async function copyMarkdownFromText({
    textContent = "",
    renderedPreviewHtml = "",
    rich = false,
  } = {}) {
    const content = rich
      ? renderedPreviewHtml || renderMarkdown(String(textContent || ""))
      : String(textContent || "");
    await handleCopyMarkdown({
      textContent: content,
      renderMarkdown,
      translate,
      notify,
      noCopyableContentTexts,
      noCopyableTextTexts,
      rich,
    });
  }

  // --- 下载 ---

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
      const fileName = parseContentDisposition(res.headers?.get("content-disposition") || "") || fileItem?.fileName || "download";
      await triggerBlobDownload(blob, fileName, translate, notify);
    } catch (error) {
      notify({ type: "error", message: error?.message || translate("message.downloadFailed") });
    }
  }

  async function onDownloadAttachment(attachmentItem = {}) {
    await runDownloadFromUrl({
      url: resolveAttachmentUrl(attachmentItem),
      fileName: attachmentItem?.name || "attachment",
      errorI18nKey: "message.downloadFailed",
    });
  }

  // --- 文件预览 ---

  async function openFilePreview(fileItem = {}) {
    const normalizedUserId = String(userId || "").trim();
    const relativePath = String(fileItem?.relativePath || "").trim();
    const fileName = String(fileItem?.fileName || "").trim();
    if (!normalizedUserId || !relativePath || !fileName) return;

    filePreview.visible.value = true;
    filePreview.loading.value = true;
    filePreview.error.value = "";
    filePreview.fileName.value = fileName;
    filePreview.mode.value = "text";
    filePreview.textContent.value = "";
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
        filePreview.imageUrl.value = URL.createObjectURL(blob);
        filePreview.mode.value = "image";
        return;
      }

      const res = await getWorkspaceFileApi(
        { userId: normalizedUserId, path: relativePath },
        { fetcher: authFetch || undefined },
      );
      const contentType = String(res.headers?.get("content-type") || "").toLowerCase();
      let data = null;
      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const rawText = await res.text();
        try {
          data = JSON.parse(String(rawText || "{}"));
        } catch {
          throw new Error(translate("message.previewFailedHttp", { status: res.status || 500 }));
        }
      }
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || translate("message.previewFailed"));
      }
      if (data.isText === false) {
        throw new Error(translate("message.fileTypeNotSupported"));
      }
      filePreview.textContent.value = String(data.content || "");
      filePreview.mode.value = isMarkdownFile(fileName) ? "markdown" : "text";
    } catch (error) {
      filePreview.error.value = error?.message || translate("message.previewFailed");
    } finally {
      filePreview.loading.value = false;
    }
  }

  function closePreviewDialog() {
    resetPreviewState();
  }

  // --- 附件预览 ---

  function canPreviewAttachment(attachmentItem = {}) {
    const mimeType = String(attachmentItem?.mimeType || "").trim();
    const name = String(attachmentItem?.name || "").trim();
    const officeLike = isOfficeMime(mimeType) || isOfficeFile(name);
    if (officeLike) return hasParsedResult(attachmentItem);
    // Source preview is allowed for image/audio/video/text.
    return (
      isImageMime(mimeType) ||
      mimeType.startsWith("video/") ||
      isAudioPreviewMime(mimeType) ||
      isTextPreviewMime(mimeType) ||
      isMarkdownMime(mimeType, name)
    );
  }

  async function openAttachmentPreview(attachmentItem = {}) {
    const mimeType = String(attachmentItem?.mimeType || "").trim();
    const name = String(attachmentItem?.name || "").trim();
    const officeLike = isOfficeMime(mimeType) || isOfficeFile(name);
    const parsedResultUrl = String(attachmentItem?.parsedResultUrl || "").trim();
    const sourceUrl = resolveAttachmentUrl(attachmentItem);
    const targetUrl = officeLike ? parsedResultUrl : sourceUrl;
    if (!targetUrl) return;

    const isImage = !officeLike && isImageMime(mimeType);
    const isVideo = !officeLike && mimeType.startsWith("video/");
    const isAudio = !officeLike && isAudioPreviewMime(mimeType);
    if (isImage || isVideo || isAudio) {
      attachmentPreview.type.value = isImage ? "image" : isVideo ? "video" : "audio";
      attachmentPreview.url.value = targetUrl;
      attachmentPreview.name.value = name;
      attachmentPreview.error.value = "";
      attachmentPreview.textContent.value = "";
      attachmentPreview.loading.value = false;
      attachmentPreview.visible.value = true;
      return;
    }
    const markdownMode = officeLike
      ? true
      : isMarkdownMime(mimeType, name);
    if (!markdownMode && !isTextPreviewMime(mimeType)) return;

    attachmentPreview.visible.value = true;
    attachmentPreview.loading.value = true;
    attachmentPreview.error.value = "";
    attachmentPreview.textContent.value = "";
    attachmentPreview.url.value = "";
    attachmentPreview.name.value = officeLike
      ? String(attachmentItem?.parsedResultName || name || "").trim()
      : name;
    attachmentPreview.type.value = markdownMode ? "markdown" : "text";
    try {
      const runFetch = authFetch || fetch;
      const response = await runFetch(targetUrl);
      if (!response?.ok) {
        throw new Error(translate("message.previewFailedHttp", { status: response?.status || 500 }));
      }
      attachmentPreview.textContent.value = String(await response.text());
    } catch (error) {
      attachmentPreview.error.value = error?.message || translate("message.attachmentPreviewFailed");
    } finally {
      attachmentPreview.loading.value = false;
    }
  }

  function closeAttachmentPreview() {
    resetAttachmentPreviewState();
  }

  // --- 复制 ---

  async function onCopyMarkdownRich(renderedPreviewHtml = "") {
    await copyMarkdownFromText({
      textContent: filePreview.textContent.value,
      renderedPreviewHtml,
      rich: true,
    });
  }

  async function onCopyMarkdownText() {
    await copyMarkdownFromText({
      textContent: filePreview.textContent.value,
      rich: false,
    });
  }

  async function onCopyAttachmentMarkdownRich(renderedPreviewHtml = "") {
    await copyMarkdownFromText({
      textContent: attachmentPreview.textContent.value,
      renderedPreviewHtml,
      rich: true,
    });
  }

  async function onCopyAttachmentMarkdownText() {
    await copyMarkdownFromText({
      textContent: attachmentPreview.textContent.value,
      rich: false,
    });
  }

  async function onCopyMessageMarkdownRich({
    textContent = "",
    renderedPreviewHtml = "",
  } = {}) {
    await copyMarkdownFromText({
      textContent,
      renderedPreviewHtml,
      rich: true,
    });
  }

  async function onCopyMessageMarkdownText(textContent = "") {
    await copyMarkdownFromText({
      textContent,
      rich: false,
    });
  }

  onBeforeUnmount(() => {
    cleanupPreviewImageUrl();
    resetAttachmentPreviewState();
  });

  return {
    // 文件预览
    previewVisible: filePreview.visible,
    previewLoading: filePreview.loading,
    previewError: filePreview.error,
    previewFileName: filePreview.fileName,
    previewMode: filePreview.mode,
    previewTextContent: filePreview.textContent,
    previewImageUrl: filePreview.imageUrl,
    // 附件预览
    attachmentPreviewVisible: attachmentPreview.visible,
    attachmentPreviewType: attachmentPreview.type,
    attachmentPreviewUrl: attachmentPreview.url,
    attachmentPreviewName: attachmentPreview.name,
    attachmentPreviewLoading: attachmentPreview.loading,
    attachmentPreviewError: attachmentPreview.error,
    attachmentPreviewTextContent: attachmentPreview.textContent,
    // 方法
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
    onCopyMessageMarkdownRich,
    onCopyMessageMarkdownText,
  };
}
