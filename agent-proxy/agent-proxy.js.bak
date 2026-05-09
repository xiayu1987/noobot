/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";

async function loadWebSocketLibrary() {
  try {
    return await import("ws");
  } catch {
    return import("../service/node_modules/ws/wrapper.mjs");
  }
}

const websocketLibrary = await loadWebSocketLibrary();
const WebSocket = websocketLibrary.default || websocketLibrary.WebSocket;
const WebSocketServer = websocketLibrary.WebSocketServer;

const PROXY_PORT = Number(process.env.AGENT_PROXY_PORT || 10062);
const PROXY_HOST = String(process.env.AGENT_PROXY_HOST || "0.0.0.0").trim();
const UPSTREAM_URL = String(
  process.env.AGENT_PROXY_UPSTREAM_WS_URL || "ws://127.0.0.1:10061/chat/ws",
).trim();
const UPSTREAM_HTTP_BASE = String(
  process.env.AGENT_PROXY_UPSTREAM_HTTP_BASE || "http://127.0.0.1:10061",
).trim();
const CHANNEL_RETENTION_MS = Math.max(
  10_000,
  Number(process.env.AGENT_PROXY_CHANNEL_RETENTION_MS || 10 * 60 * 1000),
);
const API_KEY_RETENTION_MS = Math.max(
  60_000,
  Number(process.env.AGENT_PROXY_API_KEY_RETENTION_MS || 24 * 60 * 60 * 1000),
);
const MAX_CHANNEL_EVENTS = Math.max(
  100,
  Number(process.env.AGENT_PROXY_MAX_CHANNEL_EVENTS || 2000),
);
const CLEANUP_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.AGENT_PROXY_CLEANUP_INTERVAL_MS || 15_000),
);

const channelStore = new Map();
const requestChannelMap = new Map();
const apiKeyIdentityStore = new Map();

function normalizeApiKey(input = "") {
  return String(input || "").trim();
}

function createChannelKey({
  userId = "",
  sessionId = "",
  parentSessionId = "",
  parentDialogProcessId = "",
} = {}) {
  return [
    String(userId || "").trim(),
    String(sessionId || "").trim(),
    String(parentSessionId || "").trim(),
    String(parentDialogProcessId || "").trim(),
  ].join("::");
}

function parseRequestQuery(request = null) {
  try {
    const requestUrl = new URL(request?.url || "", "http://localhost");
    return {
      pathname: String(requestUrl.pathname || "").trim(),
      apiKey: String(requestUrl.searchParams.get("apikey") || "").trim(),
      locale: String(requestUrl.searchParams.get("locale") || "").trim(),
    };
  } catch {
    return { pathname: "", apiKey: "", locale: "" };
  }
}

function parseRequestPathname(request = null) {
  try {
    const requestUrl = new URL(request?.url || "", "http://localhost");
    return String(requestUrl.pathname || "").trim();
  } catch {
    return "";
  }
}

function shouldInterceptConnectPath(pathname = "") {
  const normalizedPathname = String(pathname || "").trim();
  return normalizedPathname === "/internal/connect" || normalizedPathname === "/api/internal/connect";
}

function buildClientPermissions(role = "user") {
  const normalizedRole = String(role || "user").trim() || "user";
  const isSuperAdmin = normalizedRole === "super_admin";
  return {
    role: normalizedRole,
    canChat: true,
    canUseAgentProxy: true,
    canAccessWorkspace: true,
    canAccessAdmin: isSuperAdmin,
    canManageUsers: isSuperAdmin,
    canManageTemplate: isSuperAdmin,
    canManageSystemConfigParams: isSuperAdmin,
  };
}

function nowMs() {
  return Date.now();
}

function isTerminalStatus(status = "") {
  return ["done", "stopped", "error"].includes(String(status || "").trim());
}

