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
import { normalizeRuntimeEvent, writeRuntimeEvent } from "../src/index.js";
import {
  buildSessionLogRecord,
  getSessionLogControlKey,
  getSessionLogDebugControlKey,
  normalizeSessionLogCategory,
  resolveSessionLogClientPolicy,
  SESSION_LOG_AGENT_PROXY_DEFAULT_CATEGORY,
  SESSION_LOG_CATEGORIES,
  SESSION_LOG_DEBUG_CATEGORY,
  SESSION_LOG_DEFAULT_CATEGORY,
} from "../src/session-log-protocol.js";
import { pathExists, readJsonl, tempRoot } from "./runtime-events-test-fixtures.js";

test("session log protocol exports stable categories and helpers from runtime-events", () => {
  assert.ok(SESSION_LOG_CATEGORIES.includes("system"));
  assert.ok(SESSION_LOG_CATEGORIES.includes(SESSION_LOG_DEBUG_CATEGORY));
  assert.ok(Object.keys(buildSessionLogRecord({ sessionId: "s1" })).includes("sessionId"));
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
  assert.equal(normalizeSessionLogCategory("missing"), SESSION_LOG_DEFAULT_CATEGORY);
  assert.equal(normalizeSessionLogCategory("DEBUG"), SESSION_LOG_DEBUG_CATEGORY);
  // 守卫：会话日志分类必须全部被 runtime schema 接受，否则整批日志会被拒收。
  for (const category of [...SESSION_LOG_CATEGORIES, SESSION_LOG_AGENT_PROXY_DEFAULT_CATEGORY]) {
    const debugType = category === SESSION_LOG_DEBUG_CATEGORY ? "state-machine" : undefined;
    assert.doesNotThrow(
      () => normalizeRuntimeEvent({ source: "test", event: "test.category", category, debugType }),
      `schema rejects session log category: ${category}`,
    );
  }
  assert.throws(
    () => normalizeRuntimeEvent({ source: "test", event: "test.debug", category: SESSION_LOG_DEBUG_CATEGORY }),
    /Invalid runtime event debugType/,
  );
  assert.throws(
    () =>
      normalizeRuntimeEvent({
        source: "test",
        event: "test.debugType",
        category: "system",
        debugType: "state-machine",
      }),
    /debugType is only allowed for category debug: system/,
  );
  assert.throws(
    () => normalizeRuntimeEvent({ source: "test", event: "test.level", category: "system", level: "debug" }),
    /level debug requires category debug, got: system/,
  );
  assert.equal(getSessionLogControlKey({ category: "message" }, "message"), "message");
  assert.equal(
    getSessionLogDebugControlKey({ debugType: "state-machine" }),
    "stateMachine",
  );
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
  assert.equal(
    getSessionLogDebugControlKey({ debugType: "agent-proxy-route" }),
    "agentProxyRoute",
  );
  assert.equal(
    getSessionLogDebugControlKey({ debugType: "context-identity" }),
    "contextIdentity",
  );
  assert.equal(
    getSessionLogDebugControlKey({ debugType: "agent-context" }),
    "agentContext",
  );
  assert.equal(
    getSessionLogDebugControlKey({ debugType: "agent-transport" }),
    "agentTransport",
  );

  const record = buildSessionLogRecord(
    {
      source: "frontend",
      category: "message",
      event: "chat.message",
      sessionId: "session-1",
      message: "hello",
      data: { turnScopeId: "turn-1" },
    },
    { includeTimestamp: false },
  );

  assert.deepEqual(record, {
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
});

test("session log client policy is derived from the shared debug registry", () => {
  const policy = resolveSessionLogClientPolicy({
    sessionLogControls: {
      debug: {
        workflowDiagnostics: true,
        frontendToolLogWindow: true,
        timelinePipeline: true,
      },
    },
  });

  assert.equal(policy.debug["workflow-diagnostics"], true);
  assert.equal(policy.debug["tool-log-window"], true);
  assert.equal(policy.debug.resend, false);
  assert.equal(policy.debug.stop, false);
  assert.equal(policy.debug["agent-transport"], true);
  assert.equal(Object.hasOwn(policy.debug, "timeline-pipeline"), false);
  assert.equal(policy.debug["stream-delta"], true);
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
  const result = await writeRuntimeEvent(
    {
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
    },
    {
      root,
      includeProcess: false,
      sessionLogControls: { debug: { agentTransport: true } },
    },
  );

  assert.equal(result.ok, true);
  assert.match(result.file, /session-transport\/debug-agent-transport\.jsonl$/);
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
  const result = await writeRuntimeEvent(
    {
      source: "frontend",
      scope: "session",
      category: "debug",
      level: "debug",
      event: "frontend.toolLogWindow.rendererReceived",
      userId: "admin",
      sessionId: "session-tool-window",
      debugType: "tool-log-window",
      data: { selectedCount: 10 },
    },
    { root, includeProcess: false, sessionLogControls: { debug: { frontendToolLogWindow: true } } },
  );

  assert.equal(result.ok, true);
  assert.equal(result.skipped, undefined);
  assert.match(result.file, /session-tool-window\/debug-tool-log-window\.jsonl$/);
  assert.equal((await readJsonl(result.file))[0].data.selectedCount, 10);
});

test("workflow diagnostics debug follows explicit disabled and enabled controls", async () => {
  assert.equal(
    RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.debug.workflowDiagnostics,
    "NOOBOT_RUNTIME_EVENT_WORKFLOW_DIAGNOSTICS_DEBUG",
  );
  const root = await tempRoot();
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
  const skipped = await writeRuntimeEvent(event, {
    root,
    includeProcess: false,
    sessionLogControls: { debug: { workflowDiagnostics: false } },
  });

  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, true);
  assert.equal(
    await pathExists(path.join(root, "session-workflow", "debug-workflow-diagnostics.jsonl")),
    false,
  );

  const result = await writeRuntimeEvent(event, {
    root,
    includeProcess: false,
    sessionLogControls: { debug: { workflowDiagnostics: true } },
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, undefined);
  assert.match(result.file, /session-workflow\/debug-workflow-diagnostics\.jsonl$/);
  assert.equal((await readJsonl(result.file))[0].data.workflowRunId, "workflow-1");
});

test("session log record carries debug type only at top level", () => {
  const record = buildSessionLogRecord(
    {
      source: "frontend",
      category: "debug",
      level: "debug",
      debugType: "stop-continue",
      event: "frontend.stopContinue.stopButtonEvaluated",
      sessionId: "session-1",
      data: { changed: true },
    },
    { includeTimestamp: false },
  );

  assert.equal(record.debugType, "stop-continue");
  assert.equal(record.data.debugType, undefined);
  assert.equal(getSessionLogDebugControlKey(record), "frontendStopContinue");
});

test("normalizeRuntimeEvent builds a sanitized structured record", () => {
  const record = normalizeRuntimeEvent(
    {
      source: "service",
      scope: "system",
      category: "security",
      level: "warn",
      event: "service.auth.failed",
      data: { token: "secret", reason: "bad-token" },
      error: new Error("boom"),
    },
    { includeProcess: false },
  );

  assert.equal(record.version, 1);
  assert.equal(record.source, "service");
  assert.equal(record.scope, "system");
  assert.equal(record.data.token, "[Redacted]");
  assert.equal(record.data.reason, "bad-token");
  assert.equal(record.error.name, "Error");
});
