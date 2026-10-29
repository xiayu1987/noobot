/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionCommand, SESSION_COMMAND } from "@noobot/session-protocol";
import { FILE_TRACE_ID_HEADER } from "@noobot/shared/runtime-events-config";
import { text } from "@noobot/shared/value";
import { readApiResponseEnvelope } from "@noobot/shared/request-error";
function requireFetcher(fetcher) {
  if (typeof fetcher !== "function") throw new Error("authenticated fetcher is required");
  return fetcher;
}

function buildOptionalHeaders(traceId = "") {
  return traceId ? { [FILE_TRACE_ID_HEADER]: String(traceId) } : undefined;
}

function buildQueryString(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    query.set(key, String(value));
  }
  return query.toString();
}

function runFileFetch(fetcher, path, { traceId = "", query = {} } = {}) {
  const runFetch = requireFetcher(fetcher);
  const queryString = buildQueryString(query);
  return runFetch(
    queryString ? `${path}?${queryString}` : path,
    buildOptionalHeaders(traceId) ? { headers: buildOptionalHeaders(traceId) } : undefined,
  );
}

export function buildAttachmentUrl({
  userId = "",
  attachmentId = "",
  sessionId = "",
  attachmentSource = "",
}) {
  const normalizedUserIdValue = text(userId);
  const normalizedAttachmentIdValue = text(attachmentId);
  if (!normalizedUserIdValue || !normalizedAttachmentIdValue) return "";
  const normalizedUserId = encodeURIComponent(normalizedUserIdValue);
  const normalizedAttachmentId = encodeURIComponent(normalizedAttachmentIdValue);
  const queryParams = [];
  if (sessionId) queryParams.push(`sessionId=${encodeURIComponent(text(sessionId))}`);
  if (attachmentSource)
    queryParams.push(`attachmentSource=${encodeURIComponent(text(attachmentSource))}`);
  const query = queryParams.length ? `?${queryParams.join("&")}` : "";
  return `/api/internal/attachment/${normalizedUserId}/${normalizedAttachmentId}${query}`;
}

export async function connectApi({ userId = "", connectCode = "", locale = "" }) {
  const normalizedLocale = text(locale);
  return fetch("/api/internal/connect", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(normalizedLocale ? { "x-noobot-locale": normalizedLocale } : {}),
    },
    body: JSON.stringify({
      userId: text(userId),
      connectCode: text(connectCode),
      locale: normalizedLocale,
    }),
  });
}

export async function getSessionsApi({ userId }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch(`/api/internal/sessions/${encodeURIComponent(userId)}`);
}

export async function getSessionConnectorsApi({ userId = "", sessionId = "" }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch(
    `/api/internal/connectors/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`,
  );
}

export async function putSessionConnectorSelectionApi(
  { userId = "", sessionId = "", selectedConnectorIds = [] },
  { fetcher },
) {
  const runFetch = requireFetcher(fetcher);
  return runFetch(
    `/api/internal/connectors/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}/selection`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedConnectorIds }),
    },
  );
}

export async function renameSessionApi({ userId = "", sessionId = "", title = "" }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/rename`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: text(title) }),
    },
  );
}

export async function getSessionDetailApi({ userId = "", sessionId = "" }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}`,
  );
}

export async function resolveTurnTerminalStateApi(
  { userId, sessionId, turnScopeId, commandId },
  { fetcher },
) {
  const runFetch = requireFetcher(fetcher);
  const response = await runFetch(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnScopeId)}/terminal?commandId=${encodeURIComponent(commandId)}`,
  );
  return readApiResponseEnvelope(response);
}

export async function getSessionThinkingDetailApi(
  { userId, sessionId, dialogProcessId, turnScopeId },
  { fetcher },
) {
  const runFetch = requireFetcher(fetcher);
  const query = new URLSearchParams({ dialogProcessId, turnScopeId });
  return runFetch(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/thinking-detail?${query.toString()}`,
  );
}

export async function getSessionExecutionReportApi(
  { userId, sessionId, dialogProcessId },
  { fetcher },
) {
  const runFetch = requireFetcher(fetcher);
  const query = `?dialogProcessId=${encodeURIComponent(dialogProcessId)}`;
  const response = await runFetch(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/execution-report${query}`,
  );
  return readApiResponseEnvelope(response);
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
  { fetcher },
) {
  const runFetch = requireFetcher(fetcher);
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
  { fetcher },
) {
  const runFetch = requireFetcher(fetcher);
  const body = createSessionCommand({
    commandId,
    type: SESSION_COMMAND.TURN_REPLACE,
    scope: { userId, sessionId, parentSessionId },
    expectedAggregateVersion,
    payload: {
      anchor,
      newContent: text(newContent),
      turnScopeId: text(turnScopeId),
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

export async function deleteSessionApi({ userId = "", sessionIds }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch(`/api/internal/sessions/${encodeURIComponent(userId)}/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionIds }),
  });
}

export function buildChatWebSocketUrl({ apiKey = "" } = {}) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  const query = apiKey ? `?apikey=${encodeURIComponent(apiKey)}` : "";
  return `${protocol}//${host}/api/agent-proxy/ws${query}`;
}