function ensureChannel(channelKey = "", startPayload = {}) {
  const normalizedChannelKey = String(channelKey || "").trim();
  if (!normalizedChannelKey) return null;
  const existingChannel = channelStore.get(normalizedChannelKey);
  if (existingChannel) return existingChannel;
  const nextChannel = {
    key: normalizedChannelKey,
    status: "idle",
    createdAtMs: nowMs(),
    updatedAtMs: nowMs(),
    subscribers: new Set(),
    upstreamSocket: null,
    apiKey: "",
    locale: "",
    startPayload: null,
    startFingerprint: "",
    eventSequence: 0,
    eventLog: [],
    cleanupAfterMs: 0,
    upstreamClosed: false,
    ownerApiKey: "",
    ownerUserId: "",
  };
  if (startPayload && typeof startPayload === "object") {
    nextChannel.startPayload = { ...startPayload };
  }
  channelStore.set(normalizedChannelKey, nextChannel);
  return nextChannel;
}

function buildFingerprint(payload = {}) {
  return JSON.stringify(payload || {});
}

function pushChannelEvent(channel = null, eventName = "", data = {}) {
  if (!channel) return null;
  channel.eventSequence += 1;
  channel.updatedAtMs = nowMs();
  const envelope = {
    sequence: channel.eventSequence,
    event: String(eventName || "message").trim() || "message",
    data: data && typeof data === "object" ? data : {},
  };
  channel.eventLog.push(envelope);
  if (channel.eventLog.length > MAX_CHANNEL_EVENTS) {
    channel.eventLog.splice(0, channel.eventLog.length - MAX_CHANNEL_EVENTS);
  }
  if (String(envelope.event || "") === "interaction_request") {
    const requestId = String(envelope?.data?.requestId || "").trim();
    if (requestId) {
      requestChannelMap.set(requestId, channel.key);
    }
  }
  return envelope;
}

function sendSocketEvent(targetSocket = null, envelope = null) {
  if (!targetSocket || targetSocket.readyState !== WebSocket.OPEN || !envelope) return;
  try {
    targetSocket.send(
      JSON.stringify({
        event: envelope.event,
        data: envelope.data,
      }),
    );
  } catch {
    // ignore send errors
  }
}

function sendSocketError(targetSocket = null, errorMessage = "") {
  sendSocketEvent(targetSocket, {
    event: "error",
    data: {
      error: String(errorMessage || "agentProxy error").trim() || "agentProxy error",
    },
  });
}

function hasChannelPermission(channel = null, apiKey = "", requesterUserId = "") {
  if (!channel) return false;
  const normalizedApiKey = normalizeApiKey(apiKey);
  const ownerApiKey = normalizeApiKey(channel?.ownerApiKey || "");
  const normalizedRequesterUserId = String(requesterUserId || "").trim();
  const ownerUserId = String(channel?.ownerUserId || "").trim();
  if (ownerUserId && normalizedRequesterUserId && ownerUserId === normalizedRequesterUserId) {
    return true;
  }
  if (!ownerApiKey) return Boolean(normalizedApiKey);
  return Boolean(normalizedApiKey && normalizedApiKey === ownerApiKey);
}

function ensureChannelPermission({
  channel = null,
  apiKey = "",
  requesterUserId = "",
  socket = null,
  action = "",
} = {}) {
  if (hasChannelPermission(channel, apiKey, requesterUserId)) return true;
  sendSocketError(
    socket,
    `agentProxy permission denied for action: ${String(action || "unknown").trim() || "unknown"}`,
  );
  return false;
}

function saveApiKeyIdentity({ apiKey = "", userId = "", role = "" } = {}) {
  const normalizedApiKey = normalizeApiKey(apiKey);
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedApiKey || !normalizedUserId) return;
  apiKeyIdentityStore.set(normalizedApiKey, {
    apiKey: normalizedApiKey,
    userId: normalizedUserId,
    role: String(role || "").trim() || "user",
    updatedAtMs: nowMs(),
  });
}

function resolveApiKeyIdentity(apiKey = "") {
  const normalizedApiKey = normalizeApiKey(apiKey);
  if (!normalizedApiKey || !apiKeyIdentityStore.has(normalizedApiKey)) return null;
  const identityItem = apiKeyIdentityStore.get(normalizedApiKey) || null;
  if (!identityItem) return null;
  return identityItem;
}

