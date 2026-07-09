/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";
import { normalizeSseLogEvent } from "#agent/event";
import {
  BUILTIN_THRESHOLDS,
  hasOwnConfigKey,
  mergeConfig,
  normalizeBooleanLike,
  normalizeTimeMs,
  resolveRunConfigValue,
  resolveTimeMs,
} from "#agent/config";
import { HTTP_STATUS } from "#agent/constants";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const DEFAULT_RUN_TIMEOUT_MS = BUILTIN_THRESHOLDS.runTimeoutMs;
const MIN_RUN_TIMEOUT_MS = TIME_THRESHOLDS.agent.minRunTimeoutMs;
const MAX_RUN_TIMEOUT_MS = TIME_THRESHOLDS.agent.maxRunTimeoutMs;
const PENDING_STOP_TTL_MS = TIME_THRESHOLDS.agent.pendingStopTtlMs;

const activeRunRegistry = new Map();
const pendingStopRegistry = new Map();

function normalizeRunIdentityPart(value = "") {
  return String(value || "").trim();
}

function buildRunRegistryKeys({ sessionId = "", turnScopeId = "", dialogProcessId = "" } = {}) {
  const normalizedSessionId = normalizeRunIdentityPart(sessionId);
  const normalizedTurnScopeId = normalizeRunIdentityPart(turnScopeId);
  const normalizedDialogProcessId = normalizeRunIdentityPart(dialogProcessId);
  const keys = [];
  if (normalizedSessionId && normalizedTurnScopeId) keys.push(`session:${normalizedSessionId}:turn:${normalizedTurnScopeId}`);
  if (normalizedSessionId && normalizedDialogProcessId) keys.push(`session:${normalizedSessionId}:dialog:${normalizedDialogProcessId}`);
  if (normalizedDialogProcessId) keys.push(`dialog:${normalizedDialogProcessId}`);
  return [...new Set(keys)];
}

function registerActiveRun(handle = {}) {
  const keys = buildRunRegistryKeys(handle);
  handle.registryKeys = [...new Set([...(handle.registryKeys || []), ...keys])];
  for (const key of keys) activeRunRegistry.set(key, handle);
  return handle;
}

function unregisterActiveRun(handle = {}) {
  for (const key of handle.registryKeys || []) {
    if (activeRunRegistry.get(key) === handle) activeRunRegistry.delete(key);
  }
  handle.registryKeys = [];
}

function findActiveRun(identity = {}) {
  for (const key of buildRunRegistryKeys(identity)) {
    const handle = activeRunRegistry.get(key);
    if (handle) return handle;
  }
  return null;
}

function rememberPendingStop(identity = {}, stopPayload = {}) {
  const expiresAtMs = Date.now() + PENDING_STOP_TTL_MS;
  for (const key of buildRunRegistryKeys(identity)) {
    const previousEntry = pendingStopRegistry.get(key);
    if (previousEntry?.timer) clearTimeout(previousEntry.timer);
    const timer = setTimeout(() => {
      const currentEntry = pendingStopRegistry.get(key);
      if (currentEntry?.expiresAtMs === expiresAtMs) pendingStopRegistry.delete(key);
    }, PENDING_STOP_TTL_MS);
    timer?.unref?.();
    pendingStopRegistry.set(key, { payload: stopPayload, expiresAtMs, timer });
  }
}

function deletePendingStopKeys(keys = []) {
  for (const key of keys) {
    const entry = pendingStopRegistry.get(key);
    if (entry?.timer) clearTimeout(entry.timer);
    pendingStopRegistry.delete(key);
  }
}

function consumePendingStop(identity = {}) {
  const nowMs = Date.now();
  for (const key of buildRunRegistryKeys(identity)) {
    const entry = pendingStopRegistry.get(key);
    if (!entry) continue;
    if (Number(entry?.expiresAtMs || 0) <= nowMs) {
      deletePendingStopKeys([key]);
      continue;
    }
    if (entry?.payload) {
      deletePendingStopKeys(buildRunRegistryKeys(identity));
      return entry.payload;
    }
  }
  return null;
}

function buildStoppedPartialAssistant({ stopPayload = {}, runMeta = {}, result = {}, fallbackMessage = "" } = {}) {
  const sourcePartial = stopPayload?.partialAssistant && typeof stopPayload.partialAssistant === "object"
    ? stopPayload.partialAssistant
    : {};
  const dialogProcessId =
    normalizeRunIdentityPart(sourcePartial.dialogProcessId) ||
    normalizeRunIdentityPart(stopPayload?.dialogProcessId) ||
    normalizeRunIdentityPart(runMeta?.dialogProcessId) ||
    normalizeRunIdentityPart(result?.dialogProcessId);
  const turnScopeId =
    normalizeRunIdentityPart(sourcePartial.turnScopeId) ||
    normalizeRunIdentityPart(stopPayload?.turnScopeId) ||
    normalizeRunIdentityPart(runMeta?.turnScopeId);
  const sessionId =
    normalizeRunIdentityPart(sourcePartial.sessionId) ||
    normalizeRunIdentityPart(stopPayload?.sessionId) ||
    normalizeRunIdentityPart(runMeta?.sessionId) ||
    normalizeRunIdentityPart(result?.sessionId);
  const content = String(sourcePartial.content ?? stopPayload?.message ?? fallbackMessage ?? "").trim();
  return {
    ...sourcePartial,
    content,
    sessionId,
    dialogProcessId,
    turnScopeId,
    state: "user_stopped",
    status: "user_stopped",
    channelState: "user_stopped",
    stopState: "user_stopped",
    monotonicState: "monotonic",
    isMonotonic: true,
    monotonic: true,
  };
}

function summarizeDebugAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    return { kind: attachments === undefined ? "undefined" : "non-array", count: 0, items: [] };
  }
  return {
    kind: "array",
    count: attachments.length,
    items: attachments.slice(0, 8).map((attachment = {}) => ({
      id: String(attachment.id || attachment.fileId || attachment.attachmentId || ""),
      name: String(attachment.name || attachment.fileName || attachment.filename || ""),
      type: String(attachment.type || attachment.mimeType || attachment.mime || ""),
      size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : undefined,
      url: attachment.url ? "present" : "",
    })),
  };
}

export function recordServiceWebSocketSendFailure({
  sessionLogConfig,
  eventName = "",
  sessionId = "",
  userId = "",
  dialogProcessId = "",
  turnScopeId = "",
  error = null,
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) return Promise.resolve({ ok: true, skipped: true });
  return writeRoutedRuntimeEvent({
      scope: "session",
    source: "service",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
    event: "service.websocket.sendEvent.failed",
    sessionId: normalizedSessionId,
    userId: String(userId || "").trim(),
    dialogProcessId: String(dialogProcessId || "").trim(),
    turnScopeId: String(turnScopeId || "").trim(),
    data: {
      eventName: String(eventName || ""),
      error: error?.message || String(error || ""),
    },
  }, sessionLogConfig);
}

export function recordServiceWebSocketRuntimeError({
  sessionLogConfig,
  event = "service.websocket.runtime.failed",
  userId = "",
  sessionId = "",
  parentSessionId = "",
  dialogProcessId = "",
  turnScopeId = "",
  error = null,
  data = {},
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) return Promise.resolve({ ok: true, skipped: true });
  return writeRoutedRuntimeEvent({
      scope: "session",
    source: "service",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
    event,
    userId: String(userId || "").trim(),
    sessionId: normalizedSessionId,
    parentSessionId: String(parentSessionId || "").trim(),
    dialogProcessId: String(dialogProcessId || "").trim(),
    turnScopeId: String(turnScopeId || "").trim(),
    data: {
      ...(data && typeof data === "object" ? data : {}),
      error: error?.message || String(error || ""),
    },
  }, sessionLogConfig);
}

function resolveRunTimeoutMs(rawValue) {
  return normalizeTimeMs(rawValue, {
    fallback: DEFAULT_RUN_TIMEOUT_MS,
    min: MIN_RUN_TIMEOUT_MS,
    max: MAX_RUN_TIMEOUT_MS,
  });
}

function resolveConfigRunTimeoutMs(config = {}) {
  const source =
    config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const hasCanonical = Object.prototype.hasOwnProperty.call(source, "runTimeoutMs");
  const hasLegacy = Object.prototype.hasOwnProperty.call(source, "run_timeout_ms");
  if (!hasCanonical && !hasLegacy) return undefined;
  return resolveTimeMs(source, {
    key: "runTimeoutMs",
    legacyKeys: ["run_timeout_ms"],
    sourceTag: "service.ws.chat-websocket-server",
    warnLegacy: true,
    fallback: DEFAULT_RUN_TIMEOUT_MS,
    min: MIN_RUN_TIMEOUT_MS,
    max: MAX_RUN_TIMEOUT_MS,
  });
}

