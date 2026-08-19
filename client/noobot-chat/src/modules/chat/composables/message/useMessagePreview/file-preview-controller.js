/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isImageFile, isMarkdownFile, isNonImagePreviewOverSizeLimit } from "./file-type.js";
import { maskHostPath, maskWorkspacePath } from "./path-utils.js";
import { logFileAccess } from "./file-access-log.js";
import {
  buildFileAccessLogPayload,
  createFileAccessContext,
  validateFileAccessContext,
} from "./file-access-context.js";
import { readHttpResponseErrorText } from "./http-response.js";

export function createFilePreviewController({
  userId,
  attachmentService,
  translate,
  notify,
  isImageMime,
  filePreview,
}) {
  async function openFilePreview(fileItem = {}) {
    const desktopRead = window?.noobotDesktop?.readHostFile;
    const context = createFileAccessContext("preview", fileItem, userId, desktopRead);
    const mimeType = String(fileItem?.mimeType || fileItem?.type || "").trim();
    if (isPreviewOverLimit(fileItem, context.fileName, mimeType, isImageMime)) {
      notify({ type: "warning", message: translate("message.previewFileTooLarge") });
      return;
    }
    logFileAccess("preview.click", buildFileAccessLogPayload(context, fileItem));
    const validation = validateFileAccessContext(context, fileItem);
    if (!validation.valid) {
      logFileAccess("preview.invalidMetadata", { ...maskedContext(context), ...validation });
      notify({ type: "error", message: translate("message.previewFailed") });
      return;
    }
    filePreview.open(context.fileName);
    try {
      if (context.useHostChannel) {
        await previewHostFile(context, attachmentService, translate, filePreview);
      } else {
        await previewWorkspaceFile(context, attachmentService, translate, filePreview);
      }
    } catch (error) {
      logFileAccess("preview.failed", {
        traceId: context.traceId,
        channel: context.channel,
        error: String(error?.message || error || ""),
      });
      filePreview.state.error.value = error?.message || translate("message.previewFailed");
    } finally {
      filePreview.state.loading.value = false;
    }
  }
  return { openFilePreview };
}

function isPreviewOverLimit(fileItem, fileName, mimeType, isImageMime) {
  return isNonImagePreviewOverSizeLimit({
    fileItem,
    mimeType,
    fileName,
    isImageMimeChecker: isImageMime,
  });
}

async function previewHostFile(context, attachmentService, translate, filePreview) {
  if (isImageFile(context.fileName)) {
    await previewHostImage(context, attachmentService, translate, filePreview);
    return;
  }
  const data = await readHostText(context, attachmentService, translate);
  if (!data?.ok) throw new Error(data?.error || translate("message.previewFailed"));
  if (data.isText === false) throw new Error(translate("message.fileTypeNotSupported"));
  applyTextPreview(filePreview.state, context.fileName, data.content);
}

async function previewHostImage(context, attachmentService, translate, filePreview) {
  const desktopDownload = window?.noobotDesktop?.downloadHostFile;
  const channel = desktopDownload ? "desktop-host-ipc" : "backend-host-api";
  logFileAccess("preview.imageRequest", { ...maskedContext(context), channel });
  if (desktopDownload) {
    const result = await desktopDownload({ path: context.hostPath, traceId: context.traceId });
    if (!result?.ok) throw new Error(result?.error || translate("message.previewFailed"));
    filePreview.state.imageUrl.value = result.url;
  } else {
    const response = await attachmentService.downloadHostFile({
      path: context.hostPath,
      traceId: context.traceId,
      isSandbox: context.isSandbox,
    });
    if (!response.ok) {
      throw new Error(translate("message.previewFailedHttp", { status: response.status }));
    }
    filePreview.state.imageUrl.value = URL.createObjectURL(await response.blob());
  }
  filePreview.state.mode.value = "image";
  logFileAccess("preview.imageResponse", { traceId: context.traceId, channel, ok: true });
}

async function readHostText(context, attachmentService, translate) {
  logFileAccess("preview.textRequest", maskedContext(context));
  if (window?.noobotDesktop?.readHostFile) {
    const data = await window.noobotDesktop.readHostFile({
      path: context.hostPath,
      traceId: context.traceId,
    });
    logTextResponse(context, data);
    return data;
  }
  const response = await attachmentService.getHostFile({
    path: context.hostPath,
    traceId: context.traceId,
    isSandbox: context.isSandbox,
  });
  const data = await response.json();
  const result = response.ok
    ? data
    : {
        ok: false,
        error: data?.error || translate("message.previewFailedHttp", { status: response.status }),
      };
  logTextResponse(context, result);
  return result;
}

async function previewWorkspaceFile(context, attachmentService, translate, filePreview) {
  if (isImageFile(context.fileName)) {
    await previewWorkspaceImage(context, attachmentService, translate, filePreview);
    return;
  }
  const response = await attachmentService.getWorkspaceFile({
    userId: context.normalizedUserId,
    path: context.relativePath,
    traceId: context.traceId,
  });
  logFileAccess("preview.textResponse", {
    traceId: context.traceId,
    ok: Boolean(response?.ok),
    status: Number(response?.status || 0),
    contentType: String(response.headers?.get("content-type") || ""),
  });
  const data = await readWorkspaceTextResponse(response, translate);
  if (!response.ok || !data.ok) throw new Error(data?.error || translate("message.previewFailed"));
  if (data.isText === false) throw new Error(translate("message.fileTypeNotSupported"));
  applyTextPreview(filePreview.state, context.fileName, data.content);
}

async function previewWorkspaceImage(context, attachmentService, translate, filePreview) {
  logFileAccess("preview.imageRequest", maskedContext(context));
  const response = await attachmentService.downloadWorkspaceFile({
    userId: context.normalizedUserId,
    path: context.relativePath,
    traceId: context.traceId,
  });
  logFileAccess("preview.imageResponse", {
    traceId: context.traceId,
    ok: Boolean(response?.ok),
    status: Number(response?.status || 0),
    contentType: String(response.headers?.get("content-type") || ""),
  });
  if (!response.ok) {
    throw new Error(
      await readHttpResponseErrorText(
        response,
        translate("message.previewFailedHttp", { status: response.status }),
        context.traceId,
      ),
    );
  }
  filePreview.state.imageUrl.value = URL.createObjectURL(await response.blob());
  filePreview.state.mode.value = "image";
}

async function readWorkspaceTextResponse(response, translate) {
  const contentType = String(response.headers?.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) return response.json();
  const rawText = await response.text();
  try {
    return JSON.parse(String(rawText || "{}"));
  } catch {
    throw new Error(translate("message.previewFailedHttp", { status: response.status || 500 }));
  }
}

function applyTextPreview(state, fileName, content) {
  state.textContent.value = String(content || "");
  state.mode.value = isMarkdownFile(fileName) ? "markdown" : "text";
}

function logTextResponse(context, data) {
  logFileAccess("preview.textResponse", {
    traceId: context.traceId,
    channel: context.channel,
    ok: Boolean(data?.ok),
    isText: data?.isText,
  });
}

function maskedContext(context) {
  return {
    traceId: context.traceId,
    channel: context.channel,
    isSandbox: context.isSandbox,
    relativePath: maskWorkspacePath(context.relativePath),
    hostPath: maskHostPath(context.hostPath),
  };
}