function replayChannelEvents(channel = null, targetSocket = null, lastSequence = 0) {
  if (!channel || !targetSocket) return;
  const expectedSequence = Math.max(0, Number(lastSequence || 0));
  const replayEvents = channel.eventLog.filter(
    (eventEnvelope) => Number(eventEnvelope?.sequence || 0) > expectedSequence,
  );
  for (const eventEnvelope of replayEvents) {
    sendSocketEvent(targetSocket, eventEnvelope);
  }
  targetSocket.__agentProxyLastSequenceByChannel =
    targetSocket.__agentProxyLastSequenceByChannel || {};
  targetSocket.__agentProxyLastSequenceByChannel[channel.key] = channel.eventSequence;
}

function broadcastChannelEvent(channel = null, envelope = null) {
  if (!channel || !envelope) return;
  for (const subscriberSocket of channel.subscribers) {
    sendSocketEvent(subscriberSocket, envelope);
    subscriberSocket.__agentProxyLastSequenceByChannel =
      subscriberSocket.__agentProxyLastSequenceByChannel || {};
    subscriberSocket.__agentProxyLastSequenceByChannel[channel.key] = Number(
      envelope?.sequence || 0,
    );
  }
}

function attachSubscriberToChannel(channel = null, socket = null) {
  if (!channel || !socket) return;
  channel.subscribers.add(socket);
  socket.__agentProxyChannelKeys = socket.__agentProxyChannelKeys || new Set();
  socket.__agentProxyChannelKeys.add(channel.key);
  socket.__agentProxyActiveChannelKey = channel.key;
}

function detachSocketFromAllChannels(socket = null) {
  if (!socket) return;
  const connectedChannelKeys = socket.__agentProxyChannelKeys || new Set();
  for (const channelKey of connectedChannelKeys) {
    const channel = channelStore.get(channelKey);
    if (!channel) continue;
    channel.subscribers.delete(socket);
    channel.updatedAtMs = nowMs();
    if (!channel.subscribers.size && isTerminalStatus(channel.status)) {
      channel.cleanupAfterMs = nowMs() + CHANNEL_RETENTION_MS;
    }
  }
  socket.__agentProxyChannelKeys = new Set();
  socket.__agentProxyActiveChannelKey = "";
}

function buildUpstreamUrl(baseUrl = "", apiKey = "") {
  const normalizedBaseUrl = String(baseUrl || "").trim();
  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedBaseUrl) return "";
  if (!normalizedApiKey) return normalizedBaseUrl;
  const upstreamUrl = new URL(normalizedBaseUrl);
  upstreamUrl.searchParams.set("apikey", normalizedApiKey);
  return upstreamUrl.toString();
}

function closeUpstreamChannel(channel = null, closeCode = 1000, reasonText = "closed") {
  if (!channel?.upstreamSocket) return;
  try {
    channel.upstreamSocket.close(closeCode, reasonText);
  } catch {
    // ignore close errors
  }
  channel.upstreamSocket = null;
}

function markChannelTerminal(channel = null, terminalStatus = "done") {
  if (!channel) return;
  channel.status = String(terminalStatus || "done").trim();
  channel.updatedAtMs = nowMs();
  channel.cleanupAfterMs = nowMs() + CHANNEL_RETENTION_MS;
}

