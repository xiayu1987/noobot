/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  maskHostPath,
  maskWorkspacePath,
  parseContentDisposition,
  resolveFileItemName,
} from "./path-utils.js";
import { logFileAccess, triggerBlobDownload } from "./file-access-log.js";
import {
  buildFileAccessLogPayload,
  createFileAccessContext,
  validateFileAccessContext,
} from "./file-access-context.js";
import { readHttpResponseErrorText } from "./http-response.js";

export function createFileDownloadController({ userId, attachmentService, translate, notify }) {
  async function onDownloadFile(fileItem = {}) {
    const desktopDownload = window?.noobotDesktop?.downloadHostFile;
    const context = createFileAccessContext("download", fileItem, userId, desktopDownload);
    logFileAccess("download.click", buildFileAccessLogPayload(context, fileItem));
    const validation = validateFileAccessContext(context, fileItem);
    if (!validation.valid) {
      logFileAccess("download.invalidMetadata", { ...contextForLog(context), ...validation });
      notify({ type: "error", message: translate("message.downloadFailed") });
      return;
    }
    try {
      if (context.useHostChannel) {
        await downloadHostFile(context, fileItem, desktopDownload, attachmentService, translate);
      } else {
        await downloadWorkspaceFile(context, fileItem, attachmentService, translate);
      }
    } catch (error) {
      logFileAccess("download.failed", {
        traceId: context.traceId,
        channel: context.channel,
        error: String(error?.message || error || ""),
      });
      notify({ type: "error", message: error?.message || translate("message.downloadFailed") });
    }
  }
  return { onDownloadFile };
}

async function downloadHostFile(context, fileItem, desktopDownload, attachmentService, translate) {
  logFileAccess("download.request", contextForLog(context));
  if (desktopDownload) {
    const result = await desktopDownload({ path: context.hostPath, traceId: context.traceId });
    logFileAccess("download.response", {
      traceId: context.traceId,
      channel: context.channel,
      ok: Boolean(result?.ok),
      cancelled: result?.cancelled === true,
      hasSavedPath: Boolean(result?.savedPath),
    });
    if (result?.cancelled) return;
    if (!result?.ok) throw new Error(result?.error || translate("message.downloadFailed"));
    return;
  }
  const response = await attachmentService.downloadHostFile({
    path: context.hostPath,
    traceId: context.traceId,
    isSandbox: context.isSandbox,
  });
  logDownloadResponse(context, response);
  if (!response.ok) {
    throw new Error(translate("message.downloadFailedHttp", { status: response.status }));
  }
  await downloadResponseBlob(response, resolveFileItemName(fileItem, context.hostPath));
}

async function downloadWorkspaceFile(context, fileItem, attachmentService, translate) {
  logFileAccess("download.request", contextForLog(context));
  const response = await attachmentService.downloadWorkspaceFile({
    userId: context.normalizedUserId,
    path: context.relativePath,
    traceId: context.traceId,
  });
  logDownloadResponse(context, response);
  if (!response.ok) {
    throw new Error(
      await readHttpResponseErrorText(
        response,
        translate("message.downloadFailedHttp", { status: response.status }),
        context.traceId,
      ),
    );
  }
  await downloadResponseBlob(response, resolveFileItemName(fileItem, context.relativePath));
}

function logDownloadResponse(context, response) {
  logFileAccess("download.response", {
    traceId: context.traceId,
    channel: context.channel,
    ok: Boolean(response?.ok),
    status: Number(response?.status || 0),
    contentType: String(response?.headers?.get("content-type") || ""),
    contentDisposition: Boolean(response?.headers?.get("content-disposition")),
  });
}

async function downloadResponseBlob(response, fallbackName) {
  const fileName =
    parseContentDisposition(response.headers?.get("content-disposition") || "") ||
    fallbackName ||
    "download";
  await triggerBlobDownload(await response.blob(), fileName);
}

function contextForLog(context) {
  return {
    traceId: context.traceId,
    channel: context.channel,
    isSandbox: context.isSandbox,
    relativePath: maskWorkspacePath(context.relativePath),
    hostPath: maskHostPath(context.hostPath),
  };
}
