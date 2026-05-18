/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";
import { normalizeSseLogEvent } from "#agent/event";
import { mergeConfig } from "#agent/config";
import { logError } from "#agent/tracking";
import { HTTP_STATUS } from "#agent/constants";

const DEFAULT_RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const MIN_RUN_TIMEOUT_MS = 10000;
const MAX_RUN_TIMEOUT_MS = 12 * 60 * 60 * 1000;

function resolveRunTimeoutMs(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RUN_TIMEOUT_MS;
  return Math.min(MAX_RUN_TIMEOUT_MS, Math.max(MIN_RUN_TIMEOUT_MS, Math.floor(parsed)));
}

function resolveConfigRunTimeoutMs(config = {}) {
  return config?.runTimeoutMs ?? config?.run_timeout_ms;
}

async function resolveEffectiveRunTimeoutMs({ bot, userId = "", runConfig = {} } = {}) {
  const normalizedUserId = String(userId || "").trim();
  const runConfigTimeoutMs = resolveConfigRunTimeoutMs(runConfig);
  if (runConfigTimeoutMs !== undefined && runConfigTimeoutMs !== null) {
    return resolveRunTimeoutMs(runConfigTimeoutMs);
  }

  const globalConfig =
    bot?.globalConfig && typeof bot.globalConfig === "object" ? bot.globalConfig : {};
  if (!normalizedUserId || typeof bot?.loadUserConfig !== "function") {
    return resolveRunTimeoutMs(resolveConfigRunTimeoutMs(globalConfig));
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
    logError("[ws][chat-websocket-server] load user config failed when resolving timeout", {
      userId: normalizedUserId,
      error: error?.message || String(error),
    });
    userConfig = {};
  }
  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  return resolveRunTimeoutMs(resolveConfigRunTimeoutMs(effectiveConfig));
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
      logError("[ws][chat-websocket-server] invalid websocket upgrade url", {
        url: String(request?.url || ""),
        error: error?.message || String(error),
      });
      sendUpgradeError(
        socket,
        HTTP_STATUS.BAD_REQUEST,
        translateText("ws.badRequest", requestLocale),
      );
      return;
    }

    if (requestPathname !== "/chat/ws") {
      socket.destroy();
      return;
    }

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
      };
      try {
        webSocket.send(JSON.stringify({ event: eventName, data: enrichedData }));
      } catch (error) {
        logError("[ws][chat-websocket-server] websocket send event failed", {
          eventName: String(eventName || ""),
          dialogProcessId: enrichedData.dialogProcessId,
          sessionId: enrichedData.sessionId,
          error: error?.message || String(error),
        });
      }
    };

    const rejectAllPendingInteractions = (error) => {
      for (const [, requestItem] of pendingInteractionRequests.entries()) {
        try {
          requestItem?.reject?.(error);
        } catch (rejectError) {
          logError("[ws][chat-websocket-server] reject pending interaction failed", {
            error: rejectError?.message || String(rejectError),
          });
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
      let abortSignal = null;
      try {
        const payload = JSON.parse(String(rawMessage || "{}"));
        const action = String(payload?.action || "").trim().toLowerCase();
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
          if (isRunning && currentAbortController) {
            currentAbortController.abort({ type: "user_stop", reason: "user stop action" });
          }
          rejectAllPendingInteractions(new Error(translateText("ws.dialogStoppedByUser", currentLocale)));
          try {
            await resolveBot()?.persistStoppedAssistantMessage?.({
              userId: currentRunMeta?.userId || "",
              sessionId: currentRunMeta?.sessionId || "",
              parentSessionId: currentRunMeta?.parentSessionId || "",
              parentDialogProcessId: currentRunMeta?.parentDialogProcessId || "",
              partialAssistant: payload?.partialAssistant || {},
            });
          } catch (error) {
            logError("[ws][chat-websocket-server] persist stopped assistant message failed", {
              userId: currentRunMeta?.userId || "",
              sessionId: currentRunMeta?.sessionId || "",
              error: error?.message || String(error),
            });
          }
          sendEvent("stopped", {
            message: translateText("ws.dialogStoppedByUser", currentLocale),
            sessionId: currentRunMeta?.sessionId || "",
            dialogProcessId:
              String(payload?.partialAssistant?.dialogProcessId || "").trim() ||
              currentRunMeta?.dialogProcessId ||
              "",
          });
          webSocket.close(1000, "stopped");
          return;
        }
        if (isRunning) {
          sendEvent("error", { error: translateText("ws.sessionAlreadyRunning", currentLocale) });
          return;
        }
        isRunning = true;
        currentAbortController = new AbortController();
        currentRunTimedOut = false;
        abortSignal = currentAbortController.signal;

        const {
          userId,
          sessionId,
          parentSessionId = "",
          parentDialogProcessId = "",
          message,
          attachments = [],
          config = {},
        } = payload || {};
        currentLocale = normalizeLocale(config?.locale || currentLocale);

        if (!userId || !sessionId || !message) {
          throw new Error(translateText("common.userSessionMessageRequired", currentLocale));
        }
        if (isForbiddenUserScope(authInfo, userId)) {
          throw new Error(translateText("auth.forbiddenUserScope", currentLocale));
        }
        const normalizedRunConfig = normalizeRunConfig(config);
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
        };

        const eventListener = {
          onEvent: (eventPayload) => {
            const eventName = eventPayload?.event || "thinking";
            const eventData = eventPayload?.data || {};
            const eventDialogProcessId = String(eventData?.dialogProcessId || "").trim();
            if (eventDialogProcessId && currentRunMeta) {
              currentRunMeta.dialogProcessId = eventDialogProcessId;
            }
            if (eventName === "llm_delta") {
              const currentEventSessionId = String(eventData?.sessionId || "").trim();
              const currentSubAgentSessionId = String(
                eventData?.subAgentSessionId || "",
              ).trim();
              const rootSessionId = String(sessionId || "").trim();
              const isSubTaskDelta =
                eventData?.subAgentCall ||
                (currentSubAgentSessionId &&
                  currentSubAgentSessionId !== rootSessionId) ||
                (currentEventSessionId &&
                  currentEventSessionId !== rootSessionId);
              if (isSubTaskDelta) {
                const normalizedEvent = normalizeSseLogEvent({
                  ...eventPayload,
                  event: "subagent_llm_delta",
                  data: {
                    ...eventData,
                    category: "system",
                    type: "subagent_delta",
                    event: "subagent_delta",
                    text: String(eventData.text || ""),
                  },
                });
                sendEvent(normalizedEvent.event, {
                  ...normalizedEvent.data,
                  dialogProcessId: String(eventData?.dialogProcessId || ""),
                  sessionId: String(sessionId || ""),
                });
                return;
              }
              sendEvent("delta", { text: String(eventData.text || ""), dialogProcessId: String(eventData?.dialogProcessId || ""), sessionId: String(sessionId || "") });
              return;
            }
            const normalizedEvent = normalizeSseLogEvent(eventPayload);
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
          abortSignal,
          userInteractionBridge,
          runConfig: normalizedRunConfig,
        });

        if (abortSignal?.aborted) {
          if (currentRunTimedOut) {
            sendEvent("error", { error: `run timeout after ${runTimeoutMs}ms` });
            webSocket.close(1011, "timeout");
          } else {
            sendEvent("stopped", { message: translateText("ws.dialogStoppedByUser", currentLocale) });
            webSocket.close(1000, "stopped");
          }
          return;
        }

        sendEvent("done", {
          sessionId: result.sessionId,
          answer: result.answer,
          dialogProcessId: result.dialogProcessId || "",
          messages: result.messages || [],
          traces: result.traces || [],
          executionLogs: result.executionLogs || [],
        });
        webSocket.close(1000, "done");
      } catch (error) {
        if (abortSignal?.aborted) {
          if (currentRunTimedOut) {
            sendEvent("error", { error: error?.message || "run timeout" });
            webSocket.close(1011, "timeout");
          } else {
            sendEvent("stopped", { message: translateText("ws.dialogStoppedByUser", currentLocale) });
            webSocket.close(1000, "stopped");
          }
          return;
        }
        logError("[ws][chat-websocket-server] websocket run failed", {
          userId: currentRunMeta?.userId || "",
          sessionId: currentRunMeta?.sessionId || "",
          parentSessionId: currentRunMeta?.parentSessionId || "",
          dialogProcessId: currentRunMeta?.dialogProcessId || "",
          error: error?.message || String(error),
        });
        sendEvent("error", { error: error.message || translateText("ws.unknownError", currentLocale) });
        webSocket.close(1011, "error");
      } finally {
        if (currentRunTimeoutTimer) {
          clearTimeout(currentRunTimeoutTimer);
          currentRunTimeoutTimer = null;
        }
        isRunning = false;
        currentAbortController = null;
        currentRunMeta = null;
        currentRunTimedOut = false;
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
}
