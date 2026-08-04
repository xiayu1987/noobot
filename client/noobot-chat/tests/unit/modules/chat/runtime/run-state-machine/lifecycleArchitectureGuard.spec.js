/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { clientFilePath } from "@noobot/client-shared/path-resolver";
import { TURN_EVENT } from "@noobot/event-protocol";

const projectRoot = clientFilePath.resolve(import.meta.dirname, "../../../../../../");
const source = (relativePath) => readFileSync(clientFilePath.resolve(projectRoot, relativePath), "utf8");

const files = {
  messageMeta: "src/modules/chat/composables/message/useMessageMeta.js",
  reducer: "src/modules/chat/runtime/run-state-machine/turnReducer.js",
  registry: "src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js",
  interaction: "src/modules/chat/composables/useAgentInteraction.js",
  messageList: "src/modules/chat/components/navigation/ChatMessageListPanel.vue",
  sendFinalize: "src/modules/chat/runtime/engine/sendFinalize.js",
  webSocketClient: "src/infrastructure/websocket/chatWebSocketClient.js",
};

const protocolWriters = new Set([
  files.reducer,
  files.registry,
]);

const lifecycleTerminalLiterals = [
  "completed",
  "user_stopped",
  "error",
  "cancelled",
  "frontend_completed",
  "frontend_user_stop_completed",
  "frontend_action_request_error",
  "frontend_processing_error",
  "frontend_completion_error",
  "frontend_stop_error",
];

const forbiddenTurnWritePatterns = [
  /\b(?:turn|runtime|current)\.(?:state|terminal|authority)\s*=/,
  /\b(?:turn|runtime|current)\[["'](?:state|terminal|authority)["']\]\s*=/,
  new RegExp(`\\b(?:state|terminal|authority)\\s*:\\s*["'](?:${lifecycleTerminalLiterals.join("|")})["']`),
];

function productionFiles(relativeDir = "src") {
  const entries = readdirSync(clientFilePath.resolve(projectRoot, relativeDir), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) return productionFiles(relativePath);
    return /\.(?:js|vue)$/.test(entry.name) ? [relativePath] : [];
  });
}

function lifecycleBypasses(code) {
  return forbiddenTurnWritePatterns.filter((pattern) => pattern.test(code));
}