function connectUpstreamChannel(channel = null, apiKey = "", locale = "") {
  if (!channel || channel.upstreamSocket) return;
  const upstreamUrl = buildUpstreamUrl(UPSTREAM_URL, apiKey);
  if (!upstreamUrl) {
    const errorEnvelope = pushChannelEvent(channel, "error", {
      error: "agentProxy upstream url is empty",
    });
    markChannelTerminal(channel, "error");
    broadcastChannelEvent(channel, errorEnvelope);
    return;
  }
  const upstreamSocket = new WebSocket(upstreamUrl);
  channel.upstreamSocket = upstreamSocket;
  channel.status = "connecting";
  channel.apiKey = String(apiKey || "").trim();
  channel.locale = String(locale || "").trim();
  channel.updatedAtMs = nowMs();

  upstreamSocket.on("open", () => {
    channel.status = "running";
    channel.updatedAtMs = nowMs();
    const payloadToSend =
      channel.startPayload && typeof channel.startPayload === "object"
        ? { ...channel.startPayload }
        : null;
    if (!payloadToSend) return;
    try {
      upstreamSocket.send(JSON.stringify(payloadToSend));
    } catch (error) {
      const errorEnvelope = pushChannelEvent(channel, "error", {
        error: String(error?.message || "agentProxy failed to send payload"),
      });
      markChannelTerminal(channel, "error");
      broadcastChannelEvent(channel, errorEnvelope);
      closeUpstreamChannel(channel, 1011, "send_failed");
    }
  });

  upstreamSocket.on("message", (rawData) => {
    try {
      const parsed = JSON.parse(String(rawData || "{}"));
      const eventName = String(parsed?.event || "message").trim() || "message";
      const eventData =
        parsed?.data && typeof parsed.data === "object" ? parsed.data : {};
      const eventEnvelope = pushChannelEvent(channel, eventName, eventData);
      broadcastChannelEvent(channel, eventEnvelope);
      if (eventName === "done") {
        markChannelTerminal(channel, "done");
      } else if (eventName === "stopped") {
        markChannelTerminal(channel, "stopped");
      } else if (eventName === "error") {
        markChannelTerminal(channel, "error");
      } else {
        channel.status = "running";
      }
    } catch (error) {
      const errorEnvelope = pushChannelEvent(channel, "error", {
        error: String(error?.message || "agentProxy invalid upstream event"),
      });
      markChannelTerminal(channel, "error");
      broadcastChannelEvent(channel, errorEnvelope);
      closeUpstreamChannel(channel, 1011, "invalid_upstream_event");
    }
  });

  upstreamSocket.on("close", () => {
    channel.upstreamSocket = null;
    channel.upstreamClosed = true;
    if (!isTerminalStatus(channel.status)) {
      markChannelTerminal(channel, "stopped");
      const stoppedEnvelope = pushChannelEvent(channel, "stopped", {
        message: "upstream socket closed",
      });
      broadcastChannelEvent(channel, stoppedEnvelope);
    }
  });

  upstreamSocket.on("error", (error) => {
    const errorEnvelope = pushChannelEvent(channel, "error", {
      error: String(error?.message || "upstream websocket error"),
    });
    markChannelTerminal(channel, "error");
    broadcastChannelEvent(channel, errorEnvelope);
  });
}

function resolveChannelFromSocketMessage(socket = null, payload = {}) {
  const action = String(payload?.action || "").trim().toLowerCase();
  if (action === "interaction_response") {
    const requestId = String(payload?.requestId || "").trim();
    if (requestId && requestChannelMap.has(requestId)) {
      const mappedChannelKey = requestChannelMap.get(requestId);
      return channelStore.get(mappedChannelKey) || null;
    }
  }
  const explicitChannelKey = String(payload?.channelKey || "").trim();
  if (explicitChannelKey && channelStore.has(explicitChannelKey)) {
    return channelStore.get(explicitChannelKey);
  }
  const sessionId = String(payload?.sessionId || "").trim();
  const userId = String(payload?.userId || "").trim();
  if (sessionId && userId) {
    const constructedKey = createChannelKey({
      userId,
      sessionId,
      parentSessionId: payload?.parentSessionId,
      parentDialogProcessId: payload?.parentDialogProcessId,
    });
    if (channelStore.has(constructedKey)) return channelStore.get(constructedKey);
  }
  const activeChannelKey = String(socket?.__agentProxyActiveChannelKey || "").trim();
  if (activeChannelKey && channelStore.has(activeChannelKey)) {
    return channelStore.get(activeChannelKey);
  }
  return null;
}

function forwardToUpstream(channel = null, payload = {}) {
  if (!channel?.upstreamSocket || channel.upstreamSocket.readyState !== WebSocket.OPEN) {
    return false;
  }
  try {
    channel.upstreamSocket.send(JSON.stringify(payload || {}));
    return true;
  } catch {
    return false;
  }
}

