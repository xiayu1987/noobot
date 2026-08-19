/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createFileAccessTraceId,
  maskHostPath,
  maskWorkspacePath,
  resolveFileItemHostPath,
  resolveFileItemName,
  resolveFileItemRelativePath,
} from "./path-utils.js";

export function createFileAccessContext(action, fileItem, userId, desktopCapability) {
  const traceId = createFileAccessTraceId(action);
  const normalizedUserId = String(userId || "").trim();
  const relativePath = resolveFileItemRelativePath(fileItem, normalizedUserId);
  const hostPath = resolveFileItemHostPath(fileItem);
  const isSandbox = fileItem?.isSandbox;
  const useHostChannel = isSandbox === false && Boolean(hostPath);
  return {
    traceId,
    normalizedUserId,
    relativePath,
    hostPath,
    isSandbox,
    useHostChannel,
    missingSandboxFlag: typeof isSandbox !== "boolean",
    fileName: resolveFileItemName(fileItem, relativePath),
    channel: useHostChannel
      ? desktopCapability
        ? "desktop-host-ipc"
        : "backend-host-api"
      : "workspace-api",
  };
}

export function buildFileAccessLogPayload(context, fileItem) {
  return {
    traceId: context.traceId,
    isSandbox: context.isSandbox,
    channel: context.channel,
    hasUserId: Boolean(context.normalizedUserId),
    hasRelativePath: Boolean(fileItem?.relativePath),
    hasHostPath: Boolean(context.hostPath),
    hasFileName: Boolean(fileItem?.fileName || fileItem?.name),
    hasResolvedPath: Boolean(fileItem?.resolvedPath),
    relativePath: maskWorkspacePath(context.relativePath),
    hostPath: maskHostPath(context.hostPath),
  };
}

export function validateFileAccessContext(context, fileItem) {
  if (context.missingSandboxFlag && context.hostPath && !context.relativePath) {
    return { valid: false, reason: "rejectedMissingSandboxFlag", hasHostPath: true };
  }
  if (context.useHostChannel)
    return { valid: Boolean(context.fileName), reason: "missingFileName" };
  if (context.normalizedUserId && context.relativePath && context.fileName) return { valid: true };
  return {
    valid: false,
    reason: "missingWorkspaceMetadata",
    hasUserId: Boolean(context.normalizedUserId),
    hasRelativePath: Boolean(fileItem?.relativePath),
    hasFileName: Boolean(fileItem?.fileName || fileItem?.name),
    hasResolvedPath: Boolean(fileItem?.resolvedPath),
  };
}
