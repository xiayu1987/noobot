/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionCommand, SESSION_COMMAND } from "@noobot/session-protocol";
import {
  requireRetainedSessionDisplayPageRequest,
  requireSessionDetailStartRequest,
  requireSessionDetailStartResponse,
  requireSessionDisplayPageRelease,
  requireSessionDisplayPageTransition,
} from "@noobot/session-protocol/session-detail";
import {
  decodeMessageContentPage,
  requireDisplayArtifactPageTransition,
  requireMessageContentPage,
  requireRetainedDisplayArtifactPageRelease,
  requireRetainedDisplayArtifactPageRequest,
  requireSessionPageReleaseResult,
} from "@noobot/session-protocol/message-read-budget";
import { requireServerNow } from "@noobot/session-protocol/server-clock";
import { projectAttachmentAccessRequest } from "@noobot/attachment-protocol";
import { WORKSPACE_FILE_ROUTE } from "@noobot/shared/resource-access";
import { FILE_TRACE_ID_HEADER } from "@noobot/shared/runtime-events-config";
import { text } from "@noobot/shared/value";
import { readApiResponseEnvelope } from "@noobot/shared/request-error";
import { readRetainedSessionPage } from "@noobot/session-protocol/retained-session-page";
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

function runFileFetch(fetcher, path, { traceId = "", query = {}, signal } = {}) {
  const runFetch = requireFetcher(fetcher);
  const queryString = buildQueryString(query);
  return runFetch(
    queryString ? `${path}?${queryString}` : path,
    signal || traceId
      ? {
          ...(traceId ? { headers: buildOptionalHeaders(traceId) } : {}),
          ...(signal ? { signal } : {}),
        }
      : undefined,
  );
}

