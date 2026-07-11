/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { onBeforeUnmount, ref } from "vue";
import {
  downloadHostFileApi,
  downloadWorkspaceFileApi,
  getHostFileApi,
  getWorkspaceFileApi,
} from "../../services/api/chatApi";
import {
  buildParsedResultPreviewItem,
  resolveAttachmentAccessMeta,
  resolveParsedResultAccessMeta,
} from "../../services/api/attachmentAccess";
import {
  copyMarkdownRichAsHtmlPage,
  copyMarkdownText,
} from "../../shared/utils/markdown-copy";
import { useLocale } from "../../shared/i18n/useLocale";
import { zhCNMessages } from "noobot-i18n/client/locales/zh-CN";
import { enUSMessages } from "noobot-i18n/client/locales/en-US";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

// --- 常量集合（避免每次调用 new Set） ---
const MARKDOWN_EXTS = new Set(["md", "markdown", "mdx"]);
const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "jfif",
  "pjpeg",
  "pjp",
  "gif",
  "webp",
  "bmp",
  "svg",
  "ico",
  "avif",
  "apng",
  "tif",
  "tiff",
  "heic",
  "heif",
]);
const TEXT_PREVIEW_EXTS = new Set([
  "txt",
  "text",
  "log",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "ndjson",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "conf",
  "config",
  "env",
  "properties",
  "gitignore",
  "gitattributes",
  "editorconfig",
  "npmrc",
  "yarnrc",
  "dockerignore",
  "sql",
  "graphql",
  "gql",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "vue",
  "svelte",
  "py",
  "rb",
  "php",
  "java",
  "c",
  "cc",
  "cpp",
  "cxx",
  "h",
  "hpp",
  "cs",
  "go",
  "rs",
  "swift",
  "kt",
  "kts",
  "scala",
  "sh",
  // cross-platform-allow: this is a file extension label, not a shell execution dependency.
  "bash",
  "zsh",
  "fish",
  "ps1",
  "bat",
  "cmd",
  "dockerfile",
  "makefile",
]);
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
const NON_IMAGE_PREVIEW_MAX_BYTES = LENGTH_THRESHOLDS.clientPreview.nonImageMaxBytes;

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

function isTextPreviewFile(fileName = "") {
  const normalized = String(fileName || "").trim().toLowerCase();
  if (!normalized) return false;
  if (isMarkdownFile(normalized)) return true;
  if (["dockerfile", "makefile", "license", "readme", "changelog"].includes(normalized)) return true;
  return TEXT_PREVIEW_EXTS.has(getFileExtension(normalized));
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
  if (!mime) return false;
  return mime.startsWith("text/") || [
    "json",
    "xml",
    "yaml",
    "yml",
    "toml",
    "csv",
    "javascript",
    "ecmascript",
    "typescript",
    "x-sh",
    "shellscript",
    "sql",
    "graphql",
    "x-www-form-urlencoded",
  ].some((kw) => mime.includes(kw));
}

function isImagePreviewType(mimeType = "", fileName = "", isImageMimeChecker = () => false) {
  const mime = String(mimeType || "").trim().toLowerCase();
  return Boolean(isImageMimeChecker(mime)) || mime.startsWith("image/") || isImageFile(fileName);
}

function resolveKnownFileSize(fileItem = {}) {
  for (const value of [
    fileItem?.size,
    fileItem?.fileSize,
    fileItem?.bytes,
    fileItem?.contentLength,
    fileItem?.content_length,
  ]) {
    const size = Number(value);
    if (Number.isFinite(size) && size >= 0) return size;
  }
  return null;
}