function isPluginDebugEnabled() {
  const value = String(process.env.NOOBOT_PLUGIN_DEBUG || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function summarizePluginConfig(plugins = {}) {
  if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) return {};
  return Object.fromEntries(
    Object.entries(plugins).map(([key, value]) => [
      key,
      value && typeof value === "object"
        ? { enabled: value.enabled, mode: value.mode }
        : value,
    ]),
  );
}

function isAbortLikeError(error) {
  const normalizedName = String(error?.name || "").trim().toLowerCase();
  const message = String(error?.message || "").trim().toLowerCase();
  const code = String(error?.code || "").trim().toUpperCase();
  return (
    normalizedName === "aborterror" ||
    code === "ABORT_ERR" ||
    message === "aborterror" ||
    message.includes("aborterror") ||
    message.includes("aborted") ||
    message.includes("stopped by user")
  );
}

function isUserStopAbortReason(reason = {}) {
  return reason && typeof reason === "object" && String(reason?.type || "").trim() === "user_stop";
}

function isUserStopRunAbort({ stopRequested = false, abortSignal = null } = {}) {
  return stopRequested === true || isUserStopAbortReason(abortSignal?.reason);
}

function buildAbortErrorMessage({ error = null, abortSignal = null, currentLocale = "", translateText = (key) => key } = {}) {
  const reason = abortSignal?.reason;
  const reasonType = reason && typeof reason === "object" ? String(reason?.type || "").trim() : "";
  const reasonText = reason && typeof reason === "object" ? String(reason?.reason || "").trim() : "";
  return (
    String(error?.message || "").trim() ||
    reasonText ||
    (reasonType ? `run aborted: ${reasonType}` : "") ||
    translateText("ws.unknownError", currentLocale)
  );
}

function normalizeWsText(value = "") {
  return String(value || "").trim();
}

function isChildRunEventData(eventData = {}, { rootSessionId = "" } = {}) {
  const normalizedRootSessionId = normalizeWsText(rootSessionId);
  const eventSessionId = normalizeWsText(eventData?.sessionId);
  const subAgentSessionId = normalizeWsText(eventData?.subAgentSessionId);
  const parentSessionId = normalizeWsText(eventData?.parentSessionId);
  return Boolean(
    eventData?.subAgentCall ||
      (eventSessionId && normalizedRootSessionId && eventSessionId !== normalizedRootSessionId) ||
      (subAgentSessionId && normalizedRootSessionId && subAgentSessionId !== normalizedRootSessionId) ||
      (parentSessionId && normalizedRootSessionId && parentSessionId === normalizedRootSessionId),
  );
}

function parentOwnsChildRunEventData(eventData = {}, {
  rootSessionId = "",
  parentDialogProcessId = "",
} = {}) {
  const childSessionId = normalizeWsText(eventData?.sessionId || eventData?.subAgentSessionId);
  const childDialogProcessId = normalizeWsText(eventData?.dialogProcessId);
  const resolvedParentDialogProcessId = normalizeWsText(
    parentDialogProcessId || eventData?.parentDialogProcessId,
  );
  return {
    ...(eventData && typeof eventData === "object" ? eventData : {}),
    sessionId: normalizeWsText(rootSessionId),
    dialogProcessId: resolvedParentDialogProcessId,
    parentDialogProcessId: resolvedParentDialogProcessId,
    childSessionId,
    childDialogProcessId,
    subAgentCall: true,
    conversationStateOwner: "parent_agent",
  };
}

function buildParentOwnedChildRunPayload(normalizedData = {}, parentOwnedData = {}, {
  rootSessionId = "",
  turnScopeId = "",
} = {}) {
  return {
    ...(normalizedData && typeof normalizedData === "object" ? normalizedData : {}),
    sessionId: normalizeWsText(rootSessionId),
    dialogProcessId: normalizeWsText(parentOwnedData?.dialogProcessId),
    parentDialogProcessId: normalizeWsText(parentOwnedData?.parentDialogProcessId),
    childSessionId: normalizeWsText(parentOwnedData?.childSessionId),
    childDialogProcessId: normalizeWsText(parentOwnedData?.childDialogProcessId),
    subAgentCall: true,
    conversationStateOwner: "parent_agent",
    turnScopeId: normalizeWsText(turnScopeId),
  };
}

async function resolveEffectiveRunTimeoutMs({ bot: _bot, userId: _userId = "", runConfig = {} } = {}) {
  const runConfigTimeoutMs = resolveConfigRunTimeoutMs(runConfig);
  if (runConfigTimeoutMs !== undefined && runConfigTimeoutMs !== null) {
    return resolveRunTimeoutMs(runConfigTimeoutMs);
  }

  return resolveRunTimeoutMs(DEFAULT_RUN_TIMEOUT_MS);
}

async function resolveEffectiveStreamingEnabled({ bot, userId = "", runConfig = {} } = {}) {
  const runConfigSource =
    runConfig && typeof runConfig === "object" && !Array.isArray(runConfig) ? runConfig : {};
  if (hasOwnConfigKey(runConfigSource, "streaming")) {
    return resolveRunConfigValue({
      runConfig: runConfigSource,
      config: {},
      key: "streaming",
      normalize: (value) => normalizeBooleanLike(value, false),
      fallback: false,
    });
  }

  const normalizedUserId = String(userId || "").trim();
  const globalConfig =
    bot?.globalConfig && typeof bot.globalConfig === "object" ? bot.globalConfig : {};
  if (!normalizedUserId || typeof bot?.loadUserConfig !== "function") {
    return resolveRunConfigValue({
      runConfig: {},
      config: globalConfig,
      key: "streaming",
      normalize: (value) => normalizeBooleanLike(value, false),
      fallback: false,
    });
  }

  let userConfig = {};
  try {
    const workspacePath =
      typeof bot?.getWorkspacePath === "function" ? bot.getWorkspacePath(normalizedUserId) : "";
    userConfig =
      workspacePath && typeof workspacePath === "string"
        ? (await bot.loadUserConfig(workspacePath)) || {}
        : {};
  } catch (error) {
    void writeRoutedRuntimeEvent({
      source: "service",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.CONFIG,
      level: "warn",
      event: "service.websocket.userConfig.load.failed",
      data: { userIdLength: normalizedUserId.length },
      error,
    });
    userConfig = {};
  }
  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  return resolveRunConfigValue({
    runConfig: {},
    config: effectiveConfig,
    key: "streaming",
    normalize: (value) => normalizeBooleanLike(value, false),
    fallback: false,
  });
}

function sendUpgradeError(
  socket,
  statusCode = HTTP_STATUS.UNAUTHORIZED,
  message = "Unauthorized",
) {
  if (!socket.writable) return;
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
  );
  socket.destroy();
}