export function buildAttachmentUrl(request) {
  const { userId, attachmentId, sessionId, attachmentSource } =
    projectAttachmentAccessRequest(request);
  const query = buildQueryString({ sessionId, attachmentSource });
  return `/api/internal/attachment/${encodeURIComponent(userId)}/${encodeURIComponent(attachmentId)}?${query}`;
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

async function requestSessionPage({ userId, request, fetcher, signal, path, method }) {
  const { sessionId, ...selection } = request;
  const response = await requireFetcher(fetcher)(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/${path}`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selection),
      ...(signal ? { signal } : {}),
    },
  );
  return readApiResponseEnvelope(response);
}

export async function getSessionMessageContentPageApi(
  { userId, sessionId, row, byteOffset, maxBytes },
  { fetcher, signal },
) {
  const selection = requireMessageContentPage({
    messageUid: row.messageUid,
    expectedContentReference: row.contentReference,
    byteOffset,
    maxBytes,
  });
  const { page } = await requestSessionPage({
    userId,
    request: { sessionId, ...selection },
    fetcher,
    signal,
    path: "message-content-page",
    method: "POST",
  });
  return decodeMessageContentPage(page, selection, row.contentBytes);
}

function requestRetainedDisplayPage({ userId, request, fetcher, signal, path, validate, release }) {
  return readRetainedSessionPage({
    cursor: request.cursor,
    receive: () => requestSessionPage({ userId, request, fetcher, signal, path, method: "POST" }),
    accept(page, { serverNow }) {
      requireServerNow(serverNow);
      validate(page);
      return { page, serverNow };
    },
    release,
  });
}

function displayPageRelease({ userId, request: { sessionId }, fetcher }) {
  return (cursor) =>
    releaseSessionDisplayPageApi({ userId, request: { sessionId, cursor } }, { fetcher });
}

export async function getSessionDetailStartApi({ userId, request }, { fetcher, signal }) {
  requireSessionDetailStartRequest(request);
  return requestRetainedDisplayPage({
    userId,
    request,
    fetcher,
    signal,
    path: "detail-start",
    validate: (page) => requireSessionDetailStartResponse(page, request),
    release: displayPageRelease({ userId, request, fetcher }),
  });
}

export async function getSessionDisplayPageApi({ userId, request, previous }, { fetcher, signal }) {
  requireRetainedSessionDisplayPageRequest(request);
  return requestRetainedDisplayPage({
    userId,
    request,
    fetcher,
    signal,
    path: "display-page",
    validate: (page) => requireSessionDisplayPageTransition(page, request, previous),
    release: displayPageRelease({ userId, request, fetcher }),
  });
}

async function releaseRetainedDisplayPage({ userId, request, fetcher, path }) {
  const { page, serverNow } = await requestSessionPage({
    userId,
    request,
    fetcher,
    path,
    method: "DELETE",
  });
  requireServerNow(serverNow);
  return requireSessionPageReleaseResult(page);
}

export async function releaseSessionDisplayPageApi({ userId, request }, { fetcher }) {
  requireSessionDisplayPageRelease(request);
  return releaseRetainedDisplayPage({ userId, request, fetcher, path: "display-page" });
}

const DISPLAY_ARTIFACT_PAGE_PATH = "display-artifact-page";

export async function getSessionDisplayArtifactPageApi(
  { userId, request, previous },
  { fetcher, signal },
) {
  requireRetainedDisplayArtifactPageRequest(request);
  const { sessionId, dialogProcessId, turnScopeId } = request;
  return requestRetainedDisplayPage({
    userId,
    request,
    fetcher,
    signal,
    path: DISPLAY_ARTIFACT_PAGE_PATH,
    validate: (page) => requireDisplayArtifactPageTransition(page, request, previous),
    release: (cursor) =>
      releaseSessionDisplayArtifactPageApi(
        { userId, request: { sessionId, dialogProcessId, turnScopeId, cursor } },
        { fetcher },
      ),
  });
}

export async function releaseSessionDisplayArtifactPageApi({ userId, request }, { fetcher }) {
  requireRetainedDisplayArtifactPageRelease(request);
  return releaseRetainedDisplayPage({ userId, request, fetcher, path: DISPLAY_ARTIFACT_PAGE_PATH });
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
  { userId, sessionId, dialogProcessId, turnScopeId, cursor, limit },
  { fetcher },
) {
  const runFetch = requireFetcher(fetcher);
  const query = new URLSearchParams({
    dialogProcessId,
    turnScopeId,
    cursor: JSON.stringify(cursor),
    limit: String(limit),
  });
  return runFetch(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/thinking-detail?${query.toString()}`,
  );
}

export async function releaseSessionThinkingDetailApi(
  { userId, sessionId, dialogProcessId, turnScopeId, cursor },
  { fetcher },
) {
  const runFetch = requireFetcher(fetcher);
  const query = new URLSearchParams({
    dialogProcessId,
    turnScopeId,
    cursor: JSON.stringify(cursor),
  });
  return runFetch(
    `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/thinking-detail?${query.toString()}`,
    { method: "DELETE" },
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
    attachments,
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
      attachments,
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
  return apiKey ? `${protocol}//${host}/api/agent-proxy/ws` : "";
}

export function buildLogWebSocketUrl({ apiKey = "" } = {}) {
  const normalizedApiKey = text(apiKey);
  if (!normalizedApiKey) return "";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${protocol}//${host}/api/logs/ws`;
}

export async function postOpenVSCodeServerApi({ userId = "" }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch(`/api/internal/ide/open/${encodeURIComponent(userId)}`, {
    method: "POST",
  });
}

export async function getWorkspaceTreeApi({ userId = "", path = "" }, { fetcher }) {
  return runFileFetch(fetcher, `/api/internal/workspace/${encodeURIComponent(userId)}/tree`, {
    query: path ? { path } : {},
  });
}

export async function getWorkspaceAllTreeApi({ fetcher, path = "" }) {
  return runFileFetch(fetcher, "/api/internal/admin/workspace-all/tree", {
    query: path ? { path } : {},
  });
}

export async function getWorkspaceAllFileApi({ path = "" }, { fetcher, signal }) {
  return runFileFetch(fetcher, "/api/internal/admin/workspace-all/file", {
    query: { path },
    signal,
  });
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

export async function getWorkspaceFileApi(
  { userId = "", path = "", traceId = "" },
  { fetcher, signal },
) {
  return runFileFetch(fetcher, `/api/internal/workspace/${encodeURIComponent(userId)}/file`, {
    traceId,
    query: { path },
    signal,
  });
}

export async function getWorkspaceConfigDeclarationsApi({ userId = "" }, { fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch(`/api/internal/workspace/${encodeURIComponent(userId)}/config-declarations`);
}

export async function downloadWorkspaceFileApi(
  { userId = "", path = "", traceId = "" },
  { fetcher, signal },
) {
  return runFileFetch(fetcher, buildWorkspaceDownloadUrl({ userId, path, source: "user" }), {
    traceId,
    signal,
  });
}

export async function downloadWorkspaceAllFileApi({ path = "" }, { fetcher, signal }) {
  return runFileFetch(fetcher, buildWorkspaceDownloadUrl({ path, source: "all" }), { signal });
}

export function buildWorkspacePreviewUrl(params) {
  return buildWorkspaceResourceUrl(params, WORKSPACE_FILE_ROUTE.PREVIEW);
}

function buildWorkspaceDownloadUrl(params) {
  return buildWorkspaceResourceUrl(params, WORKSPACE_FILE_ROUTE.DOWNLOAD);
}

function buildWorkspaceResourceUrl({ userId, path, source }, operation) {
  if (source !== "user" && source !== "all")
    throw new TypeError("workspace source must be user or all");
  const route =
    source === "all"
      ? "/api/internal/admin/workspace-all"
      : `/api/internal/workspace/${encodeURIComponent(userId)}`;
  return `${route}/${operation}?${buildQueryString({ path })}`;
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
  { userId = "", sessionId = "", sessionScope = null, mutationId = "", version = null },
  artifact,
  { fetcher, signal },
) {
  const runFetch = requireFetcher(fetcher);
  const query = buildQueryString({
    sessionId,
    parentSessionId: sessionScope?.parentSessionId,
    scopeId: sessionScope?.scopeId,
    relativeDir: sessionScope?.relativeDir,
    allowedRoot: sessionScope?.allowedRoot,
    revision: version?.revision,
    afterSha256: version?.afterSha256,
  });
  return runFetch(
    `/api/internal/workspace/${encodeURIComponent(userId)}/file-mutations/${encodeURIComponent(mutationId)}/${artifact}${query ? `?${query}` : ""}`,
    { signal },
  );
}

export async function getWorkspaceFileMutationDiffApi(request, options) {
  return getWorkspaceFileMutationApi(request, "diff", options);
}

export async function getWorkspaceFileMutationFileApi(request, options) {
  return getWorkspaceFileMutationApi(request, "file", options);
}

export async function downloadWorkspaceFileMutationApi(request, options) {
  return getWorkspaceFileMutationApi(request, "download", options);
}

export async function getRegularUsersApi({ fetcher }) {
  const runFetch = requireFetcher(fetcher);
  return runFetch("/api/internal/admin/users");
}

export async function getTemplateTreeApi({ fetcher, path = "" }) {
  return runFileFetch(fetcher, "/api/internal/admin/template/tree", {
    query: path ? { path } : {},
  });
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