function startOrJoinChannel({
  socket = null,
  payload = {},
  connectionApiKey = "",
  connectionLocale = "",
}) {
  const normalizedConnectionApiKey = normalizeApiKey(connectionApiKey);
  if (!normalizedConnectionApiKey) {
    sendSocketError(socket, "agentProxy requires apikey");
    return;
  }
  const userId = String(payload?.userId || "").trim();
  const sessionId = String(payload?.sessionId || "").trim();
  if (!userId || !sessionId) {
    sendSocketError(socket, "agentProxy requires userId and sessionId");
    return;
  }
  const parentSessionId = String(payload?.parentSessionId || "").trim();
  const parentDialogProcessId = String(payload?.parentDialogProcessId || "").trim();
  const channelKey = createChannelKey({
    userId,
    sessionId,
    parentSessionId,
    parentDialogProcessId,
  });
  const channel = ensureChannel(channelKey, payload);
  if (!channel) return;
  const identityItem = resolveApiKeyIdentity(normalizedConnectionApiKey);
  const requesterUserId =
    String(socket?.__agentProxyUserId || "").trim() ||
    String(identityItem?.userId || "").trim() ||
    String(userId || "").trim();
  if (!channel.ownerApiKey) {
    channel.ownerApiKey = normalizedConnectionApiKey;
  }
  if (!channel.ownerUserId) {
    channel.ownerUserId = requesterUserId;
  }
  if (
    !ensureChannelPermission({
      channel,
      apiKey: normalizedConnectionApiKey,
      requesterUserId,
      socket,
      action: "start_or_join",
    })
  ) {
    return;
  }

  attachSubscriberToChannel(channel, socket);
  const subscriberSequenceByChannel = socket.__agentProxyLastSequenceByChannel || {};
  const lastKnownSequence = Number(subscriberSequenceByChannel[channel.key] || 0);
  replayChannelEvents(channel, socket, lastKnownSequence);

  const nextPayloadFingerprint = buildFingerprint(payload);
  const sameAsLastPayload = channel.startFingerprint === nextPayloadFingerprint;
  const keepExistingRun =
    channel.status === "running" || channel.status === "connecting";
  if (keepExistingRun) {
    return;
  }
  if (isTerminalStatus(channel.status) && sameAsLastPayload) {
    return;
  }

  channel.startPayload = { ...payload };
  channel.startFingerprint = nextPayloadFingerprint;
  channel.eventLog = [];
  channel.eventSequence = 0;
  channel.cleanupAfterMs = 0;
  channel.upstreamClosed = false;
  closeUpstreamChannel(channel, 1000, "restart");
  connectUpstreamChannel(
    channel,
    normalizedConnectionApiKey,
    String(connectionLocale || "").trim(),
  );
}

function cleanupExpiredChannels() {
  const currentMs = nowMs();
  for (const [channelKey, channel] of channelStore.entries()) {
    const canCleanupTerminal =
      isTerminalStatus(channel.status) &&
      Number(channel.cleanupAfterMs || 0) > 0 &&
      currentMs >= Number(channel.cleanupAfterMs || 0);
    const canCleanupIdle =
      channel.status === "idle" &&
      !channel.subscribers.size &&
      currentMs - Number(channel.updatedAtMs || currentMs) > CHANNEL_RETENTION_MS;
    if (!canCleanupTerminal && !canCleanupIdle) continue;
    closeUpstreamChannel(channel, 1000, "cleanup");
    for (const [requestId, mappedChannelKey] of requestChannelMap.entries()) {
      if (mappedChannelKey === channelKey) {
        requestChannelMap.delete(requestId);
      }
    }
    channelStore.delete(channelKey);
  }
  for (const [apiKey, identityItem] of apiKeyIdentityStore.entries()) {
    const updatedAtMs = Number(identityItem?.updatedAtMs || 0);
    if (!updatedAtMs || currentMs - updatedAtMs > API_KEY_RETENTION_MS) {
      apiKeyIdentityStore.delete(apiKey);
    }
  }
}

function writeProxyError(response, statusCode = 502, message = "Bad Gateway") {
  if (!response || response.headersSent) return;
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      ok: false,
      error: String(message || "Bad Gateway"),
    }),
  );
}

function collectRequestBody(request = null) {
  return new Promise((resolve, reject) => {
    if (!request) {
      resolve(Buffer.from(""));
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || "")));
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    request.on("error", reject);
  });
}