export function buildLogWebSocketUrl({ apiKey = "" } = {}) {
  const normalizedApiKey = text(apiKey);
  if (!normalizedApiKey) return "";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  const query = `?apikey=${encodeURIComponent(normalizedApiKey)}`;
  return `${protocol}//${host}/api/logs/ws${query}`;
}

export async function postOpenVSCodeServerApi({ userId = "" }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch(`/api/internal/ide/open/${encodeURIComponent(userId)}`, {
    method: "POST",
  });
}

export async function getWorkspaceTreeApi({ userId = "" }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch(`/api/internal/workspace/${encodeURIComponent(userId)}/tree`);
}

export async function getWorkspaceAllTreeApi({ fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch("/api/internal/admin/workspace-all/tree");
}

export async function getWorkspaceAllFileApi({ path = "" }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch(`/api/internal/admin/workspace-all/file?path=${encodeURIComponent(path)}`);
}

export async function putWorkspaceAllFileApi({ path = "", content = "" }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch("/api/internal/admin/workspace-all/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
}

export async function postResetWorkspaceApi({ userId = "", sections = [] }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch(`/api/internal/workspace/reset/${encodeURIComponent(userId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sections }),
  });
}

export async function postSyncWorkspaceApi({ userId = "" }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch(`/api/internal/workspace/sync/${encodeURIComponent(userId)}`, { method: "POST" });
}

export async function postSyncAllWorkspaceApi({ fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch("/api/internal/admin/workspace-all/sync", {
    method: "POST",
  });
}

export async function postResetAllWorkspaceApi({ sections = [] }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch("/api/internal/admin/workspace-all/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sections }),
  });
}

export async function getWorkspaceFileApi({ userId = "", path = "", traceId = "" }, { fetcher }) {
  return runFileFetch(fetcher, `/api/internal/workspace/${encodeURIComponent(userId)}/file`, {
    traceId,
    query: { path },
  });
}

export async function getWorkspaceConfigDeclarationsApi({ userId = "" }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch(`/api/internal/workspace/${encodeURIComponent(userId)}/config-declarations`);
}

export async function downloadWorkspaceFileApi(
  { userId = "", path = "", traceId = "" },
  { fetcher },
) {
  return runFileFetch(fetcher, `/api/internal/workspace/${encodeURIComponent(userId)}/download`, {
    traceId,
    query: { path },
  });
}

export async function downloadWorkspaceAllFileApi({ path = "" }, { fetcher }) {
  return runFileFetch(fetcher, "/api/internal/admin/workspace-all/download", {
    query: { path },
  });
}

export async function putWorkspaceFileApi({ userId = "", path = "", content = "" }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch(`/api/internal/workspace/${encodeURIComponent(userId)}/file`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
}

async function getWorkspaceFileMutationApi(
  { userId = "", sessionId = "", sessionScope = null, mutationId = "", allWorkspace = false },
  artifact,
  { fetcher },
) {
  const runFetch = requireFetcher(fetcher);
  const prefix = allWorkspace
    ? "/api/internal/admin/workspace-all"
    : `/api/internal/workspace/${encodeURIComponent(userId)}`;
  const query = buildQueryString({
    sessionId,
    parentSessionId: sessionScope?.parentSessionId,
    scopeId: sessionScope?.scopeId,
    relativeDir: sessionScope?.relativeDir,
    allowedRoot: sessionScope?.allowedRoot,
  });
  return runFetch(
    `${prefix}/file-mutations/${encodeURIComponent(mutationId)}/${artifact}${query ? `?${query}` : ""}`,
  );
}

export async function getWorkspaceFileMutationDiffApi(request, options) {
  return getWorkspaceFileMutationApi(request, "diff", options);
}

export async function getWorkspaceFileMutationFileApi(request, options) {
  return getWorkspaceFileMutationApi(request, "file", options);
}

export async function getRegularUsersApi({ fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch("/api/internal/admin/users");
}

export async function getTemplateTreeApi({ fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch("/api/internal/admin/template/tree");
}

export async function getTemplateFileApi({ path = "" }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch(`/api/internal/admin/template/file?path=${encodeURIComponent(path)}`);
}

export async function putTemplateFileApi({ path = "", content = "" }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch("/api/internal/admin/template/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
}

export async function putRegularUsersApi({ users = [] }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch("/api/internal/admin/users", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ users }),
  });
}

export async function getConfigParamsApi({ scope, fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch(`/api/internal/config-params?scope=${encodeURIComponent(scope)}`);
}

export async function getConfigParamCatalogApi({ scope, fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch(`/api/internal/config-params/catalog?scope=${encodeURIComponent(scope)}`);
}

export async function putConfigParamsApi(
  { scope = "user", values = {}, descriptions = {} },
  { fetcher },
) {
  const runFetch = requireFetcher(fetcher);
  return runFetch("/api/internal/config-params", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, values, descriptions }),
  });
}
