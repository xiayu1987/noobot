/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  RUNTIME_EVENTS_CONFIG_ENVS,
  RUNTIME_EVENTS_SESSION_LOG_DEBUG_TYPES,
} from "@noobot/shared/runtime-events-config";
import { writeRuntimeEvent } from "../src/index.js";
import {
  buildSessionLogRecord,
  getSessionLogControlKey,
  getSessionLogDebugControlKey,
  normalizeSessionLogCategory,
  resolveSessionLogClientPolicy,
  SESSION_LOG_CATEGORIES,
  SESSION_LOG_DEBUG_CATEGORY,
} from "../src/session-log-protocol.js";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import {
  pathExists,
  readJsonl,
  tempRoot,
  persistSession,
  useRuntimeEventsEnv,
} from "./runtime-events-test-fixtures.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

test("session log protocol exports stable categories and helpers from runtime-events", () => {
  assert.ok(SESSION_LOG_CATEGORIES.includes("system"));
  assert.ok(SESSION_LOG_CATEGORIES.includes(SESSION_LOG_DEBUG_CATEGORY));
  assert.ok(
    Object.keys(
      buildSessionLogRecord({
        scope: "session",
        source: "test",
        category: "state",
        event: "test.keys",
        sessionId: "s1",
      }),
    ).includes("sessionId"),
  );
  for (const category of [
    "frontend-lifecycle",
    "agent-proxy-http",
    "agent-proxy-websocket",
    "agent-proxy-route",
    "backend-websocket",
    "backend-lifecycle",
  ]) {
    assert.ok(SESSION_LOG_CATEGORIES.includes(category), `missing category: ${category}`);
    assert.equal(normalizeSessionLogCategory(category), category);
  }
  assert.throws(() => normalizeSessionLogCategory("missing"), /Invalid session log category/);
  assert.throws(() => normalizeSessionLogCategory(undefined), /Invalid session log category/);
  assert.equal(normalizeSessionLogCategory("DEBUG"), SESSION_LOG_DEBUG_CATEGORY);

  assert.equal(getSessionLogControlKey("message"), "message");
  assert.equal(getSessionLogControlKey(SESSION_LOG_DEBUG_CATEGORY), "");
  for (const category of SESSION_LOG_CATEGORIES) {
    assert.doesNotThrow(() => getSessionLogControlKey(category), `no control key: ${category}`);
  }
  assert.equal(getSessionLogDebugControlKey({ debugType: "state-machine" }), "stateMachine");
  assert.equal(
    getSessionLogDebugControlKey({ debugType: "stop-continue" }),
    "frontendStopContinue",
  );
  assert.equal(
    getSessionLogDebugControlKey({ debugType: "stop-continue" }),
    "frontendStopContinue",
  );
  assert.equal(
    getSessionLogDebugControlKey({ debugType: "terminal-resolution" }),
    "frontendTerminalResolution",
  );
  assert.equal(
    getSessionLogDebugControlKey({ debugType: "tool-log-window" }),
    "frontendToolLogWindow",
  );
  assert.equal(
    getSessionLogDebugControlKey({ debugType: "timeline-pipeline" }),
    "timelinePipeline",
  );
  assert.equal(
    getSessionLogDebugControlKey({ debugType: "transport-diagnostics" }),
    "frontendTransportDiagnostics",
  );
  assert.equal(getSessionLogDebugControlKey({ debugType: "agent-proxy-route" }), "agentProxyRoute");
  assert.equal(getSessionLogDebugControlKey({ debugType: "context-identity" }), "contextIdentity");
  assert.equal(getSessionLogDebugControlKey({ debugType: "agent-context" }), "agentContext");
  assert.equal(getSessionLogDebugControlKey({ debugType: "agent-transport" }), "agentTransport");

  const record = buildSessionLogRecord({
    scope: "session",
    source: "frontend",
    category: "message",
    event: "chat.message",
    sessionId: "session-1",
    turnScopeId: "turn-1",
    message: "hello",
    data: { turnScopeId: "turn-1" },
    time: "2026-10-01T00:00:00.000Z",
  });

  assert.deepEqual(record, {
    scope: "session",
    time: "2026-10-01T00:00:00.000Z",
    source: "frontend",
    category: "message",
    level: "info",
    event: "chat.message",
    sessionId: "session-1",
    dialogProcessId: "",
    turnScopeId: "turn-1",
    message: "hello",
    data: { turnScopeId: "turn-1" },
  });
  assert.equal(
    buildSessionLogRecord({
      scope: "session",
      source: "f",
      category: "state",
      event: "e",
      sessionId: "s",
      data: { turnScopeId: "t" },
    }).turnScopeId,
    "",
  );
});

