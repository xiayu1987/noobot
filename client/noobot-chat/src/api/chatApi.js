/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function resolveFetcher(fetcher) {
  return fetcher || fetch;
}

export function buildAttachmentUrl({ userId = "", attachmentId = "", apiKey = "" }) {
  const normalizedUserId = encodeURIComponent(String(userId || "").trim());
  const normalizedAttachmentId = encodeURIComponent(
    String(attachmentId || "").trim(),
  );
  const query = apiKey ? `?apikey=${encodeURIComponent(apiKey)}` : "";
  return `/api/internal/attachment/${normalizedUserId}/${normalizedAttachmentId}${query}`;
}

export async function connectApi(
  { userId = "", connectCode = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch("/api/internal/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: String(userId || "").trim(),
      connectCode: String(connectCode || "").trim(),
    }),
  });
}

export async function getSessionsApi({ userId = "" }, { fetcher } = {}) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(`/api/internal/sessions/${encodeURIComponent(userId)}`);
}

export async function getSessionDetailApi(
  { userId = "", sessionId = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`,
  );
}

export async function deleteSessionApi(
  { userId = "", sessionId = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
}

export function buildChatWebSocketUrl({ apiKey = "" } = {}) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  const query = apiKey ? `?apikey=${encodeURIComponent(apiKey)}` : "";
  return `${protocol}//${host}/api/chat/ws${query}`;
}

export async function getWorkspaceTreeApi({ userId = "" }, { fetcher } = {}) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(`/api/internal/workspace/tree/${encodeURIComponent(userId)}`);
}

export async function getWorkspaceFileApi(
  { userId = "", path = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(
    `/api/internal/workspace/file/${encodeURIComponent(userId)}?path=${encodeURIComponent(path)}`,
  );
}

export async function downloadWorkspaceFileApi(
  { userId = "", path = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(
    `/api/internal/workspace/download/${encodeURIComponent(userId)}?path=${encodeURIComponent(path)}`,
  );
}

export async function putWorkspaceFileApi(
  { userId = "", path = "", content = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(`/api/internal/workspace/file/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
}

export async function getRegularUsersApi({ fetcher } = {}) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch("/api/internal/admin/users");
}

export async function putRegularUsersApi({ users = [] }, { fetcher } = {}) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch("/api/internal/admin/users", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ users }),
  });
}

export function buildWorkspaceDownloadUrl({
  userId = "",
  path = "",
  apiKey = "",
}) {
  const baseUrl = `/api/internal/workspace/download/${encodeURIComponent(userId)}?path=${encodeURIComponent(path)}`;
  return apiKey
    ? `${baseUrl}&apikey=${encodeURIComponent(apiKey)}`
    : baseUrl;
}