function proxyHttpRequest(request, response) {
  const method = String(request?.method || "GET").trim().toUpperCase() || "GET";
  let targetUrl = null;
  try {
    targetUrl = new URL(request?.url || "/", UPSTREAM_HTTP_BASE);
  } catch {
    writeProxyError(response, 400, "agentProxy invalid request url");
    return;
  }
  const isHttps = targetUrl.protocol === "https:";
  const requestHeaders = { ...(request?.headers || {}) };
  delete requestHeaders.host;
  const transport = isHttps ? https : http;
  const upstreamRequest = transport.request(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      method,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers: requestHeaders,
    },
    (upstreamResponse) => {
      const statusCode = Number(upstreamResponse?.statusCode || 502);
      const responseHeaders = { ...(upstreamResponse?.headers || {}) };
      responseHeaders["x-agent-proxy"] = "noobot-agent-proxy";
      response.writeHead(statusCode, responseHeaders);
      upstreamResponse.pipe(response);
    },
  );
  upstreamRequest.on("error", (error) => {
    writeProxyError(response, 502, error?.message || "agentProxy upstream http error");
  });
  request.pipe(upstreamRequest);
}

async function interceptConnectRequest(request, response) {
  const method = String(request?.method || "POST").trim().toUpperCase() || "POST";
  const requestBodyBuffer = await collectRequestBody(request);
  const forwardedHeaders = { ...(request?.headers || {}) };
  delete forwardedHeaders.host;
  delete forwardedHeaders["content-length"];
  let upstreamConnectUrl = "";
  try {
    upstreamConnectUrl = new URL("/internal/connect", UPSTREAM_HTTP_BASE).toString();
  } catch {
    writeProxyError(response, 500, "agentProxy invalid upstream base url");
    return;
  }
  let upstreamResponse = null;
  try {
    upstreamResponse = await fetch(upstreamConnectUrl, {
      method,
      headers: forwardedHeaders,
      body: ["GET", "HEAD"].includes(method) ? undefined : requestBodyBuffer,
    });
  } catch (error) {
    writeProxyError(response, 502, error?.message || "agentProxy connect intercept failed");
    return;
  }

  const contentType = String(upstreamResponse.headers.get("content-type") || "").toLowerCase();
  const statusCode = Number(upstreamResponse.status || 502);
  const rawText = await upstreamResponse.text();
  const headers = {
    "x-agent-proxy": "noobot-agent-proxy",
    "x-agent-proxy-intercept": "connect",
  };

  if (contentType.includes("application/json")) {
    try {
      const parsedJson = JSON.parse(String(rawText || "{}"));
      const responsePayload =
        parsedJson && typeof parsedJson === "object"
          ? {
              ...parsedJson,
              permissions:
                parsedJson?.permissions &&
                typeof parsedJson.permissions === "object"
                  ? parsedJson.permissions
                  : buildClientPermissions(parsedJson?.role || "user"),
              agentProxy: {
                enabled: true,
                wsPath: "/chat/ws",
              },
            }
          : parsedJson;
      saveApiKeyIdentity({
        apiKey: responsePayload?.apiKey || "",
        userId: responsePayload?.userId || "",
        role: responsePayload?.role || "",
      });
      response.writeHead(statusCode, {
        ...headers,
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(responsePayload));
      return;
    } catch {
      response.writeHead(statusCode, {
        ...headers,
        "content-type": contentType || "application/json; charset=utf-8",
      });
      response.end(rawText);
      return;
    }
  }

  response.writeHead(statusCode, {
    ...headers,
    "content-type": contentType || "text/plain; charset=utf-8",
  });
  response.end(rawText);
}

const httpServer = http.createServer((request, response) => {
  const pathname = parseRequestPathname(request);
  if (pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        service: "agentProxy",
        channelCount: channelStore.size,
      }),
    );
    return;
  }
  if (shouldInterceptConnectPath(pathname)) {
    interceptConnectRequest(request, response).catch((error) => {
      writeProxyError(response, 500, error?.message || "agentProxy connect intercept error");
    });
    return;
  }
  proxyHttpRequest(request, response);
});

const websocketServer = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (request, socket, head) => {
  const { pathname } = parseRequestQuery(request);
  if (!["/chat/ws", "/api/chat/ws", "/agent-proxy/ws", "/api/agent-proxy/ws"].includes(pathname)) {
    socket.destroy();
    return;
  }
  websocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    webSocket.__agentProxySocketId = randomUUID();
    webSocket.__agentProxyChannelKeys = new Set();
    webSocket.__agentProxyLastSequenceByChannel = {};
    websocketServer.emit("connection", webSocket, request);
  });
});