describe("lifecycle architecture guard", () => {
  it("does not derive completed from persisted message status in the display layer", () => {
    const code = source(files.messageMeta);
    expect(code).not.toMatch(/persistedStatusStepState\s*===?\s*["']completed["']/);
    expect(code).not.toMatch(/persistedState\s*===?\s*["']completed["']/);
  });

  it("keeps all Turn transitions in the protocol reducer and registry event flow", () => {
    const reducer = source(files.reducer);
    const registry = source(files.registry);
    expect(reducer).toMatch(/TERMINAL_RESOLVED/);
    expect(reducer).toMatch(/FINAL_STATES\.has\(nextState\)/);
    expect(reducer).not.toMatch(/LOCAL_FRONTEND_COMPLETION_APPLIED/);
    expect(reducer).not.toMatch(/LOCAL_USER_STOP_SUMMARY_APPLIED/);
    expect(reducer).toMatch(/FRONTEND_COMPLETED/);
    expect(reducer).toMatch(/ACTION_REQUEST_ERROR/);
    expect(reducer).toMatch(/PROCESSING_ERROR/);
    expect(reducer).toMatch(/USER_STOP_COMPLETED/);
    expect(reducer).toMatch(/STOP_ERROR/);
    expect(reducer).toMatch(/CANCELLED/);
    expect(registry).toMatch(/applyTurnRuntimeEvent/);
    expect(registry).toMatch(/reduceTurnRuntimeEvent/);
    expect(registry).not.toMatch(/persistedStatusStepState\s*===?\s*["']completed["']/);
  });

  it("does not allow production code outside protocol writers to mutate Turn lifecycle fields", () => {
    const violations = productionFiles()
      .filter((relativePath) => !protocolWriters.has(relativePath))
      .flatMap((relativePath) => lifecycleBypasses(source(relativePath)).map((pattern) => ({
        relativePath,
        pattern: String(pattern),
      })));
    expect(violations).toEqual([]);
  });

  it("does not permit UI/message fields to write Turn terminal authority", () => {
    const nonProtocolSources = [
      source(files.messageMeta),
      source("src/modules/session/model/list/detailMessages.js"),
      source("src/modules/chat/runtime/run-state-machine/messageRuntime.js"),
    ];
    for (const code of nonProtocolSources) {
      expect(code).not.toMatch(/(?:terminal|authority)\s*[:=]\s*["']completed["']/);
      expect(code).not.toMatch(/(?:terminal|authority)\s*[:=]\s*true/);
    }
  });

  it("keeps the message list as a Registry consumer without a message-state writeback loop", () => {
    const code = source(files.messageList);
    expect(code).not.toContain("resolveSessionRunMessageRuntimePatch");
    expect(code).not.toContain("applyConversationStateRuntimeToMessages");
    expect(code).not.toMatch(/watchEffect\([\s\S]*turnStatuses/);
  });

  it("rejects representative bypass patterns", () => {
    const forbidden = [
      'const state = message.persistedStatusStepState === "completed" ? "completed" : "completing";',
      'return { terminal: "completed" };',
      'return { authority: true };',
      'turn.state = "frontend_action_requesting";',
      'runtime.terminal = "user_stopped";',
      'turn.terminal = "error";',
      'runtime.state = "cancelled";',
      'current.authority = "frontend_stop_error";',
    ];
    const guards = [
      /persistedStatusStepState\s*===?\s*["']completed["']/,
      /(?:terminal|authority)\s*[:=]\s*["']completed["']|(?:terminal|authority)\s*[:=]\s*true/,
    ];
    expect(forbidden[0]).toMatch(guards[0]);
    for (const sample of forbidden.slice(1)) {
      expect(sample).toSatisfy((code) => code.match(guards[1]) || lifecycleBypasses(code).length > 0);
    }
  });

  it("allows reducer invocation only through the registry production gateway", () => {
    const callers = productionFiles().filter((relativePath) =>
      relativePath !== files.reducer && source(relativePath).includes("reduceTurnRuntimeEvent"));
    expect(callers).toEqual([files.registry]);
  });

  it("forbids legacy timeline, log compatibility, and thinking transport projection", () => {
    const renderConsumers = [
      "src/app/composables/useThinkingDetailsPanel.js",
      "src/modules/chat/model/thinkingDetailModel.js",
      "src/modules/chat/composables/message/useMessageFiles.js",
      "src/modules/chat/composables/message/useMessageMeta.js",
      "src/modules/chat/composables/useThinkingPanel.js",
      "src/modules/chat/components/message/SharedChatMessageItem.vue",
      "src/modules/chat/components/message/ChatMessageItem.vue",
      "src/modules/chat/components/thinking/ThinkingPanel.vue",
    ];
    for (const relativePath of renderConsumers) {
      expect(source(relativePath)).not.toMatch(/messageItem\?*\.completedToolLogs/);
      expect(source(relativePath)).not.toMatch(/adaptLegacyMessageTimelines|pluginLogCompatibility/);
      expect(source(relativePath)).not.toContain("turnStatuses");
      expect(source(relativePath)).not.toContain("turnTimingsByTurnScopeId");
    }
    expect(productionFiles().some((relativePath) =>
      relativePath.endsWith("legacyTimelineAdapter.js") ||
      relativePath.endsWith("pluginLogCompatibility.js"))).toBe(false);
    expect(source("src/modules/chat/runtime/engine/streamHandlers.js"))
      .not.toMatch(/handleThinkingStreamEvent|legacy-stream:|buildToolTimelineFromLegacyLogs/);
    const legacyPatterns = [
      /adaptLegacyMessageTimelines|legacyTimelineAdapter|pluginLogCompatibility|MESSAGE_LOG_COMPATIBILITY/,
      /handleThinkingStreamEvent|legacy-stream:|buildToolTimelineFromLegacyLogs/,
      /buildActivityTimelineFromLegacyLogs|fillMissingToolTimelineFacets/,
      /TOOL_TIMELINE_AUTHORITY\.COMPATIBILITY|SEQUENCE_DOMAIN\.(?:LEGACY|TRANSPORT)/,
      /normalizeSseLogEvent|StreamEventEnum\.THINKING/,
      /hydrateSessionTurnRuntime|legacy_runtime_projection_disabled/,
      /(?:message|messageItem)\?*\.(?:realtimeLogs|completedToolLogs|processRealtimeLogs|processCompletedToolLogs)/,
    ];
    const violations = productionFiles().flatMap((relativePath) =>
      legacyPatterns
        .filter((pattern) => pattern.test(source(relativePath)))
        .map((pattern) => ({ relativePath, pattern: String(pattern) })),
    );
    expect(violations).toEqual([]);
  });

  it("keeps interaction requests pending until websocket send returns successfully", () => {
    const code = source(files.interaction);
    const send = code.indexOf("sendJson(createInteractionResponseCommand({", code.indexOf("function submitInteractionResponse"));
    const handled = code.indexOf("markInteractionRequestHandled(request)", send);
    const cleared = code.indexOf("clearPendingInteraction(request)", send);
    const catchBlock = code.slice(code.indexOf("} catch (error) {", send), handled);
    expect(send).toBeGreaterThan(-1);
    expect(handled).toBeGreaterThan(send);
    expect(cleared).toBeGreaterThan(handled);
    expect(catchBlock).not.toMatch(/markInteractionRequestHandled|clearPendingInteraction/);
  });

  it("keeps the authority contracts, domain reducer and client projections as the lifecycle boundary", () => {
    const reducer = source(files.reducer);
    const registry = source(files.registry);
    for (const eventType of ["ACTION_ACCEPTED", "PROCESSING_STARTED", "PROCESSING_COMPLETED", "STOP_ACCEPTED", "STOP_PROCESSING_COMPLETED", "COMPLETED", "STOP_COMPLETED", "FAILED"]) {
      expect(TURN_EVENT[eventType]).toBeTruthy();
    }
    expect(TURN_EVENT).not.toHaveProperty("CANCELLED");
    expect(reducer).toMatch(/isFinalTurnState\(currentState, current\)/);
    expect(registry).toMatch(/reduceTurnRuntimeEvent\(current, rawEvent\)/);
  });

  it("keeps transport and local commands out of authoritative lifecycle projection", () => {
    const reducer = source(files.reducer);
    const registry = source(files.registry);
    const evaluation = source("src/modules/chat/runtime/run-state-machine/evaluation.js");
    expect(reducer).not.toContain("current.lifecycleObserved !== true");
    expect(reducer).not.toMatch(/backendState\s*===\s*BackendChannelState\.SENDING\)\s*return\s+FrontendRunState\.PROCESSING/);
    expect(reducer).not.toMatch(/normalizedBackendState[\s\S]*canStop/);
    expect(reducer).toContain("commandPending");
    expect(reducer).toContain("transportState");
    expect(registry).not.toMatch(/deriveTurnCapabilities\([^)]*backendState/);
    expect(evaluation).not.toContain("deriveTurnCapabilities");
    expect(evaluation).toContain("stateSnapshot?.canStop === true");
  });

  it("keeps stop lifecycle ownership out of the websocket transport", () => {
    const transport = source(files.webSocketClient);
    const finalize = source(files.sendFinalize);
    for (const legacyOwner of [
      "activeStopLease",
      "stopConfirmationTimer",
      "isStopRequested",
      "getStopRequestedTurnScopeId",
      "clearStopRequested",
    ]) {
      expect(transport).not.toContain(legacyOwner);
      expect(finalize).not.toContain(legacyOwner);
    }
    expect(source(files.reducer)).not.toContain("actionCommandId");
    expect(source(files.reducer)).toContain("lifecycleEventType");
  });
});