test("session log client policy is derived from the shared debug registry", () => {
  const debugEnvs = RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.debug;
  const policy = resolveSessionLogClientPolicy({
    env: {
      [debugEnvs.workflowDiagnostics]: "true",
      [debugEnvs.frontendToolLogWindow]: "true",
      [debugEnvs.timelinePipeline]: "true",
    },
  });

  assert.equal(policy.debug["workflow-diagnostics"], true);
  assert.equal(policy.debug["tool-log-window"], true);
  assert.equal(policy.debug.resend, false);
  assert.equal(policy.debug.stop, false);
  assert.equal(policy.debug["agent-transport"], false);
  assert.equal(Object.hasOwn(policy.debug, "timeline-pipeline"), false);
  assert.equal(policy.debug["stream-delta"], false);
  assert.equal(policy.debug["transport-diagnostics"], false);
  assert.equal(Object.hasOwn(policy.debug, "model-context-trace"), false);
  assert.deepEqual(
    Object.keys(policy.debug).sort(),
    Object.entries(RUNTIME_EVENTS_SESSION_LOG_DEBUG_TYPES)
      .filter(([, descriptor]) => descriptor.exposeToClient === true)
      .map(([debugType]) => debugType)
      .sort(),
  );
  assert.equal(policy.limits.maxDebugQueue > 0, true);
  assert.equal(policy.limits.maxDebugBytes > 0, true);
  assert.equal(policy.limits.debugTtlMs > 0, true);
});