function isNonImagePreviewOverSizeLimit({
  fileItem = {},
  mimeType = "",
  fileName = "",
  isImageMimeChecker = () => false,
} = {}) {
  if (isImagePreviewType(mimeType, fileName, isImageMimeChecker)) return false;
  const size = resolveKnownFileSize(fileItem);
  return size !== null && size > NON_IMAGE_PREVIEW_MAX_BYTES;
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
  return resolveParsedResultAccessMeta(attachmentItem).hasIdentity;
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

function sanitizeWorkspaceRelativePath(pathValue = "") {
  const normalized = String(pathValue || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
  if (!normalized) return "";
  if (normalized.startsWith("../")) return "";
  if (normalized.includes("/../")) return "";
  if (normalized.endsWith("/..")) return "";
  return normalized;
}

function resolveWorkspaceRelativePath(pathValue = "", userId = "") {
  const normalizedPath = String(pathValue || "").trim().replaceAll("\\", "/");
  if (!normalizedPath) return "";
  if (!normalizedPath.startsWith("/") && !/^[a-zA-Z]:\//.test(normalizedPath)) {
    return sanitizeWorkspaceRelativePath(normalizedPath);
  }
  const normalizedUserId = String(userId || "").trim();
  if (normalizedUserId) {
    const marker = `/workspace/${normalizedUserId}/`;
    const markerIndex = normalizedPath.indexOf(marker);
    if (markerIndex >= 0) {
      return sanitizeWorkspaceRelativePath(normalizedPath.slice(markerIndex + marker.length));
    }
  }
  const workspaceMarker = "/workspace/";
  const markerIndex = normalizedPath.indexOf(workspaceMarker);
  if (markerIndex < 0) return "";
  const relativeWithUser = sanitizeWorkspaceRelativePath(
    normalizedPath.slice(markerIndex + workspaceMarker.length),
  );
  const slashIndex = relativeWithUser.indexOf("/");
  if (slashIndex > 0) {
    return sanitizeWorkspaceRelativePath(relativeWithUser.slice(slashIndex + 1));
  }
  return relativeWithUser;
}

function resolveFileItemRelativePath(fileItem = {}, userId = "") {
  return resolveWorkspaceRelativePath(fileItem?.relativePath || "", userId);
}

function isHostAbsolutePath(pathValue = "") {
  const normalized = String(pathValue || "").trim().replaceAll("\\", "/");
  return /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("/");
}

function resolveFileItemHostPath(fileItem = {}) {
  for (const value of [fileItem?.hostPath, fileItem?.resolvedPath, fileItem?.path]) {
    const normalized = String(value || "").trim();
    if (normalized && isHostAbsolutePath(normalized)) return normalized;
  }
  return "";
}

function resolveFileItemName(fileItem = {}, relativePath = "") {
  const explicitName = String(fileItem?.fileName || fileItem?.name || "").trim();
  if (explicitName) return explicitName;
  const normalizedPath = String(relativePath || fileItem?.resolvedPath || fileItem?.path || "")
    .trim()
    .replaceAll("\\", "/");
  return String(normalizedPath.split("/").pop() || "").trim();
}

function createFileAccessTraceId(prefix = "preview") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function maskWorkspacePath(pathValue = "") {
  const normalized = String(pathValue || "").trim().replaceAll("\\", "/");
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return normalized;
  return `${parts.slice(0, 2).join("/")}/.../${parts.at(-1)}`;
}

function maskHostPath(pathValue = "") {
  const normalized = String(pathValue || "").trim().replaceAll("\\", "/");
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return normalized;
  return `${parts[0]}/.../${parts.at(-1)}`;
}

function logFileAccess(event, payload = {}) {
  try {
    const entry = {
      layer: "client.messagePreview",
      event,
      ...payload,
    };
    window?.noobotDesktop?.logFileAccess?.(entry).catch?.(() => {});
  } catch {}
}

async function triggerBlobDownload(blob, fileName, translate, notify) {
  const traceId = createFileAccessTraceId("save");
  logFileAccess("blobDownload.start", {
    traceId,
    fileName: String(fileName || "download"),
    size: Number(blob?.size || 0),
    type: String(blob?.type || ""),
  });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = String(fileName || "download");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(downloadUrl);
  logFileAccess("blobDownload.done", { traceId, fileName: String(fileName || "download") });
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
  let attachmentObjectUrl = "";

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
    if (attachmentObjectUrl) {
      URL.revokeObjectURL(attachmentObjectUrl);
      attachmentObjectUrl = "";
    }
    attachmentPreview.visible.value = false;
    attachmentPreview.type.value = "";
    attachmentPreview.url.value = "";
    attachmentPreview.name.value = "";
    attachmentPreview.loading.value = false;
    attachmentPreview.error.value = "";
    attachmentPreview.textContent.value = "";
  }

  function resolveAttachmentUrl(attachmentItem = {}) {
    return resolveAttachmentAccessMeta(attachmentItem, {
      userId: String(userId || "").trim(),
    }).url;
  }

  function resolveParsedResultUrl(attachmentItem = {}) {
    return resolveParsedResultAccessMeta(attachmentItem, {
      userId: String(userId || "").trim(),
    }).url;
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
    const traceId = createFileAccessTraceId("download");
    const normalizedUserId = String(userId || "").trim();
    const relativePath = resolveFileItemRelativePath(fileItem, normalizedUserId);
    const hostPath = resolveFileItemHostPath(fileItem);
    const isSandbox = fileItem?.isSandbox;
    const useHostChannel = isSandbox === false && Boolean(hostPath);
    const missingSandboxFlag = typeof isSandbox !== "boolean";
    logFileAccess("download.click", {
      traceId,
      isSandbox,
      channel: useHostChannel ? (window?.noobotDesktop?.downloadHostFile ? "desktop-host-ipc" : "backend-host-api") : "workspace-api",
      hasUserId: Boolean(normalizedUserId),
      hasRelativePath: Boolean(fileItem?.relativePath),
      hasHostPath: Boolean(hostPath),
      hasFileName: Boolean(fileItem?.fileName || fileItem?.name),
      hasResolvedPath: Boolean(fileItem?.resolvedPath),
      relativePath: maskWorkspacePath(relativePath),
      hostPath: maskHostPath(hostPath),
    });
    if (useHostChannel) {
      try {
        logFileAccess("download.request", { traceId, channel: window?.noobotDesktop?.downloadHostFile ? "desktop-host-ipc" : "backend-host-api", isSandbox, hostPath: maskHostPath(hostPath) });
        let res;
        if (window?.noobotDesktop?.downloadHostFile) {
          res = await window.noobotDesktop.downloadHostFile({ path: hostPath, traceId });
          if (res?.cancelled) {
            logFileAccess("download.response", { traceId, channel: "desktop-host-ipc", ok: false, cancelled: true });
            return;
          }
          if (!res?.ok) throw new Error(res?.error || translate("message.downloadFailed"));
          logFileAccess("download.response", { traceId, channel: "desktop-host-ipc", ok: true, hasSavedPath: Boolean(res?.savedPath) });
          return;
        }
        res = await downloadHostFileApi({ path: hostPath, traceId, isSandbox }, { fetcher: authFetch || undefined });
        logFileAccess("download.response", { traceId, channel: "backend-host-api", ok: Boolean(res?.ok), status: Number(res?.status || 0) });
        if (!res.ok) throw new Error(translate("message.downloadFailedHttp", { status: res.status }));
        const blob = await res.blob();
        const fileName = parseContentDisposition(res.headers?.get("content-disposition") || "") || resolveFileItemName(fileItem, hostPath) || "download";
        await triggerBlobDownload(blob, fileName, translate, notify);
        return;
      } catch (error) {
        logFileAccess("download.failed", { traceId, channel: window?.noobotDesktop?.downloadHostFile ? "desktop-host-ipc" : "backend-host-api", error: String(error?.message || error || "") });
        notify({ type: "error", message: error?.message || translate("message.downloadFailed") });
        return;
      }
    }
    if (missingSandboxFlag && hostPath && !relativePath) {
      logFileAccess("download.invalidMetadata", { traceId, reason: "rejectedMissingSandboxFlag", isSandbox, hasHostPath: true, hostPath: maskHostPath(hostPath) });
      notify({ type: "error", message: translate("message.downloadFailed") });
      return;
    }
    if (!normalizedUserId || !relativePath) {
      logFileAccess("download.invalidMetadata", {
        traceId,
        hasUserId: Boolean(normalizedUserId),
        isSandbox,
        reason: "missingWorkspaceMetadata",
        hasRelativePath: Boolean(fileItem?.relativePath),
        hasFileName: Boolean(fileItem?.fileName || fileItem?.name),
        hasResolvedPath: Boolean(fileItem?.resolvedPath),
      });
      notify({ type: "error", message: translate("message.downloadFailed") });
      return;
    }
    try {
      logFileAccess("download.request", { traceId, channel: "workspace-api", isSandbox, relativePath: maskWorkspacePath(relativePath) });
      const res = await downloadWorkspaceFileApi(
        { userId: normalizedUserId, path: relativePath, traceId },
        { fetcher: authFetch || undefined },
      );
      logFileAccess("download.response", {
        traceId,
        ok: Boolean(res?.ok),
        status: Number(res?.status || 0),
        contentType: String(res.headers?.get("content-type") || ""),
        contentDisposition: Boolean(res.headers?.get("content-disposition")),
      });
      if (!res.ok) {
        let errorText = translate("message.downloadFailedHttp", { status: res.status });
        try {
          const data = await res.json();
          if (data?.error) errorText = String(data.error);
        } catch {}
        throw new Error(errorText);
      }
      const blob = await res.blob();
      const fileName = parseContentDisposition(res.headers?.get("content-disposition") || "") || resolveFileItemName(fileItem, relativePath) || "download";
      await triggerBlobDownload(blob, fileName, translate, notify);
    } catch (error) {
      logFileAccess("download.failed", { traceId, error: String(error?.message || error || "") });
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

  async function onDownloadParsedResult(attachmentItem = {}) {
    const parsedItem = buildParsedResultPreviewItem(attachmentItem);
    await runDownloadFromUrl({
      url: resolveParsedResultUrl(attachmentItem),
      fileName:
        parsedItem?.name ||
        attachmentItem?.parsedResultName ||
        translate("message.parsedResultDefaultName"),
      errorI18nKey: "message.downloadFailed",
    });
  }

  // --- 文件预览 ---

  async function openFilePreview(fileItem = {}) {
    const traceId = createFileAccessTraceId("preview");
    const normalizedUserId = String(userId || "").trim();
    const relativePath = resolveFileItemRelativePath(fileItem, normalizedUserId);
    const hostPath = resolveFileItemHostPath(fileItem);
    const isSandbox = fileItem?.isSandbox;
    const useHostChannel = isSandbox === false && Boolean(hostPath);
    const missingSandboxFlag = typeof isSandbox !== "boolean";
    const fileName = resolveFileItemName(fileItem, relativePath);
    const mimeType = String(fileItem?.mimeType || fileItem?.type || "").trim();
    if (
      isNonImagePreviewOverSizeLimit({
        fileItem,
        mimeType,
        fileName,
        isImageMimeChecker: isImageMime,
      })
    ) {
      notify({ type: "warning", message: translate("message.previewFileTooLarge") });
      return;
    }
    logFileAccess("preview.click", {
      traceId,
      isSandbox,
      channel: useHostChannel ? (window?.noobotDesktop?.readHostFile ? "desktop-host-ipc" : "backend-host-api") : "workspace-api",
      hasUserId: Boolean(normalizedUserId),
      hasRelativePath: Boolean(fileItem?.relativePath),
      hasHostPath: Boolean(hostPath),
      hasFileName: Boolean(fileItem?.fileName || fileItem?.name),
      hasResolvedPath: Boolean(fileItem?.resolvedPath),
      relativePath: maskWorkspacePath(relativePath),
      hostPath: maskHostPath(hostPath),
    });
    if (missingSandboxFlag && hostPath && !relativePath) {
      logFileAccess("preview.invalidMetadata", { traceId, reason: "rejectedMissingSandboxFlag", isSandbox, hasHostPath: true, hostPath: maskHostPath(hostPath) });
      notify({ type: "error", message: translate("message.previewFailed") });
      return;
    }
    if (useHostChannel && fileName) {
      filePreview.visible.value = true;
      filePreview.loading.value = true;
      filePreview.error.value = "";
      filePreview.fileName.value = fileName;
      filePreview.mode.value = "text";
      filePreview.textContent.value = "";
      cleanupPreviewImageUrl();
      try {
        const channel = window?.noobotDesktop?.readHostFile ? "desktop-host-ipc" : "backend-host-api";
        if (isImageFile(fileName)) {
          const imageChannel = window?.noobotDesktop?.downloadHostFile ? "desktop-host-ipc" : "backend-host-api";
          logFileAccess("preview.imageRequest", { traceId, channel: imageChannel, isSandbox, hostPath: maskHostPath(hostPath) });
          if (window?.noobotDesktop?.downloadHostFile) {
            const result = await window.noobotDesktop.downloadHostFile({ path: hostPath, traceId });
            if (!result?.ok) throw new Error(result?.error || translate("message.previewFailed"));
            filePreview.imageUrl.value = result.url;
          } else {
            const res = await downloadHostFileApi({ path: hostPath, traceId, isSandbox }, { fetcher: authFetch || undefined });
            if (!res.ok) throw new Error(translate("message.previewFailedHttp", { status: res.status }));
            filePreview.imageUrl.value = URL.createObjectURL(await res.blob());
          }
          filePreview.mode.value = "image";
          logFileAccess("preview.imageResponse", { traceId, channel: imageChannel, ok: true });
          return;
        }
        logFileAccess("preview.textRequest", { traceId, channel, isSandbox, hostPath: maskHostPath(hostPath) });
        let data;
        if (window?.noobotDesktop?.readHostFile) {
          data = await window.noobotDesktop.readHostFile({ path: hostPath, traceId });
        } else {
          const res = await getHostFileApi({ path: hostPath, traceId, isSandbox }, { fetcher: authFetch || undefined });
          data = await res.json();
          if (!res.ok) data = { ok: false, error: data?.error || translate("message.previewFailedHttp", { status: res.status }) };
        }
        logFileAccess("preview.textResponse", { traceId, channel, ok: Boolean(data?.ok), isText: data?.isText });
        if (!data?.ok) throw new Error(data?.error || translate("message.previewFailed"));
        if (data.isText === false) throw new Error(translate("message.fileTypeNotSupported"));
        filePreview.textContent.value = String(data.content || "");
        filePreview.mode.value = isMarkdownFile(fileName) ? "markdown" : "text";
        return;
      } catch (error) {
        logFileAccess("preview.failed", { traceId, channel: window?.noobotDesktop?.readHostFile ? "desktop-host-ipc" : "backend-host-api", error: String(error?.message || error || "") });
        filePreview.error.value = error?.message || translate("message.previewFailed");
        return;
      } finally {
        filePreview.loading.value = false;
      }
    }
    if (!normalizedUserId || !relativePath || !fileName) {
      logFileAccess("preview.invalidMetadata", {
        traceId,
        hasUserId: Boolean(normalizedUserId),
        isSandbox,
        reason: "missingWorkspaceMetadata",
        hasRelativePath: Boolean(fileItem?.relativePath),
        hasFileName: Boolean(fileItem?.fileName || fileItem?.name),
        hasResolvedPath: Boolean(fileItem?.resolvedPath),
      });
      notify({ type: "error", message: translate("message.previewFailed") });
      return;
    }

    filePreview.visible.value = true;
    filePreview.loading.value = true;
    filePreview.error.value = "";
    filePreview.fileName.value = fileName;
    filePreview.mode.value = "text";
    filePreview.textContent.value = "";
    cleanupPreviewImageUrl();

    try {
      if (isImageFile(fileName)) {
        logFileAccess("preview.imageRequest", { traceId, channel: "workspace-api", isSandbox, relativePath: maskWorkspacePath(relativePath) });
        const downloadRes = await downloadWorkspaceFileApi(
          { userId: normalizedUserId, path: relativePath, traceId },
          { fetcher: authFetch || undefined },
        );
        logFileAccess("preview.imageResponse", {
          traceId,
          ok: Boolean(downloadRes?.ok),
          status: Number(downloadRes?.status || 0),
          contentType: String(downloadRes.headers?.get("content-type") || ""),
        });
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
        { userId: normalizedUserId, path: relativePath, traceId },
        { fetcher: authFetch || undefined },
      );
      logFileAccess("preview.textResponse", {
        traceId,
        ok: Boolean(res?.ok),
        status: Number(res?.status || 0),
        contentType: String(res.headers?.get("content-type") || ""),
      });
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
      logFileAccess("preview.failed", { traceId, error: String(error?.message || error || "") });
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
    if (
      isNonImagePreviewOverSizeLimit({
        fileItem: attachmentItem,
        mimeType,
        fileName: name,
        isImageMimeChecker: isImageMime,
      })
    ) {
      return false;
    }
    const officeLike = isOfficeMime(mimeType) || isOfficeFile(name);
    if (officeLike) return hasParsedResult(attachmentItem);
    // Source preview is allowed for image/audio/video/text.
    return (
      isImagePreviewType(mimeType, name, isImageMime) ||
      mimeType.startsWith("video/") ||
      isAudioPreviewMime(mimeType) ||
      isTextPreviewMime(mimeType) ||
      isMarkdownMime(mimeType, name) ||
      isTextPreviewFile(name)
    );
  }

  function canPreviewParsedResult(attachmentItem = {}) {
    if (!hasParsedResult(attachmentItem)) return false;
    const parsedItem = buildParsedResultPreviewItem(attachmentItem);
    return !isNonImagePreviewOverSizeLimit({
      fileItem: parsedItem,
      mimeType: parsedItem.mimeType,
      fileName: parsedItem.name,
      isImageMimeChecker: isImageMime,
    });
  }

  function canPreviewFile(fileItem = {}) {
    const normalizedUserId = String(userId || "").trim();
    const relativePath = resolveFileItemRelativePath(fileItem, normalizedUserId);
    const fileName = resolveFileItemName(fileItem, relativePath);
    const mimeType = String(fileItem?.mimeType || fileItem?.type || "").trim();
    const hasPreviewPath = Boolean(relativePath || resolveFileItemHostPath(fileItem) || fileItem?.resolvedPath || fileItem?.path);
    if (!hasPreviewPath) return false;
    return !isNonImagePreviewOverSizeLimit({
      fileItem,
      mimeType,
      fileName,
      isImageMimeChecker: isImageMime,
    });
  }

  async function openResolvedAttachmentPreview(attachmentItem = {}) {
    resetAttachmentPreviewState();
    const mimeType = String(attachmentItem?.mimeType || "").trim();
    const name = String(attachmentItem?.name || "").trim();
    if (
      isNonImagePreviewOverSizeLimit({
        fileItem: attachmentItem,
        mimeType,
        fileName: name,
        isImageMimeChecker: isImageMime,
      })
    ) {
      notify({ type: "warning", message: translate("message.previewFileTooLarge") });
      return;
    }
    const officeLike = isOfficeMime(mimeType) || isOfficeFile(name);
    const targetUrl = resolveAttachmentUrl(attachmentItem);
    if (!targetUrl) return;

    const isImage = !officeLike && isImagePreviewType(mimeType, name, isImageMime);
    const isVideo = !officeLike && mimeType.startsWith("video/");
    const isAudio = !officeLike && isAudioPreviewMime(mimeType);
    if (isImage || isVideo || isAudio) {
      attachmentPreview.visible.value = true;
      attachmentPreview.loading.value = true;
      attachmentPreview.type.value = isImage ? "image" : isVideo ? "video" : "audio";
      attachmentPreview.name.value = name;
      try {
        const runFetch = authFetch || fetch;
        const response = await runFetch(targetUrl);
        if (!response?.ok) {
          throw new Error(translate("message.previewFailedHttp", { status: response?.status || 500 }));
        }
        const blob = await response.blob();
        attachmentObjectUrl = URL.createObjectURL(blob);
        attachmentPreview.url.value = attachmentObjectUrl;
      } catch (error) {
        attachmentPreview.error.value = error?.message || translate("message.attachmentPreviewFailed");
      } finally {
        attachmentPreview.loading.value = false;
      }
      return;
    }
    const markdownMode = officeLike
      ? true
      : isMarkdownMime(mimeType, name);
    if (!markdownMode && !isTextPreviewMime(mimeType) && !isTextPreviewFile(name)) return;

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

  async function openParsedResultPreview(attachmentItem = {}) {
    const parsedItem = buildParsedResultPreviewItem(attachmentItem, {
      userId: String(userId || "").trim(),
    });
    const parsedResultUrl = resolveParsedResultUrl(attachmentItem);
    await openResolvedAttachmentPreview({
      ...parsedItem,
      previewUrl: parsedResultUrl,
    });
  }

  async function openAttachmentPreview(attachmentItem = {}, options = {}) {
    if (options?.parsedResult === true) {
      if (hasParsedResult(attachmentItem)) {
        await openParsedResultPreview(attachmentItem);
      } else {
        await openResolvedAttachmentPreview(attachmentItem);
      }
      return;
    }
    const mimeType = String(attachmentItem?.mimeType || "").trim();
    const name = String(attachmentItem?.name || "").trim();
    if ((isOfficeMime(mimeType) || isOfficeFile(name)) && hasParsedResult(attachmentItem)) {
      await openParsedResultPreview(attachmentItem);
      return;
    }
    await openResolvedAttachmentPreview(attachmentItem);
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
    canPreviewParsedResult,
    canPreviewFile,
    openAttachmentPreview,
    openParsedResultPreview,
    openResolvedAttachmentPreview,
    closeAttachmentPreview,
    openFilePreview,
    closePreviewDialog,
    onDownloadFile,
    onDownloadAttachment,
    onDownloadParsedResult,
    onCopyMarkdownRich,
    onCopyMarkdownText,
    onCopyAttachmentMarkdownRich,
    onCopyAttachmentMarkdownText,
    onCopyMessageMarkdownRich,
    onCopyMessageMarkdownText,
  };
}