export function registerChatWebSocketServer(
  server,
  {
    bot,
    getBot,
    resolveRequestLocale,
    resolveAuthByApiKey,
    isForbiddenUserScope,
    normalizeRunConfig,
    normalizeLocale,
    defaultLocale,
    translateText,
    sessionLogConfig,
  } = {},
) {
  const resolveBot = () => {
    if (typeof getBot === "function") return getBot();
    return bot;
  };

  const webSocketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const requestLocale = resolveRequestLocale(request, defaultLocale);
    let requestPathname = "";
    try {
      requestPathname = new URL(request.url || "", "http://localhost").pathname;
    } catch (error) {
      const rawUrl = String(request?.url || "");
      const urlPathPreview = rawUrl.split("?")[0].slice(0, 200);
      void writeRoutedRuntimeEvent({
        source: "service",
        channel: RUNTIME_EVENT_CHANNELS.DIRECT,
        category: RUNTIME_EVENT_CATEGORIES.TRANSPORT,
        level: "warn",
        event: "service.websocket.upgradeUrlParse.failed",
        data: {
          urlPathPreview,
          urlLength: rawUrl.length,
        },
        error,
      }, sessionLogConfig);
      sendUpgradeError(
        socket,
        HTTP_STATUS.BAD_REQUEST,
        translateText("ws.badRequest", requestLocale),
      );
      return;
    }

    if (requestPathname.startsWith("/ide/")) {
      return;
    }

    if (requestPathname !== "/chat/ws") return;

    const authInfo = resolveAuthByApiKey(request);
    if (!authInfo) {
      sendUpgradeError(
        socket,
        HTTP_STATUS.UNAUTHORIZED,
        translateText("auth.missingApiKey", requestLocale),
      );
      return;
    }
    request.auth = authInfo;
    request.locale = requestLocale;

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  webSocketServer.on("connection", (webSocket, request) => {
    const authInfo = request?.auth || null;
    let currentLocale = normalizeLocale(request?.locale || defaultLocale);
    let isRunning = false;
    let currentAbortController = null;
    let currentRunMeta = null;
    let currentRunTimeoutTimer = null;
    let currentRunTimedOut = false;
    let currentStopPayload = null;
    let stopRequested = false;
    let currentTurnScopeId = "";
    let currentAbortSignal = null;
    let currentRunHandle = null;
    const pendingInteractionRequests = new Map();

    let eventSequence = 0;
    const sendEvent = (eventName, data = {}) => {
      if (webSocket.readyState !== 1) return;
      eventSequence += 1;
      const enrichedData = {
        ...(data && typeof data === "object" ? data : {}),
        seq: eventSequence,
        dialogProcessId: String(data?.dialogProcessId || "").trim(),
        sessionId: String(data?.sessionId || "").trim(),
        turnScopeId: String(data?.turnScopeId || currentRunMeta?.turnScopeId || "").trim(),
      };
      try {
        webSocket.send(JSON.stringify({ event: eventName, data: enrichedData }));
      } catch (error) {
        void recordServiceWebSocketSendFailure({
          sessionLogConfig,
          eventName: String(eventName || ""),
          userId: currentRunMeta?.userId || "",
          dialogProcessId: enrichedData.dialogProcessId,
          sessionId: enrichedData.sessionId,
          turnScopeId: enrichedData.turnScopeId,
          error,
        });
      }
    };

    const rejectAllPendingInteractions = (error) => {
      for (const [, requestItem] of pendingInteractionRequests.entries()) {
        try {
          requestItem?.reject?.(error);
        } catch (rejectError) {
          void writeRoutedRuntimeEvent({
            source: "service",
            channel: RUNTIME_EVENT_CHANNELS.DIRECT,
            category: RUNTIME_EVENT_CATEGORIES.INTERACTION,
            level: "warn",
            event: "service.websocket.pendingInteraction.reject.failed",
            userId: currentRunMeta?.userId || "",
            sessionId: currentRunMeta?.sessionId || "",
            dialogProcessId: currentRunMeta?.dialogProcessId || "",
            turnScopeId: currentRunMeta?.turnScopeId || "",
            error: rejectError,
          }, sessionLogConfig);
        }
        clearTimeout(requestItem?.timer);
      }
      pendingInteractionRequests.clear();
    };

    const userInteractionBridge = {
      requestUserInteraction: ({
        content = "",
        fields = [],
        dialogProcessId = "",
        requireEncryption = false,
        sessionId = "",
        toolName = "",
        needConnectionInfo = false,
        connectorName = "",
        connectorType = "",
        interactionType = "",
        interactionData = {},
        lifecycle = "pending",
        ackMode = "manual",
        resolvedBy = "",
        notification = {},
      } = {}) =>
        new Promise((resolveInteraction, rejectInteraction) => {
          const requestId = randomBytes(12).toString("hex");
          const timeoutMilliseconds = 10 * 60 * 1000;
          const timer = setTimeout(() => {
            pendingInteractionRequests.delete(requestId);
            rejectInteraction(new Error(translateText("ws.userInteractionTimeout", currentLocale)));
          }, timeoutMilliseconds);

          pendingInteractionRequests.set(requestId, {
            resolve: resolveInteraction,
            reject: rejectInteraction,
            timer,
          });

          sendEvent("interaction_request", {
            requestId,
            content: String(content || ""),
            fields: Array.isArray(fields) ? fields : [],
            dialogProcessId: String(dialogProcessId || ""),
            requireEncryption: Boolean(requireEncryption),
            sessionId: String(sessionId || "").trim(),
            toolName: String(toolName || "").trim(),
            needConnectionInfo: Boolean(needConnectionInfo),
            connectorName: String(connectorName || "").trim(),
            connectorType: String(connectorType || "").trim(),
            interactionType: String(interactionType || "").trim(),
            lifecycle: String(lifecycle || "").trim().toLowerCase() || "pending",
            ackMode: String(ackMode || "").trim().toLowerCase() || "manual",
            resolvedBy: String(resolvedBy || "").trim().toLowerCase(),
            notification:
              notification && typeof notification === "object" && !Array.isArray(notification)
                ? notification
                : {},
            interactionData:
              interactionData && typeof interactionData === "object"
                ? interactionData
                : {},
          });
        }),
      emitNotification: ({ eventName = "notification", data = {} } = {}) => {
        const normalizedEventName =
          String(eventName || "").trim().toLowerCase() || "notification";
        const payload = data && typeof data === "object" ? data : {};
        sendEvent(normalizedEventName, payload);
        return Promise.resolve({
          ok: true,
          event: normalizedEventName,
        });
      },
    };

    webSocket.on("message", async (rawMessage) => {
      let runMessageStarted = false;
      try {
        const payload = JSON.parse(String(rawMessage || "{}"));
        const action = String(payload?.action || "").trim().toLowerCase();
        const isContinueAction = action === "continue" || action === "resume";
        if (action === "interaction_response") {
          const requestId = String(payload?.requestId || "").trim();
          const requestItem = pendingInteractionRequests.get(requestId);
          if (!requestItem) {
            sendEvent("error", { error: translateText("ws.interactionNotFound", currentLocale) });
            return;
          }
          pendingInteractionRequests.delete(requestId);
          clearTimeout(requestItem.timer);
          requestItem.resolve(payload?.response ?? {});
          return;
        }
        if (action === "stop") {
          stopRequested = true;
          currentTurnScopeId =
            String(payload?.turnScopeId || payload?.partialAssistant?.turnScopeId || "").trim() ||
            currentTurnScopeId;
          rejectAllPendingInteractions(new Error(translateText("ws.dialogStoppedByUser", currentLocale)));
          currentStopPayload = {
            message: translateText("ws.dialogStoppedByUser", currentLocale),
            sessionId: String(payload?.sessionId || payload?.partialAssistant?.sessionId || "").trim() || currentRunMeta?.sessionId || "",
            dialogProcessId:
              String(payload?.dialogProcessId || "").trim() ||
              String(payload?.partialAssistant?.dialogProcessId || "").trim() ||
              currentRunMeta?.dialogProcessId ||
              "",
            turnScopeId:
              String(payload?.turnScopeId || payload?.partialAssistant?.turnScopeId || "").trim() ||
              currentTurnScopeId ||
              currentRunMeta?.turnScopeId ||
              "",
            partialAssistant: payload?.partialAssistant || {},
          };
          const activeRun = findActiveRun(currentStopPayload);
          if (activeRun && activeRun.abortController && !activeRun.abortController.signal?.aborted) {
            activeRun.stopRequested = true;
            activeRun.stopPayload = currentStopPayload;
            activeRun.abortController.abort({
              type: "user_stop",
              reason: "user stop action",
              stopPayload: currentStopPayload,
            });
            sendEvent("channel_state", {
              ...currentStopPayload,
              state: "stopping",
              sourceEvent: "stop_requested_registry",
            });
            return;
          }
          if (!isRunning || !currentAbortController) {
            rememberPendingStop(currentStopPayload, currentStopPayload);
            sendEvent("channel_state", {
              ...currentStopPayload,
              state: "stopping",
              sourceEvent: "stop_requested_pending",
            });
            return;
          }
          if (isRunning && currentAbortController) {
            currentAbortController.abort({
              type: "user_stop",
              reason: "user stop action",
              stopPayload: currentStopPayload,
            });
          }
          sendEvent("channel_state", {
            ...currentStopPayload,
            state: "stopping",
            sourceEvent: "stop_requested",
          });
          return;
        }
        if (isRunning) {
          sendEvent("error", { error: translateText("ws.sessionAlreadyRunning", currentLocale) });
          return;
        }
        isRunning = true;
        runMessageStarted = true;
        currentAbortController = new AbortController();
        currentRunTimedOut = false;
        currentAbortSignal = currentAbortController.signal;

        const {
          userId,
          sessionId,
          parentSessionId = "",
          dialogProcessId = "",
          parentDialogProcessId = "",
          message,
          attachments = [],
          config = {},
          turnScopeId = "",
        } = payload || {};
        currentTurnScopeId =
          String(turnScopeId || config?.turnScopeId || "").trim() ||
          currentTurnScopeId;
        currentLocale = normalizeLocale(config?.locale || currentLocale);

        void writeRoutedRuntimeEvent({
          scope: "session",
          source: "service",
          channel: RUNTIME_EVENT_CHANNELS.DIRECT,
          category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
          event: "debug.resend.websocket.received",
          userId: String(userId || "").trim(),
          sessionId: String(sessionId || "").trim(),
          parentSessionId: String(parentSessionId || "").trim(),
          turnScopeId: String(currentTurnScopeId || turnScopeId || config?.turnScopeId || "").trim(),
          data: {
            reuseExistingUserTurn: config?.reuseExistingUserTurn === true,
            hasPayloadThinkingStartedAt: Boolean(String(config?.thinkingStartedAt || "").trim()),
            payloadThinkingStartedAt: String(config?.thinkingStartedAt || "").trim(),
            attachments: summarizeDebugAttachments(attachments),
            payloadAttachments: summarizeDebugAttachments(payload?.attachments),
          },
        }, sessionLogConfig);

        if (!userId || !sessionId || !message) {
          throw new Error(translateText("common.userSessionMessageRequired", currentLocale));
        }
        if (isForbiddenUserScope(authInfo, userId)) {
          throw new Error(translateText("auth.forbiddenUserScope", currentLocale));
        }
        const normalizedRunConfig = {
          ...normalizeRunConfig(config),
          turnScopeId: String(turnScopeId || config?.turnScopeId || "").trim(),
        };
        if (isContinueAction) {
          const resumeDialogProcessId = String(config?.resumeDialogProcessId || "").trim();
          const resumeTurnScopeId = String(config?.resumeTurnScopeId || config?.stoppedTurnScopeId || "").trim();
          normalizedRunConfig.resumeFromStoppedSnapshot = true;
          normalizedRunConfig.resumeDialogProcessId = resumeDialogProcessId;
          normalizedRunConfig.resumeTurnScopeId = resumeTurnScopeId;
          if (!normalizedRunConfig.resumeDialogProcessId || !normalizedRunConfig.resumeTurnScopeId) {
            throw new Error("continue requires resumeDialogProcessId and resumeTurnScopeId");
          }
        }
        if (isPluginDebugEnabled()) {
          await writeRoutedRuntimeEvent({
            scope: "session",
            source: "service",
            channel: RUNTIME_EVENT_CHANNELS.DIRECT,
            category: "debug",
            event: "service.websocket.pluginDebug.runConfig",
            userId: String(userId || "").trim(),
            sessionId: String(sessionId || "").trim(),
            dialogProcessId: "",
            turnScopeId: String(normalizedRunConfig?.turnScopeId || currentTurnScopeId || "").trim(),
            data: {
              payloadSelectedPlugins: config?.selectedPlugins,
              normalizedSelectedPlugins: normalizedRunConfig?.selectedPlugins,
              normalizedPlugins: summarizePluginConfig(normalizedRunConfig?.plugins),
              hasPayloadThinkingStartedAt: Boolean(String(config?.thinkingStartedAt || "").trim()),
              payloadThinkingStartedAt: String(config?.thinkingStartedAt || "").trim(),
              normalizedThinkingStartedAt: String(normalizedRunConfig?.thinkingStartedAt || "").trim(),
            },
          });
        }
        const activeBot = resolveBot();
        const runTimeoutMs = await resolveEffectiveRunTimeoutMs({
          bot: activeBot,
          userId,
          runConfig: normalizedRunConfig,
        });
        currentRunTimeoutTimer = setTimeout(() => {
          currentRunTimedOut = true;
          if (currentAbortController) {
            currentAbortController.abort({
              type: "run_timeout",
              reason: `run timeout after ${runTimeoutMs}ms`,
              timeoutMs: runTimeoutMs,
            });
          }
        }, runTimeoutMs);
        currentRunMeta = {
          userId: String(userId || "").trim(),
          sessionId: String(sessionId || "").trim(),
          parentSessionId: String(parentSessionId || "").trim(),
          parentDialogProcessId: String(parentDialogProcessId || "").trim(),
          dialogProcessId: "",
          turnScopeId: String(normalizedRunConfig?.turnScopeId || currentTurnScopeId || "").trim(),
        };
        currentRunHandle = registerActiveRun({
          userId: currentRunMeta.userId,
          sessionId: currentRunMeta.sessionId,
          dialogProcessId: currentRunMeta.dialogProcessId,
          turnScopeId: currentRunMeta.turnScopeId,
          abortController: currentAbortController,
          stopRequested: false,
          stopPayload: null,
        });
        const pendingStopPayload = consumePendingStop(currentRunMeta);
        if (pendingStopPayload) {
          stopRequested = true;
          currentStopPayload = {
            ...pendingStopPayload,
            sessionId: pendingStopPayload?.sessionId || currentRunMeta.sessionId || "",
            turnScopeId: pendingStopPayload?.turnScopeId || currentRunMeta.turnScopeId || "",
          };
        }
        if (stopRequested && currentAbortController && !currentAbortController.signal?.aborted) {
          if (currentRunHandle) {
            currentRunHandle.stopRequested = true;
            currentRunHandle.stopPayload = currentStopPayload;
          }
          currentAbortController.abort({
            type: "user_stop",
            reason: "user stop action",
            stopPayload: currentStopPayload,
          });
        }
        if (stopRequested && currentStopPayload) {
          sendEvent("channel_state", {
            ...currentStopPayload,
            sessionId: currentStopPayload?.sessionId || currentRunMeta?.sessionId || "",
            dialogProcessId: currentStopPayload?.dialogProcessId || currentRunMeta?.dialogProcessId || "",
            turnScopeId: currentStopPayload?.turnScopeId || currentRunMeta?.turnScopeId || "",
            state: "stopping",
            sourceEvent: "stop_requested",
          });
        } else if (isContinueAction) {
          sendEvent("channel_state", {
            sessionId: currentRunMeta?.sessionId || "",
            turnScopeId: currentRunMeta?.turnScopeId || currentTurnScopeId || "",
            state: "sending",
            sourceEvent: "continue_started",
            resumeDialogProcessId: normalizedRunConfig?.resumeDialogProcessId || "",
            resumeTurnScopeId: normalizedRunConfig?.resumeTurnScopeId || "",
          });
        }

        const textStreamingEnabled = await resolveEffectiveStreamingEnabled({
          bot: activeBot,
          userId,
          runConfig: normalizedRunConfig,
        });
        const eventListener = {
          onEvent: (eventPayload) => {
            const eventName = eventPayload?.event || "thinking";
            const eventData = eventPayload?.data || {};
            const eventDialogProcessId = String(eventData?.dialogProcessId || "").trim();
            const childRunEvent = isChildRunEventData(eventData, {
              rootSessionId: sessionId,
            });
            const parentDialogProcessId =
              currentRunMeta?.dialogProcessId ||
              eventData?.parentDialogProcessId ||
              currentRunMeta?.parentDialogProcessId ||
              "";
            if (eventDialogProcessId && currentRunMeta && !childRunEvent) {
              currentRunMeta.dialogProcessId = eventDialogProcessId;
              if (currentRunHandle) {
                currentRunHandle.dialogProcessId = eventDialogProcessId;
                registerActiveRun(currentRunHandle);
              }
            }
            if (eventName === "llm_delta") {
              if (!textStreamingEnabled) {
                // Non-streaming mode: suppress token deltas, keep other system/tool events.
                return;
              }
              if (childRunEvent) {
                const parentOwnedData = parentOwnsChildRunEventData(eventData, {
                  rootSessionId: sessionId,
                  parentDialogProcessId,
                });
                const normalizedEvent = normalizeSseLogEvent({
                  ...eventPayload,
                  event: "subagent_llm_delta",
                  data: {
                    ...parentOwnedData,
                    category: "system",
                    type: "subagent_delta",
                    event: "subagent_delta",
                    text: String(parentOwnedData.text || ""),
                  },
                });
                sendEvent(
                  normalizedEvent.event,
                  buildParentOwnedChildRunPayload(normalizedEvent.data, parentOwnedData, {
                    rootSessionId: sessionId,
                    turnScopeId: currentRunMeta?.turnScopeId || currentTurnScopeId || "",
                  }),
                );
                return;
              }
              sendEvent("delta", {
                text: String(eventData.text || ""),
                dialogProcessId: String(eventData?.dialogProcessId || ""),
                sessionId: String(sessionId || ""),
                turnScopeId: eventData?.turnScopeId || currentRunMeta?.turnScopeId || currentTurnScopeId || "",
              });
              return;
            }
            if (
              eventName === "attachments_saved" ||
              eventName === "model_generated_attachments_saved"
            ) {
              const parentOwnedData = childRunEvent
                ? parentOwnsChildRunEventData(eventData, {
                    rootSessionId: sessionId,
                    parentDialogProcessId,
                  })
                : eventData;
              const attachments = Array.isArray(eventData?.attachments)
                ? eventData.attachments
                : [];
              sendEvent("attachments", {
                ...parentOwnedData,
                dialogProcessId: String(parentOwnedData?.dialogProcessId || ""),
                sessionId: String(sessionId || ""),
                turnScopeId: currentRunMeta?.turnScopeId || currentTurnScopeId || "",
                attachments,
              });
              return;
            }
            const normalizedEvent = normalizeSseLogEvent(
              childRunEvent
                ? {
                    ...eventPayload,
                    data: parentOwnsChildRunEventData(eventData, {
                      rootSessionId: sessionId,
                      parentDialogProcessId,
                    }),
                  }
                : eventPayload,
            );
            if (childRunEvent) {
              const parentOwnedData = parentOwnsChildRunEventData(eventData, {
                rootSessionId: sessionId,
                parentDialogProcessId,
              });
              sendEvent(
                normalizedEvent.event,
                buildParentOwnedChildRunPayload(normalizedEvent.data, parentOwnedData, {
                  rootSessionId: sessionId,
                  turnScopeId: currentRunMeta?.turnScopeId || currentTurnScopeId || "",
                }),
              );
              return;
            }
            sendEvent(normalizedEvent.event, normalizedEvent.data);
          },
        };

        const result = await activeBot.runSession({
          userId,
          sessionId,
          parentSessionId,
          parentDialogProcessId,
          caller: "user",
          message,
          attachments,
          eventListener,
          abortSignal: currentAbortSignal,
          userInteractionBridge,
          runConfig: normalizedRunConfig,
        });

        if (currentRunTimedOut && currentAbortSignal?.aborted) {
          sendEvent("error", {
            error: `run timeout after ${runTimeoutMs}ms`,
            sessionId: currentRunMeta?.sessionId || "",
            dialogProcessId: currentRunMeta?.dialogProcessId || "",
          });
          webSocket.close(1011, "timeout");
          return;
        }

        if (isUserStopRunAbort({ stopRequested, abortSignal: currentAbortSignal })) {
          const stopPayload = currentStopPayload || currentAbortSignal?.reason?.stopPayload || {};
          const stoppedMessage = stopPayload?.message || translateText("ws.dialogStoppedByUser", currentLocale);
          const stoppedPartialAssistant = buildStoppedPartialAssistant({
            stopPayload,
            runMeta: currentRunMeta,
            result,
            fallbackMessage: stoppedMessage,
          });
          try {
            await resolveBot()?.persistStoppedAssistantMessage?.({
              userId: currentRunMeta?.userId || "",
              sessionId: currentRunMeta?.sessionId || "",
              parentSessionId: currentRunMeta?.parentSessionId || "",
              parentDialogProcessId: currentRunMeta?.parentDialogProcessId || "",
              partialAssistant: stoppedPartialAssistant,
            });
          } catch (persistError) {
            void recordServiceWebSocketRuntimeError({
              sessionLogConfig,
              event: "service.websocket.persistStoppedAssistantMessage.failed",
              userId: currentRunMeta?.userId || "",
              sessionId: currentRunMeta?.sessionId || "",
              parentSessionId: currentRunMeta?.parentSessionId || "",
              dialogProcessId: currentRunMeta?.dialogProcessId || "",
              turnScopeId: currentRunMeta?.turnScopeId || currentTurnScopeId || "",
              error: persistError,
            });
          }
          sendEvent("user_stopped", {
            message: stoppedMessage,
            sessionId: stoppedPartialAssistant.sessionId || "",
            dialogProcessId: stoppedPartialAssistant.dialogProcessId || "",
            turnScopeId: stoppedPartialAssistant.turnScopeId || currentTurnScopeId || "",
          });
          webSocket.close(1000, "user_stopped");
          return;
        }

        sendEvent("done", {
          sessionId: result.sessionId,
          answer: result.answer,
          dialogProcessId: result.dialogProcessId || "",
          turnScopeId:
            currentStopPayload?.turnScopeId ||
            currentRunMeta?.turnScopeId ||
            currentTurnScopeId ||
            "",
          messages: result.messages || [],
          traces: result.traces || [],
          executionLogs: result.executionLogs || [],
        });
        webSocket.close(1000, "done");
      } catch (error) {
        if (currentAbortSignal?.aborted || isAbortLikeError(error)) {
          if (currentRunTimedOut) {
            sendEvent("error", {
              error: error?.message || "run timeout",
              sessionId: currentRunMeta?.sessionId || "",
              dialogProcessId: currentRunMeta?.dialogProcessId || "",
            });
            webSocket.close(1011, "timeout");
          } else if (isUserStopRunAbort({ stopRequested, abortSignal: currentAbortSignal })) {
            const stopPayload = currentStopPayload || currentAbortSignal?.reason?.stopPayload || {};
            const stoppedMessage = stopPayload?.message || translateText("ws.dialogStoppedByUser", currentLocale);
            const stoppedPartialAssistant = buildStoppedPartialAssistant({
              stopPayload,
              runMeta: currentRunMeta,
              fallbackMessage: stoppedMessage,
            });
            try {
              await resolveBot()?.persistStoppedAssistantMessage?.({
                userId: currentRunMeta?.userId || "",
                sessionId: currentRunMeta?.sessionId || "",
                parentSessionId: currentRunMeta?.parentSessionId || "",
                parentDialogProcessId: currentRunMeta?.parentDialogProcessId || "",
                partialAssistant: stoppedPartialAssistant,
              });
            } catch (persistError) {
              void recordServiceWebSocketRuntimeError({
                sessionLogConfig,
                event: "service.websocket.persistStoppedAssistantMessage.failed",
                userId: currentRunMeta?.userId || "",
                sessionId: currentRunMeta?.sessionId || "",
                parentSessionId: currentRunMeta?.parentSessionId || "",
                dialogProcessId: currentRunMeta?.dialogProcessId || "",
                turnScopeId: currentRunMeta?.turnScopeId || currentTurnScopeId || "",
                error: persistError,
              });
            }
            sendEvent("user_stopped", {
              message: stoppedMessage,
              sessionId: stoppedPartialAssistant.sessionId || "",
              dialogProcessId: stoppedPartialAssistant.dialogProcessId || "",
              turnScopeId: stoppedPartialAssistant.turnScopeId || currentTurnScopeId || "",
            });
            webSocket.close(1000, "user_stopped");
          } else {
            const errorMessage = buildAbortErrorMessage({
              error,
              abortSignal: currentAbortSignal,
              currentLocale,
              translateText,
            });
            void recordServiceWebSocketRuntimeError({
              sessionLogConfig,
              event: "service.websocket.run.aborted",
              userId: currentRunMeta?.userId || "",
              sessionId: currentRunMeta?.sessionId || "",
              parentSessionId: currentRunMeta?.parentSessionId || "",
              dialogProcessId: currentRunMeta?.dialogProcessId || "",
              turnScopeId: currentRunMeta?.turnScopeId || currentTurnScopeId || "",
              error,
              data: {
                abortReasonType:
                  currentAbortSignal?.reason && typeof currentAbortSignal.reason === "object"
                    ? String(currentAbortSignal.reason?.type || "").trim()
                    : "",
              },
            });
            sendEvent("error", {
              error: errorMessage,
              sessionId: currentRunMeta?.sessionId || "",
              dialogProcessId: currentRunMeta?.dialogProcessId || "",
            });
            webSocket.close(1011, "aborted");
          }
          return;
        }
        void recordServiceWebSocketRuntimeError({
          sessionLogConfig,
          event: "service.websocket.run.failed",
          userId: currentRunMeta?.userId || "",
          sessionId: currentRunMeta?.sessionId || "",
          parentSessionId: currentRunMeta?.parentSessionId || "",
          dialogProcessId: currentRunMeta?.dialogProcessId || "",
          turnScopeId: currentRunMeta?.turnScopeId || currentTurnScopeId || "",
          error,
        });
        sendEvent("error", {
          error: error.message || translateText("ws.unknownError", currentLocale),
          sessionId: currentRunMeta?.sessionId || "",
          dialogProcessId: currentRunMeta?.dialogProcessId || "",
        });
        webSocket.close(1011, "error");
      } finally {
        if (runMessageStarted) {
          if (currentRunTimeoutTimer) {
            clearTimeout(currentRunTimeoutTimer);
            currentRunTimeoutTimer = null;
          }
          isRunning = false;
          currentAbortController = null;
          currentAbortSignal = null;
          if (currentRunHandle) {
            unregisterActiveRun(currentRunHandle);
            currentRunHandle = null;
          }
          currentRunMeta = null;
          currentRunTimedOut = false;
          currentStopPayload = null;
          stopRequested = false;
          currentTurnScopeId = "";
        }
      }
    });

    webSocket.on("close", (code, reasonBuffer) => {
      if (currentAbortController) {
        const reasonText =
          typeof reasonBuffer === "string"
            ? reasonBuffer
            : Buffer.isBuffer(reasonBuffer)
              ? reasonBuffer.toString("utf8")
              : "";
        currentAbortController.abort({
          type: "socket_close",
          code: Number(code || 0) || undefined,
          reason: reasonText || "websocket closed",
        });
      }
      if (currentRunTimeoutTimer) {
        clearTimeout(currentRunTimeoutTimer);
        currentRunTimeoutTimer = null;
      }
      rejectAllPendingInteractions(new Error(translateText("ws.socketClosed", currentLocale)));
    });
  });

  return { webSocketServer };
}
