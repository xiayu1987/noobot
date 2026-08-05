/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionCommand, SESSION_COMMAND } from "@noobot/session-protocol";
function resolveFetcher(fetcher) {
  return fetcher || fetch;
}

async function decodeJsonResponse(response, operation) {
  if (response && typeof response.json === "function") {
    const payload = await response.json();
    if (response.ok === false || payload?.ok === false) {
      const error = new Error(payload?.error || payload?.message || `${operation}_failed`);
      error.status = Number(response.status || 0);
      const retryAfter = response.headers?.get?.("retry-after");
      const retryAfterSeconds = Number(retryAfter);
      error.retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : 0;
      error.payload = payload;
      throw error;
    }
    return payload;
  }
  return response;
}

function firstNormalizedString(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

export function resolveAttachmentId(attachmentItem = {}) {
  return firstNormalizedString(
    attachmentItem?.attachmentId,
    attachmentItem?.attachment_id,
    attachmentItem?.fileId,
    attachmentItem?.file_id,
    attachmentItem?.id,
    attachmentItem?.uuid,
  );
}

export function resolveAttachmentSessionId(attachmentItem = {}) {
  return firstNormalizedString(
    attachmentItem?.sessionId,
    attachmentItem?.session_id,
    attachmentItem?.sessionId,
  );
}

export function resolveAttachmentSource(attachmentItem = {}) {
  return firstNormalizedString(
    attachmentItem?.attachmentSource,
    attachmentItem?.attachment_source,
    attachmentItem?.source,
  );
}

export function buildAttachmentUrl({
  userId = "",
  attachmentId = "",
  sessionId = "",
  attachmentSource = "",
}) {
  const normalizedUserIdValue = String(userId || "").trim();
  const normalizedAttachmentIdValue = String(attachmentId || "").trim();
  if (!normalizedUserIdValue || !normalizedAttachmentIdValue) return "";
  const normalizedUserId = encodeURIComponent(normalizedUserIdValue);
  const normalizedAttachmentId = encodeURIComponent(normalizedAttachmentIdValue);
  const queryParams = [];
  if (sessionId)
    queryParams.push(`sessionId=${encodeURIComponent(String(sessionId || "").trim())}`);
  if (attachmentSource)
    queryParams.push(
      `attachmentSource=${encodeURIComponent(String(attachmentSource || "").trim())}`,
    );
  const query = queryParams.length ? `?${queryParams.join("&")}` : "";
  return `/api/internal/attachment/${normalizedUserId}/${normalizedAttachmentId}${query}`;
}

export async function connectApi(
  { userId = "", connectCode = "", locale = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  const normalizedLocale = String(locale || "").trim();
  return runFetch("/api/internal/connect", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(normalizedLocale ? { "x-noobot-locale": normalizedLocale } : {}),
    },
    body: JSON.stringify({
      userId: String(userId || "").trim(),
      connectCode: String(connectCode || "").trim(),
      locale: normalizedLocale,
    }),
  });
}

export async function getSessionsApi({ userId = "" }, { fetcher } = {}) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(`/api/internal/sessions/${encodeURIComponent(userId)}`);
}

export async function getSessionConnectorsApi(
  { userId = "", sessionId = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(
    `/api/internal/connectors/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`,
  );
}

export async function putSessionConnectorSelectionApi(
  { userId = "", sessionId = "", selectedConnectors = {} },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(
    `/api/internal/connectors/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/selection`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedConnectors }),
    },
  );
}

export async function renameSessionApi(
  { userId = "", sessionId = "", title = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/rename`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: String(title || "").trim() }),
    },
  );
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

export async function resolveTurnTerminalStateApi(
  { userId = "", sessionId = "", turnScopeId = "", commandId = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  const queryParams = [];
  if (commandId) queryParams.push(`commandId=${encodeURIComponent(commandId)}`);
  const query = queryParams.length ? `?${queryParams.join("&")}` : "";
  const response = await runFetch(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnScopeId)}/terminal${query}`,
  );
  const payload = await decodeJsonResponse(response, "terminal_resolution");
  return payload && typeof payload === "object" ? payload : {};
}

export async function getSessionFullDetailApi(
  { userId = "", sessionId = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}?mode=full`,
  );
}

export async function getSessionThinkingDetailApi(
  { userId = "", sessionId = "", dialogProcessId = "", turnScopeId = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  const queryParams = [];
  const normalizedDialogProcessId = String(dialogProcessId || "").trim();
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
  if (normalizedDialogProcessId) {
    queryParams.push(`dialogProcessId=${encodeURIComponent(normalizedDialogProcessId)}`);
  }
  if (normalizedTurnScopeId) {
    queryParams.push(`turnScopeId=${encodeURIComponent(normalizedTurnScopeId)}`);
  }
  const query = queryParams.length ? `?${queryParams.join("&")}` : "";
  return runFetch(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/thinking-detail${query}`,
  );
}

export async function deleteSessionMessagesFromApi(
  {
    userId = "",
    sessionId = "",
    parentSessionId = "",
    anchor = {},
    expectedAggregateVersion = undefined,
    commandId = "",
  },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  const body = createSessionCommand({
    commandId,
    type: SESSION_COMMAND.MESSAGE_DELETE_FROM,
    scope: { userId, sessionId, parentSessionId },
    expectedAggregateVersion,
    payload: { anchor },
  });
  return runFetch(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/messages/delete-from`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export async function replaceSessionTurnApi(
  {
    userId = "",
    sessionId = "",
    parentSessionId = "",
    anchor = {},
    newContent = "",
    turnScopeId = "",
    expectedAggregateVersion = undefined,
    commandId = "",
    attachments = undefined,
  },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  const body = createSessionCommand({
    commandId,
    type: SESSION_COMMAND.TURN_REPLACE,
    scope: { userId, sessionId, parentSessionId },
    expectedAggregateVersion,
    payload: {
      anchor,
      newContent: String(newContent || "").trim(),
      turnScopeId: String(turnScopeId || "").trim(),
      ...(Array.isArray(attachments) ? { attachments } : {}),
    },
  });
  return runFetch(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/messages/replace-turn`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
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
  return `${protocol}//${host}/api/agent-proxy/ws${query}`;
}

export function buildLogWebSocketUrl({ apiKey = "" } = {}) {
  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedApiKey) return "";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  const query = `?apikey=${encodeURIComponent(normalizedApiKey)}`;
  return `${protocol}//${host}/api/logs/ws${query}`;
}


