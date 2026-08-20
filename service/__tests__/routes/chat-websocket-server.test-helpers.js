/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import net from "node:net";
import fs from "node:fs/promises";
import { WebSocket } from "ws";
import { registerChatWebSocketServer } from "../../ws/chat-websocket-server.js";
import { commitTurnLifecycle } from "@noobot/authoritative-state/application";
import {
  acknowledgeAuthorityEventDelivery,
  createEventEnvelope,
  listPendingAuthorityEvents,
  normalizeAuthorityEventOutbox,
  recordAuthorityEventDeliveryAttempt,
  validateProtocolEvent,
} from "@noobot/event-protocol";
import {
  AGENT_COMMAND,
  EXECUTION_QUERY_COMMAND_TYPES,
  createExecutionQueryCommand,
  createInteractionResponseCommand,
  createTurnFinalizeCommand,
  createTurnRunCommand,
  createTurnSnapshotCommand,
  createTurnStopCommand,
} from "@noobot/agent-transport-protocol";
import {
  createTurnTerminalStatus,
  materializeTurnTerminalMessages,
} from "@noobot/session-protocol";
import { createChatRunService } from "../../services/chat-run-service.js";

export function createProtocolTestCommand(payload = {}) {
  if (Number(payload?.protocolVersion) === 1) return payload;
  const action = String(payload?.action || "")
    .trim()
    .toLowerCase();
  const commandType = String(payload?.commandType || "")
    .trim()
    .toLowerCase();
  const config = payload?.config && typeof payload.config === "object" ? payload.config : {};
  const turnScopeId = String(payload?.turnScopeId || config?.turnScopeId || "test-turn").trim();
  const identity = {
    sessionId: String(payload?.sessionId || "s1").trim(),
    parentSessionId: String(payload?.parentSessionId || "").trim(),
    dialogProcessId: String(
      payload?.dialogProcessId || payload?.partialAssistant?.dialogProcessId || "",
    ).trim(),
    parentDialogProcessId: String(payload?.parentDialogProcessId || "").trim(),
    turnScopeId: String(turnScopeId || payload?.partialAssistant?.turnScopeId || "").trim(),
  };
  const resolvedCommandId = String(payload?.commandId || turnScopeId).trim();
  if (action === "stop") {
    return createTurnStopCommand({
      commandId: resolvedCommandId || `stop:${turnScopeId}`,
      identity,
      concurrency: { expectedTurnRevision: payload?.expectedRevision ?? 1 },
      stop: { executionId: payload?.executionId, partialAssistant: payload?.partialAssistant },
    });
  }
  if (action === "interaction_response") {
    return createInteractionResponseCommand({
      commandId: resolvedCommandId || `interaction:${payload?.requestId}`,
      identity,
      interaction: { requestId: payload?.requestId, response: payload?.response },
    });
  }
  if (EXECUTION_QUERY_COMMAND_TYPES.includes(commandType)) {
    return createExecutionQueryCommand({
      commandType,
      commandId: resolvedCommandId,
      identity,
      query: { executionId: payload?.executionId, rootExecutionId: payload?.rootExecutionId },
    });
  }
  if (commandType === AGENT_COMMAND.TURN_SNAPSHOT_GET) {
    return createTurnSnapshotCommand({
      commandId: resolvedCommandId,
      identity,
      options: { knownSequence: payload?.knownSequence, terminalLimit: payload?.terminalLimit },
    });
  }
  if (commandType === AGENT_COMMAND.FINALIZE) {
    return createTurnFinalizeCommand({
      commandId: resolvedCommandId,
      identity,
      options: { terminalLimit: payload?.terminalLimit },
    });
  }
  const resolvedRunCommandType = [
    AGENT_COMMAND.SEND,
    AGENT_COMMAND.CONTINUE,
    AGENT_COMMAND.RESEND,
  ].includes(commandType)
    ? commandType
    : action === "continue" || action === "resume"
      ? AGENT_COMMAND.CONTINUE
      : AGENT_COMMAND.SEND;
  return createTurnRunCommand({
    commandType: resolvedRunCommandType,
    commandId: resolvedCommandId,
    identity,
    session: { createIfAbsent: payload?.createIfAbsent === true },
    input: { message: payload?.message || "test message", attachments: payload?.attachments || [] },
    preferences: {
      allowUserInteraction: config.allowUserInteraction,
      sanitizeOutput: config.sanitizeOutput,
      ...(Object.prototype.hasOwnProperty.call(config, "streaming")
        ? { streaming: config.streaming }
        : {}),
      confirmationLevel: config.safeConfirmLevel,
      locale: config.locale,
      scenario: config.scenario,
      selectedModel: config.selectedModel,
      memoryModel: config.memoryModel,
      pluginModelConfig: config.pluginModelConfig,
      selectedConnectorIds: config.selectedConnectorIds,
      selectedPlugins: config.selectedPlugins,
    },
    presentation: {
      userMessageId: payload?.userMessageId || config.userMessageId,
      assistantMessageId: payload?.presentationMessageId || config.presentationMessageId,
    },
    concurrency: {
      expectedTurnRevision: payload?.expectedTurnRevision ?? 0,
      expectedAggregateVersion:
        payload?.expectedAggregateVersion ?? config.expectedAggregateVersion ?? 0,
    },
    continuation: {
      dialogProcessId: config.resumeDialogProcessId,
      turnScopeId: config.resumeTurnScopeId,
    },
  });
}

