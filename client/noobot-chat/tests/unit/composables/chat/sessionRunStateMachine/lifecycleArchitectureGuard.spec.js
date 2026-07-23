/*
 * Copyright (c) 2026 xiayu
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "../../../../../");
const source = (relativePath) => readFileSync(resolve(projectRoot, relativePath), "utf8");

const files = {
  messageMeta: "src/composables/message/useMessageMeta.js",
  reducer: "src/composables/chat/sessionRunStateMachine/turnReducer.js",
  registry: "src/composables/chat/sessionRunStateMachine/turnRuntimeRegistry.js",
  interaction: "src/composables/chat/useAgentInteraction.js",
};

const agentRoot = resolve(projectRoot, "../../agent");

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
  const entries = readdirSync(resolve(projectRoot, relativeDir), { withFileTypes: true });
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
    expect(reducer).toMatch(/LOCAL_FRONTEND_COMPLETION_APPLIED/);
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
      source("src/composables/chat/chatList/detailMessages.js"),
      source("src/composables/chat/sessionRunStateMachine/messageRuntime.js"),
    ];
    for (const code of nonProtocolSources) {
      expect(code).not.toMatch(/(?:terminal|authority)\s*[:=]\s*["']completed["']/);
      expect(code).not.toMatch(/(?:terminal|authority)\s*[:=]\s*true/);
    }
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

  it("keeps interaction requests pending until websocket send returns successfully", () => {
    const code = source(files.interaction);
    const send = code.indexOf("sendJson({", code.indexOf("function submitInteractionResponse"));
    const handled = code.indexOf("markInteractionRequestHandled(request)", send);
    const cleared = code.indexOf("clearPendingInteraction(request)", send);
    const catchBlock = code.slice(code.indexOf("} catch (error) {", send), handled);
    expect(send).toBeGreaterThan(-1);
    expect(handled).toBeGreaterThan(send);
    expect(cleared).toBeGreaterThan(handled);
    expect(catchBlock).not.toMatch(/markInteractionRequestHandled|clearPendingInteraction/);
  });

  it("keeps the shared protocol, service entity, reducer and registry as the cross-layer lifecycle boundary", () => {
    const sharedProtocol = readFileSync(resolve(projectRoot, "../../shared/turn-lifecycle-protocol.mjs"), "utf8");
    const serviceEntity = readFileSync(resolve(agentRoot, "src/system-core/session/entities/turn-lifecycle-entity.js"), "utf8");
    const reducer = source(files.reducer);
    const registry = source(files.registry);
    for (const symbol of ["ACTION_ACCEPTED", "PROCESSING_STARTED", "PROCESSING_COMPLETED", "STOP_ACCEPTED", "STOP_PROCESSING_COMPLETED", "COMPLETED", "STOP_COMPLETED", "FAILED"]) {
      expect(sharedProtocol).toContain(symbol);
    }
    expect(sharedProtocol).not.toMatch(/\bCANCEL(?:LED)?\s*:/);
    expect(serviceEntity).toMatch(/finalizeIntent\?\.retryable\s*===\s*true/);
    expect(reducer).toMatch(/isFinalTurnState\(currentState, current\)/);
    expect(registry).toMatch(/reduceTurnRuntimeEvent\(current, rawEvent\)/);
  });
});
