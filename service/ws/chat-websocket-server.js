/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";
import { normalizeSseLogEvent } from "../system-core/event/index.js";
import { decryptPayloadBySessionId } from "../system-core/utils/session-crypto.js";

function sendUpgradeError(socket, statusCode = 401, message = "Unauthorized") {
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
    resolveRequestLocale,
    resolveAuthByApiKey,
    isForbiddenUserScope,
    normalizeRunConfig,
    normalizeLocale,
    defaultLocale,
    translateText,
  } = {},
) {
  const webSocketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const requestLocale = resolveRequestLocale(request, defaultLocale);
    let requestPathname = "";
    try {
      requestPathname = new URL(request.url || "", "http://localhost").pathname;
    } catch {
      sendUpgradeError(socket, 400, translateText("ws.badRequest", requestLocale));
      return;
    }

    if (requestPathname !== "/chat/ws") {
      socket.destroy();
      return;
    }

    const authInfo = resolveAuthByApiKey(request);
    if (!authInfo) {
      sendUpgradeError(socket, 401, translateText("auth.missingApiKey", requestLocale));
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
    const pendingInteractionRequests = new Map();

    const sendEvent = (eventName, data = {}) => {
      if (webSocket.readyState !== 1) return;
      try {
        webSocket.send(JSON.stringify({ event: eventName, data }));
      } catch {
        // ignore socket send errors
      }
    };

    const rejectAllPendingInteractions = (error) => {
      for (const [, requestItem] of pendingInteractionRequests.entries()) {
        try {
          requestItem?.reject?.(error);
        } catch {
          // ignore reject failures
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
            requireEncryption: Boolean(requireEncryption),
            sessionId: String(sessionId || "").trim(),
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
            interactionData:
              interactionData && typeof interactionData === "object"
                ? interactionData
                : {},
          });
        }),
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
          let normalizedResponse = payload?.response ?? {};
          if (requestItem?.requireEncryption) {
            const encryptedPayload = normalizedResponse?.payload;
            const encryptedFlag = normalizedResponse?.encrypted === true;
            const sessionId = String(requestItem?.sessionId || "").trim();
            if (!encryptedFlag || !String(encryptedPayload || "").trim() || !sessionId) {
              throw new Error(translateText("ws.interactionEncryptedRequired", currentLocale));
            }
            normalizedResponse = decryptPayloadBySessionId(
              String(encryptedPayload || ""),
              sessionId,
            );
          }
          requestItem.resolve(normalizedResponse);
          return;
        }
        if (action === "stop") {
          if (isRunning && currentAbortController) {
            currentAbortController.abort();
          }
          rejectAllPendingInteractions(new Error(translateText("ws.dialogStoppedByUser", currentLocale)));
          sendEvent("stopped", { message: translateText("ws.dialogStoppedByUser", currentLocale) });
          webSocket.close(1000, "stopped");
          return;
        }
        if (isRunning) {
          sendEvent("error", { error: translateText("ws.sessionAlreadyRunning", currentLocale) });
          return;
        }
        isRunning = true;
        currentAbortController = new AbortController();
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

        const eventListener = {
          onEvent: (eventPayload) => {
            const eventName = eventPayload?.event || "thinking";
            const eventData = eventPayload?.data || {};
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
                sendEvent(normalizedEvent.event, normalizedEvent.data);
                return;
              }
              sendEvent("delta", { text: String(eventData.text || "") });
              return;
            }
            const normalizedEvent = normalizeSseLogEvent(eventPayload);
            sendEvent(normalizedEvent.event, normalizedEvent.data);
          },
        };

        const result = await bot.runSession({
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
          runConfig: normalizeRunConfig(config),
        });

        if (abortSignal?.aborted) {
          sendEvent("stopped", { message: translateText("ws.dialogStoppedByUser", currentLocale) });
          webSocket.close(1000, "stopped");
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
          sendEvent("stopped", { message: translateText("ws.dialogStoppedByUser", currentLocale) });
          webSocket.close(1000, "stopped");
          return;
        }
        sendEvent("error", { error: error.message || translateText("ws.unknownError", currentLocale) });
        webSocket.close(1011, "error");
      } finally {
        isRunning = false;
        currentAbortController = null;
      }
    });

    webSocket.on("close", () => {
      if (currentAbortController) {
        currentAbortController.abort();
      }
      rejectAllPendingInteractions(new Error(translateText("ws.socketClosed", currentLocale)));
    });
  });
}