export async function startServerWithWs({
  runSession = async () => ({}),
  bot = null,
  initialTurnLifecycle = {},
  sessionLogConfig = undefined,
  resolveAuthByApiKey = () => ({ userId: "primary-user" }),
  isForbiddenUserScope = () => false,
} = {}) {
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end("not-found");
  });

  const suppliedBot = bot || { runSession };
  let turnLifecycle = structuredClone(initialTurnLifecycle);
  let authorityEventOutbox = [];
  let authorityEventSequence = 0;
  const terminalSummaryVersions = new Map();
  const testBot = {
    ...suppliedBot,
    session: {
      ...(suppliedBot.session || {}),
      getRootSessionSelectedConnectorIds:
        suppliedBot.session?.getRootSessionSelectedConnectorIds || (async () => []),
    },
    resolveExecutionIntent:
      suppliedBot.resolveExecutionIntent ||
      (async ({ turnScopeId = "", runConfig = {} } = {}) => {
        const executionId = String(runConfig?.executionId || `agent:${turnScopeId}`).trim();
        return {
          executionId,
          executionKind: String(runConfig?.executionKind || "agent").trim(),
          parentExecutionId: String(runConfig?.parentExecutionId || "").trim(),
          rootExecutionId: String(runConfig?.rootExecutionId || executionId).trim(),
          origin: {},
          stage: "",
        };
      }),
    applyTurnLifecycleEvent:
      suppliedBot.applyTurnLifecycleEvent ||
      (async (event = {}) => {
        const result = commitTurnLifecycle({
          lifecycle: turnLifecycle,
          event,
          eventOutbox: authorityEventOutbox,
          createEventId: () => `test-authority-event-${++authorityEventSequence}`,
          materializeTerminal: event.terminalStatus
            ? ({ terminalStatus, previousSummaryVersion }) => {
                if (typeof suppliedBot.materializeTerminalMessages === "function") {
                  return suppliedBot.materializeTerminalMessages({
                    event,
                    terminalStatus,
                    previousSummaryVersion,
                  });
                }
                assert.ok(
                  terminalStatus,
                  `unexpected terminal command: ${event.terminalStatus?.command}`,
                );
                const materialization = materializeTurnTerminalMessages({
                  messages: [],
                  terminalStatus,
                  previousSummaryVersion:
                    terminalSummaryVersions.get(event.turnScopeId) || previousSummaryVersion,
                });
                if (materialization.materialized) {
                  terminalSummaryVersions.set(event.turnScopeId, materialization.summaryVersion);
                }
                return materialization;
              }
            : undefined,
        });
        if (result.applied) {
          turnLifecycle = result.lifecycle;
          authorityEventOutbox = result.eventOutbox;
        }
        return result;
      }),
    getPendingAuthorityEvents:
      suppliedBot.getPendingAuthorityEvents ||
      (async () => ({
        found: true,
        events: listPendingAuthorityEvents(authorityEventOutbox),
      })),
    recordAuthorityEventAttempt:
      suppliedBot.recordAuthorityEventAttempt ||
      (async ({ eventId } = {}) => {
        const result = recordAuthorityEventDeliveryAttempt(authorityEventOutbox, { eventId });
        if (result.found) authorityEventOutbox = result.outbox;
        return { recorded: result.found };
      }),
    acknowledgeAuthorityEvent:
      suppliedBot.acknowledgeAuthorityEvent ||
      (async ({ eventId, consumerId, orderingDomain, orderingScopeId, sequence } = {}) => {
        const result = acknowledgeAuthorityEventDelivery(authorityEventOutbox, {
          eventId,
          consumerId,
          orderingDomain,
          orderingScopeId,
          sequence,
          deliveredAt: new Date().toISOString(),
        });
        if (result.found) authorityEventOutbox = result.outbox;
        return { acknowledged: result.found };
      }),
    commitTestAuthorityEvent: async ({
      family,
      identity,
      causality,
      ordering,
      producer,
      payload,
    } = {}) => {
      const sequence = Math.max(1, Number(ordering?.sequence) || ++authorityEventSequence);
      const envelope = createEventEnvelope({
        family,
        schemaVersion: 1,
        identity: {
          ...identity,
          eventId: String(identity?.eventId || `test-authority-event-${authorityEventSequence}`),
        },
        causality,
        ordering: { ...ordering, sequence },
        producer,
        occurredAt: new Date().toISOString(),
        payload,
      });
      const validation = validateProtocolEvent(envelope);
      if (!validation.valid) {
        throw new TypeError(`invalid test authority event: ${validation.errors.join(",")}`);
      }
      authorityEventOutbox = normalizeAuthorityEventOutbox([
        ...authorityEventOutbox,
        { eventId: envelope.identity.eventId, envelope, committedAt: envelope.occurredAt },
      ]);
      return envelope;
    },
  };
  const { mapAgentRunCommand } = createChatRunService({
    getBot: () => testBot,
    normalizeLocale: (locale = "") => String(locale || "zh-CN"),
    defaultLocale: "zh-CN",
    translateText: (key = "") => String(key || ""),
  });
  if (typeof suppliedBot.applyTurnLifecycleEvent !== "function") {
    testBot.runSession = async (payload = {}) => {
      payload?.eventListener?.onEvent?.({
        event: "agent_lifecycle_state_changed",
        data: {
          state: "running",
          sessionId: String(payload?.sessionId || ""),
          turnScopeId: String(payload?.runConfig?.turnScopeId || ""),
        },
      });
      return suppliedBot.runSession(payload);
    };
  }
  const registered = registerChatWebSocketServer(server, {
    getBot: () => testBot,
    resolveRequestLocale: () => "zh-CN",
    resolveAuthByApiKey,
    mapAgentRunCommand,
    normalizeLocale: (locale = "") => String(locale || "zh-CN"),
    defaultLocale: "zh-CN",
    translateText: (key = "") => String(key || ""),
    sessionLogConfig,
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    bot: testBot,
    registered,
    address: (...args) => server.address(...args),
  };
}