websocketServer.on("connection", (socket, request) => {
  const requestInfo = parseRequestQuery(request);
  const connectionApiKey = normalizeApiKey(requestInfo.apiKey);
  const connectionLocale = requestInfo.locale;
  socket.__agentProxyApiKey = connectionApiKey;
  const socketIdentity = resolveApiKeyIdentity(connectionApiKey);
  socket.__agentProxyUserId = String(socketIdentity?.userId || "").trim();

  if (!connectionApiKey) {
    sendSocketError(socket, "agentProxy missing apikey");
    try {
      socket.close(1008, "missing_apikey");
    } catch {
      // ignore close errors
    }
    return;
  }

  socket.on("message", (rawData) => {
    let payload = {};
    try {
      payload = JSON.parse(String(rawData || "{}"));
    } catch {
      sendSocketEvent(socket, {
        event: "error",
        data: { error: "agentProxy invalid json payload" },
      });
      return;
    }
    const action = String(payload?.action || "").trim().toLowerCase();
    if (!action) {
      startOrJoinChannel({
        socket,
        payload,
        connectionApiKey,
        connectionLocale,
      });
      return;
    }
    if (action === "stop") {
      const targetChannel = resolveChannelFromSocketMessage(socket, payload);
      if (!targetChannel) {
        sendSocketError(socket, "agentProxy channel not found for stop");
        return;
      }
      if (
        !ensureChannelPermission({
          channel: targetChannel,
          apiKey: socket.__agentProxyApiKey,
          requesterUserId: String(socket?.__agentProxyUserId || "").trim(),
          socket,
          action: "stop",
        })
      ) {
        return;
      }
      const forwarded = forwardToUpstream(targetChannel, { action: "stop" });
      if (!forwarded) {
        const stoppedEnvelope = pushChannelEvent(targetChannel, "stopped", {
          message: "agentProxy upstream not running",
        });
        markChannelTerminal(targetChannel, "stopped");
        broadcastChannelEvent(targetChannel, stoppedEnvelope);
      }
      return;
    }
    if (action === "interaction_response") {
      const targetChannel = resolveChannelFromSocketMessage(socket, payload);
      if (!targetChannel) {
        sendSocketError(socket, "agentProxy channel not found for interaction");
        return;
      }
      if (
        !ensureChannelPermission({
          channel: targetChannel,
          apiKey: socket.__agentProxyApiKey,
          requesterUserId: String(socket?.__agentProxyUserId || "").trim(),
          socket,
          action: "interaction_response",
        })
      ) {
        return;
      }
      const forwarded = forwardToUpstream(targetChannel, payload);
      if (!forwarded) {
        sendSocketError(socket, "agentProxy upstream is unavailable");
      }
      return;
    }
    if (action === "join") {
      const targetChannel = resolveChannelFromSocketMessage(socket, payload);
      if (!targetChannel) {
        sendSocketError(socket, "agentProxy channel not found for join");
        return;
      }
      if (
        !ensureChannelPermission({
          channel: targetChannel,
          apiKey: socket.__agentProxyApiKey,
          requesterUserId: String(socket?.__agentProxyUserId || "").trim(),
          socket,
          action: "join",
        })
      ) {
        return;
      }
      attachSubscriberToChannel(targetChannel, socket);
      const sequenceByChannel = socket.__agentProxyLastSequenceByChannel || {};
      replayChannelEvents(
        targetChannel,
        socket,
        Number(sequenceByChannel[targetChannel.key] || 0),
      );
      return;
    }
    sendSocketEvent(socket, {
      event: "error",
      data: { error: `agentProxy unsupported action: ${action}` },
    });
  });

  socket.on("close", () => {
    detachSocketFromAllChannels(socket);
  });

  socket.on("error", () => {
    detachSocketFromAllChannels(socket);
  });
});

const cleanupTimer = setInterval(() => {
  cleanupExpiredChannels();
}, CLEANUP_INTERVAL_MS);

cleanupTimer.unref?.();

httpServer.listen(PROXY_PORT, PROXY_HOST, () => {
  console.log(
    `[agentProxy] listening on ${PROXY_HOST}:${PROXY_PORT}, upstream=${UPSTREAM_URL}`,
  );
});