test("agent transport debug uses its own file and excludes business payloads", async () => {
  const root = await tempRoot();
  await persistSession(root, "admin", {
    sessionId: "session-transport",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  useRuntimeEventsEnv({ debug: { agentTransport: true } });
  const result = await writeRuntimeEvent({
    source: "frontend",
    scope: "session",
    category: "debug",
    level: "debug",
    debugType: "agent-transport",
    event: "frontend.agentTransport.commandSent",
    userId: "admin",
    sessionId: "session-transport",
    data: {
      debugType: "agent-transport",
      commandId: "command-1",
      commandType: "send",
      messageLength: 12,
      attachmentCount: 1,
    },
  });

  assert.equal(result.ok, true);
  assert.match(result.file, /session-transport\/events\/debug-agent-transport\.jsonl$/);
  const [record] = await readJsonl(result.file);
  assert.equal(record.data.commandId, "command-1");
  assert.equal(Object.hasOwn(record.data, "message"), false);
  assert.equal(Object.hasOwn(record.data, "attachments"), false);
});

test("tool log window debug uses its own file when enabled", async () => {
  assert.equal(
    RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.debug.frontendToolLogWindow,
    "NOOBOT_RUNTIME_EVENT_FRONTEND_TOOL_LOG_WINDOW_DEBUG",
  );
  const root = await tempRoot();
  await persistSession(root, "admin", {
    sessionId: "session-tool-window",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  useRuntimeEventsEnv({ debug: { frontendToolLogWindow: true } });
  const result = await writeRuntimeEvent({
    source: "frontend",
    scope: "session",
    category: "debug",
    level: "debug",
    event: "frontend.toolLogWindow.rendererReceived",
    userId: "admin",
    sessionId: "session-tool-window",
    debugType: "tool-log-window",
    data: { selectedCount: 10 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, undefined);
  assert.match(result.file, /session-tool-window\/events\/debug-tool-log-window\.jsonl$/);
  assert.equal((await readJsonl(result.file))[0].data.selectedCount, 10);
});

test("workflow diagnostics debug follows explicit disabled and enabled controls", async () => {
  assert.equal(
    RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.debug.workflowDiagnostics,
    "NOOBOT_RUNTIME_EVENT_WORKFLOW_DIAGNOSTICS_DEBUG",
  );
  const root = await tempRoot();
  await persistSession(root, "admin", {
    sessionId: "session-workflow",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const event = {
    source: "frontend",
    scope: "session",
    category: "debug",
    level: "debug",
    event: "frontend.workflowRender.cardMounted",
    userId: "admin",
    sessionId: "session-workflow",
    debugType: "workflow-diagnostics",
    data: { workflowRunId: "workflow-1" },
  };
  useRuntimeEventsEnv({ debug: { workflowDiagnostics: false } });
  const skipped = await writeRuntimeEvent(event);

  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, true);
  assert.equal(
    await pathExists(
      path.join(
        root,
        "admin",
        WORKSPACE_LAYOUT.SESSION_DIR,
        "session-workflow",
        "events",
        "debug-workflow-diagnostics.jsonl",
      ),
    ),
    false,
  );

  useRuntimeEventsEnv({ debug: { workflowDiagnostics: true } });
  const result = await writeRuntimeEvent(event);

  assert.equal(result.ok, true);
  assert.equal(result.skipped, undefined);
  assert.match(result.file, /session-workflow\/events\/debug-workflow-diagnostics\.jsonl$/);
  assert.equal((await readJsonl(result.file))[0].data.workflowRunId, "workflow-1");
});

test("session log record requires an explicit scope that matches its session ownership", () => {
  const base = { source: "frontend", category: "state", event: "chat.state" };
  assert.throws(
    () => buildSessionLogRecord({ ...base, sessionId: "s1" }),
    /Invalid session log scope/,
  );
  assert.throws(() => buildSessionLogRecord({ ...base, scope: "session" }), /requires sessionId/);
  assert.throws(
    () => buildSessionLogRecord({ ...base, scope: "system", sessionId: "s1" }),
    /must not carry sessionId/,
  );
  assert.throws(() => buildSessionLogRecord({ scope: "system", event: "e" }), /source is required/);
  assert.throws(() => buildSessionLogRecord({ scope: "system", source: "x" }), /event is required/);
  assert.equal(buildSessionLogRecord({ ...base, scope: "system" }).scope, "system");
});

test("session log record carries debug type only at top level", () => {
  const record = buildSessionLogRecord({
    scope: "session",
    source: "frontend",
    category: "debug",
    level: "debug",
    debugType: "stop-continue",
    event: "frontend.stopContinue.stopButtonEvaluated",
    sessionId: "session-1",
    data: { changed: true },
  });

  assert.equal(record.debugType, "stop-continue");
  assert.equal(record.data.debugType, undefined);
  assert.equal(getSessionLogDebugControlKey(record), "frontendStopContinue");
});

test("isSessionLogDebugTypeEnabled gates delivery-timing before collection", async () => {
  const { isSessionLogDebugTypeEnabled } = await import("../src/session-log-protocol.js");
  assert.equal(isSessionLogDebugTypeEnabled("delivery-timing", { env: {} }), false);
  assert.equal(
    isSessionLogDebugTypeEnabled("delivery-timing", {
      env: { NOOBOT_RUNTIME_EVENT_BACKEND_DELIVERY_TIMING_DEBUG: "true" },
    }),
    true,
  );
  assert.equal(isSessionLogDebugTypeEnabled("not-registered", { env: {} }), false);
});