export async function readJsonl(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function waitForFile(filePath, { timeoutMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await fs.access(filePath);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError;
}

export async function waitForCondition(
  predicate,
  { timeoutMs = 1000, intervalMs = 5, message = "condition wait timed out" } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(message);
}

export async function closeServer(serverHandle) {
  const server = serverHandle?.server || serverHandle;
  const registered = serverHandle?.registered || null;
  const webSocketServer = registered?.webSocketServer || null;
  for (const client of webSocketServer?.clients || []) {
    client.terminate?.();
  }
  if (webSocketServer && typeof webSocketServer.close === "function") {
    await new Promise((resolve) => {
      try {
        webSocketServer.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }
  if (!server?.listening) return;
  await new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

export async function callChatWs({ port, payload = {}, timeoutMs = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/ws`, {
      headers: { authorization: "Bearer test-key" },
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("chat websocket response timeout"));
    }, timeoutMs);
    const settle = (callback, value) => {
      clearTimeout(timer);
      callback(value);
    };
    ws.on("open", () => ws.send(JSON.stringify(createProtocolTestCommand(payload))));
    ws.on("message", (raw) => {
      try {
        messages.push(JSON.parse(String(raw || "{}")));
      } catch (error) {
        ws.terminate();
        settle(reject, error);
      }
    });
    ws.on("close", () => settle(resolve, messages));
    ws.on("error", (error) => settle(reject, error));
  });
}

export async function stopChatWs({ port, payload = {}, stopPayload = {}, timeoutMs = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const messages = [];
    let stopSent = false;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/ws`, {
      headers: { authorization: "Bearer test-key" },
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("chat websocket stop timeout"));
    }, timeoutMs);
    const settle = (callback, value) => {
      clearTimeout(timer);
      callback(value);
    };
    ws.on("open", () => {
      ws.send(JSON.stringify(createProtocolTestCommand(payload)));
    });
    ws.on("message", (raw) => {
      try {
        const parsed = JSON.parse(String(raw || "{}"));
        messages.push(parsed);
        if (
          !stopSent &&
          parsed?.event === "turn_lifecycle" &&
          parsed?.data?.payload?.capabilities?.canStop === true
        ) {
          stopSent = true;
          ws.send(
            JSON.stringify(
              createProtocolTestCommand({
                action: "stop",
                sessionId: stopPayload.sessionId || payload.sessionId,
                turnScopeId: stopPayload.turnScopeId || payload.turnScopeId,
                expectedRevision: stopPayload.expectedRevision ?? parsed.data.ordering.revision,
                ...stopPayload,
              }),
            ),
          );
        }
      } catch (error) {
        ws.terminate();
        settle(reject, error);
      }
    });
    ws.on("close", () => settle(resolve, messages));
    ws.on("error", (error) => settle(reject, error));
  });
}

export async function requestRawUpgrade({ port, pathName = "/chat/ws" } = {}) {
  return new Promise((resolve, reject) => {
    let response = "";
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(
        [
          `GET ${pathName} HTTP/1.1`,
          "Host: 127.0.0.1",
          "Connection: Upgrade",
          "Upgrade: websocket",
          "Sec-WebSocket-Version: 13",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "Authorization: Bearer test-key",
          "",
          "",
        ].join("\r\n"),
      );
    });
    socket.setTimeout(1000, () => {
      socket.destroy(new Error("raw upgrade response timeout"));
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.on("end", () => resolve(response));
    socket.on("close", () => resolve(response));
    socket.on("error", reject);
  });
}
