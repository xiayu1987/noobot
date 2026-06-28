/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function resolveFetcher(fetcher) {
  return fetcher || fetch;
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
    attachmentItem?.backendSessionId,
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

export async function getSessionDetailApi(
  { userId = "", sessionId = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  return runFetch(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`,
  );
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
  { userId = "", sessionId = "", dialogProcessId = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  const query = `dialogProcessId=${encodeURIComponent(String(dialogProcessId || "").trim())}`;
  return runFetch(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/thinking-detail?${query}`,
  );
}

export async function getWorkflowSessionDetailApi(
  { userId = "", sessionId = "", dialogProcessId = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  const routeDialogProcessId = String(dialogProcessId || "").trim();
  return runFetch(
    `/api/internal/workflow/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(routeDialogProcessId)}`,
  );
}

export async function getWorkflowSessionThinkingDetailApi(
  { userId = "", sessionId = "", dialogProcessId = "", routeDialogProcessId = "", turnScopeId = "" },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  const queryParams = [];
  const normalizedDialogProcessId = String(dialogProcessId || "").trim();
  const normalizedRouteDialogProcessId = String(routeDialogProcessId || normalizedDialogProcessId).trim();
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
  if (normalizedDialogProcessId) {
    queryParams.push(`dialogProcessId=${encodeURIComponent(normalizedDialogProcessId)}`);
  }
  if (normalizedTurnScopeId) {
    queryParams.push(`turnScopeId=${encodeURIComponent(normalizedTurnScopeId)}`);
  }
  const query = queryParams.length ? `?${queryParams.join("&")}` : "";
  return runFetch(
    `/api/internal/workflow/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(normalizedRouteDialogProcessId)}/thinking-detail${query}`,
  );
}

export async function deleteSessionMessagesFromApi(
  {
    userId = "",
    sessionId = "",
    parentSessionId = "",
    anchor = {},
    expectedVersion = undefined,
    idempotencyKey = "",
  },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  const body = {
    parentSessionId: String(parentSessionId || "").trim(),
    anchor: anchor && typeof anchor === "object" && !Array.isArray(anchor) ? anchor : {},
    idempotencyKey: String(idempotencyKey || "").trim(),
  };
  if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== "") {
    body.expectedVersion = expectedVersion;
  }
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
    expectedVersion = undefined,
    idempotencyKey = "",
  },
  { fetcher } = {},
) {
  const runFetch = resolveFetcher(fetcher);
  const body = {
    parentSessionId: String(parentSessionId || "").trim(),
    anchor: anchor && typeof anchor === "object" && !Array.isArray(anchor) ? anchor : {},
    newContent: String(newContent || "").trim(),
    turnScopeId: String(turnScopeId || "").trim(),
    idempotencyKey: String(idempotencyKey || "").trim(),
  };
  if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== "") {
    body.expectedVersion = expectedVersion;
  }
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
