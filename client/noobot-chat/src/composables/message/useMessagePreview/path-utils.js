/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function parseContentDisposition(contentDisposition = "") {
  if (!contentDisposition) return "";
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try { return decodeURIComponent(String(utf8Match[1]).trim()); } catch { return String(utf8Match[1]).trim(); }
  }
  const basicMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return String(basicMatch?.[1] || "").trim();
}

export function sanitizeWorkspaceRelativePath(pathValue = "") {
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

export function resolveWorkspaceRelativePath(pathValue = "", userId = "") {
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

export function resolveFileItemRelativePath(fileItem = {}, userId = "") {
  return resolveWorkspaceRelativePath(fileItem?.relativePath || "", userId);
}

export function isHostAbsolutePath(pathValue = "") {
  const normalized = String(pathValue || "").trim().replaceAll("\\", "/");
  return /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("/");
}

export function resolveFileItemHostPath(fileItem = {}) {
  for (const value of [fileItem?.hostPath, fileItem?.resolvedPath, fileItem?.path]) {
    const normalized = String(value || "").trim();
    if (normalized && isHostAbsolutePath(normalized)) return normalized;
  }
  return "";
}

export function resolveFileItemName(fileItem = {}, relativePath = "") {
  const explicitName = String(fileItem?.fileName || fileItem?.name || "").trim();
  if (explicitName) return explicitName;
  const normalizedPath = String(relativePath || fileItem?.resolvedPath || fileItem?.path || "")
    .trim()
    .replaceAll("\\", "/");
  return String(normalizedPath.split("/").pop() || "").trim();
}

export function createFileAccessTraceId(prefix = "preview") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function maskWorkspacePath(pathValue = "") {
  const normalized = String(pathValue || "").trim().replaceAll("\\", "/");
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return normalized;
  return `${parts.slice(0, 2).join("/")}/.../${parts.at(-1)}`;
}

export function maskHostPath(pathValue = "") {
  const normalized = String(pathValue || "").trim().replaceAll("\\", "/");
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return normalized;
  return `${parts[0]}/.../${parts.at(-1)}`;
}
