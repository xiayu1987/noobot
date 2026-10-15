/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isAbsolutePathForPlatform } from "@noobot/path-resolver/syntax";
import { createSecureId } from "../../../../../shared/identity/secureIdentity.js";
import { text } from "@noobot/shared/value";

export function parseContentDisposition(contentDisposition = "") {
  if (!contentDisposition) return "";
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(String(utf8Match[1]).trim());
    } catch {
      return String(utf8Match[1]).trim();
    }
  }
  const basicMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return text(basicMatch?.[1]);
}

function sanitizeWorkspaceRelativePath(pathValue = "") {
  const normalized = text(pathValue).replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (!normalized) return "";
  if (normalized.startsWith("../")) return "";
  if (normalized.includes("/../")) return "";
  if (normalized.endsWith("/..")) return "";
  return normalized;
}

function resolveWorkspaceRelativePath(pathValue = "", userId = "") {
  const normalizedPath = text(pathValue).replaceAll("\\", "/");
  if (!normalizedPath) return "";
  if (!isAbsolutePathForPlatform(normalizedPath)) {
    return sanitizeWorkspaceRelativePath(normalizedPath);
  }
  const normalizedUserId = text(userId);
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

export function resolveFileItemRelativePath(fileItem = {}, userId = "") {
  return resolveWorkspaceRelativePath(fileItem?.relativePath || "", userId);
}

export function resolveFileItemHostPath(fileItem = {}) {
  for (const value of [fileItem?.hostPath, fileItem?.resolvedPath, fileItem?.path]) {
    const normalized = text(value);
    if (normalized && isAbsolutePathForPlatform(normalized)) return normalized;
  }
  return "";
}

export function resolveFileItemName(fileItem = {}, relativePath = "") {
  const explicitName = text(fileItem?.fileName || fileItem?.name);
  if (explicitName) return explicitName;
  const normalizedPath = text(relativePath || fileItem?.resolvedPath || fileItem?.path).replaceAll(
    "\\",
    "/",
  );
  return text(normalizedPath.split("/").pop());
}

export function createFileAccessTraceId(prefix = "preview") {
  return createSecureId(prefix, "-");
}

export function maskWorkspacePath(pathValue = "") {
  const normalized = text(pathValue).replaceAll("\\", "/");
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return normalized;
  return `${parts.slice(0, 2).join("/")}/.../${parts.at(-1)}`;
}

export function maskHostPath(pathValue = "") {
  const normalized = text(pathValue).replaceAll("\\", "/");
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return normalized;
  return `${parts[0]}/.../${parts.at(-1)}`;
}