export async function postOpenVSCodeServerApi(
  { userId = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(`/api/internal/ide/open/${encodeURIComponent(userId)}`, {
    method: "POST",
  });
}

export async function getWorkspaceTreeApi({ userId = "" }, { fetcher } = {}) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(`/api/internal/workspace/${encodeURIComponent(userId)}/tree`);
}

export async function getWorkspaceAllTreeApi({ fetcher } = {}) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch("/api/internal/admin/workspace-all/tree");
}

export async function getWorkspaceAllFileApi({ path = "" }, { fetcher } = {}) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(`/api/internal/admin/workspace-all/file?path=${encodeURIComponent(path)}`);
}

export async function putWorkspaceAllFileApi(
  { path = "", content = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch("/api/internal/admin/workspace-all/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
}

export async function postResetWorkspaceApi(
  { userId = "", sections = [] },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(
    `/api/internal/workspace/reset/${encodeURIComponent(userId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sections }),
    },
  );
}

export async function postSyncWorkspaceApi(
  { userId = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(
    `/api/internal/workspace/sync/${encodeURIComponent(userId)}`,
    { method: "POST" },
  );
}

export async function postSyncAllWorkspaceApi({ fetcher } = {}) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch("/api/internal/admin/workspace-all/sync", {
    method: "POST",
  });
}

export async function postResetAllWorkspaceApi(
  { sections = [] } = {},
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch("/api/internal/admin/workspace-all/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sections }),
  });
}

export async function getWorkspaceFileApi(
  { userId = "", path = "", traceId = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  const headers = traceId ? { "x-noobot-file-trace-id": String(traceId) } : undefined;
  return runFetch(
    `/api/internal/workspace/${encodeURIComponent(userId)}/file?path=${encodeURIComponent(path)}`,
    headers ? { headers } : undefined,
  );
}

export async function downloadWorkspaceFileApi(
  { userId = "", path = "", traceId = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  const headers = traceId ? { "x-noobot-file-trace-id": String(traceId) } : undefined;
  return runFetch(
    `/api/internal/workspace/${encodeURIComponent(userId)}/download?path=${encodeURIComponent(path)}`,
    headers ? { headers } : undefined,
  );
}

export async function getHostFileApi(
  { path = "", traceId = "", isSandbox = undefined },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  const headers = traceId ? { "x-noobot-file-trace-id": String(traceId) } : undefined;
  const params = new URLSearchParams({ path: String(path || "") });
  if (typeof isSandbox === "boolean") params.set("isSandbox", String(isSandbox));
  return runFetch(`/api/internal/host-file/file?${params.toString()}`, headers ? { headers } : undefined);
}

export async function downloadHostFileApi(
  { path = "", traceId = "", isSandbox = undefined },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  const headers = traceId ? { "x-noobot-file-trace-id": String(traceId) } : undefined;
  const params = new URLSearchParams({ path: String(path || "") });
  if (typeof isSandbox === "boolean") params.set("isSandbox", String(isSandbox));
  return runFetch(`/api/internal/host-file/download?${params.toString()}`, headers ? { headers } : undefined);
}

export async function downloadWorkspaceAllFileApi(
  { path = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(
    `/api/internal/admin/workspace-all/download?path=${encodeURIComponent(path)}`,
  );
}

export async function putWorkspaceFileApi(
  { userId = "", path = "", content = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(`/api/internal/workspace/${encodeURIComponent(userId)}/file`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
}

export async function getRegularUsersApi({ fetcher } = {}) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch("/api/internal/admin/users");
}

export async function getTemplateTreeApi({ fetcher } = {}) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch("/api/internal/admin/template/tree");
}

export async function getTemplateFileApi({ path = "" }, { fetcher } = {}) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(`/api/internal/admin/template/file?path=${encodeURIComponent(path)}`);
}

export async function putTemplateFileApi(
  { path = "", content = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch("/api/internal/admin/template/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
}

export async function putRegularUsersApi({ users = [] }, { fetcher } = {}) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch("/api/internal/admin/users", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ users }),
  });
}

export async function getConfigParamsApi({ scope = "user", fetcher } = {}) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(
    `/api/internal/config-params?scope=${encodeURIComponent(String(scope || "user"))}`,
  );
}

export async function getConfigParamCatalogApi({ scope = "system", fetcher } = {}) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(
    `/api/internal/config-params/catalog?scope=${encodeURIComponent(String(scope || "system"))}`,
  );
}

export async function putConfigParamsApi(
  { scope = "user", values = {}, descriptions = {} },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch("/api/internal/config-params", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, values, descriptions }),
  });
}

export function buildWorkspaceDownloadUrl({
  userId = "",
  path = "",
}) {
  return `/api/internal/workspace/${encodeURIComponent(userId)}/download?path=${encodeURIComponent(path)}`;
}

export function buildWorkspaceAllDownloadUrl({ path = "" }) {
  return `/api/internal/admin/workspace-all/download?path=${encodeURIComponent(path)}`;
}
