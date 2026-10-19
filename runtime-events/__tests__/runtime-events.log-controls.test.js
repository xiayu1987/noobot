/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { RUNTIME_EVENT_SCOPES, writeRuntimeEvent } from "../src/index.js";

import {
  persistSession,
  readJsonl,
  tempRoot,
  useRuntimeEventsEnv,
} from "./runtime-events-test-fixtures.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

test("runtime-events writer drops debug session logs when their control is disabled", async () => {
  const root = await tempRoot();
  await persistSession(root, "admin", {
    sessionId: "session-debug-default",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  useRuntimeEventsEnv({ debug: { stateMachine: false } });
  const result = await writeRuntimeEvent({
    source: "frontend",
    scope: "session",
    category: "debug",
    level: "debug",
    event: "state.transition",
    userId: "admin",
    sessionId: "session-debug-default",
    debugType: "state-machine",
    data: {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});

test("runtime-events writer filters session logs by business log control", async () => {
  const root = await tempRoot();
  await persistSession(root, "admin", {
    sessionId: "session-category-filter",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  useRuntimeEventsEnv({ log: { message: false } });
  const skipped = await writeRuntimeEvent({
    source: "frontend",
    scope: "session",
    category: "message",
    level: "info",
    event: "chat.message",
    userId: "admin",
    sessionId: "session-category-filter",
  });
  useRuntimeEventsEnv({ log: { state: true, message: false } });
  const recorded = await writeRuntimeEvent({
    source: "frontend",
    scope: "session",
    category: "state",
    level: "info",
    event: "state.update",
    userId: "admin",
    sessionId: "session-category-filter",
  });

  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, true);
  assert.equal(recorded.ok, true);
  assert.equal((await readJsonl(recorded.file)).length, 1);
});

test("runtime-events writer separates debug session logs by debug type", async () => {
  const root = await tempRoot();
  await persistSession(root, "admin", {
    sessionId: "session-debug-files",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  useRuntimeEventsEnv({ debug: { stateMachine: true, resend: true } });
  const stateMachine = await writeRuntimeEvent({
    source: "frontend",
    scope: "session",
    category: "debug",
    level: "debug",
    event: "state.transition",
    userId: "admin",
    sessionId: "session-debug-files",
    debugType: "state-machine",
    data: {},
  });
  useRuntimeEventsEnv({ debug: { stateMachine: true, resend: true } });
  const resend = await writeRuntimeEvent({
    source: "frontend",
    scope: "session",
    category: "debug",
    level: "debug",
    event: "resend.tick",
    userId: "admin",
    sessionId: "session-debug-files",
    debugType: "resend",
    data: {},
  });

  assert.equal(stateMachine.ok, true);
  assert.equal(resend.ok, true);
  assert.match(stateMachine.file, /session-debug-files\/events\/debug-state-machine\.jsonl$/);
  assert.match(resend.file, /session-debug-files\/events\/debug-resend\.jsonl$/);
  assert.notEqual(stateMachine.file, resend.file);
  assert.equal((await readJsonl(stateMachine.file))[0].category, "debug");
  assert.equal((await readJsonl(resend.file))[0].category, "debug");
});

test("agent context debug logs default off and use their own file when enabled", async () => {
  const root = await tempRoot();
  await persistSession(root, "admin", {
    sessionId: "session-agent-context",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const event = {
    source: "agent",
    scope: "session",
    category: "debug",
    level: "debug",
    event: "agent.context.executionScopeCreated",
    userId: "admin",
    sessionId: "session-agent-context",
    debugType: "agent-context",
    data: { envelope: { protocolVersion: 1 } },
  };
  const skipped = await writeRuntimeEvent(event);
  assert.equal(skipped.skipped, true);

  useRuntimeEventsEnv({ debug: { agentContext: true } });
  const recorded = await writeRuntimeEvent(event);
  assert.equal(recorded.ok, true);
  assert.equal(recorded.skipped, undefined);
  assert.match(recorded.file, /session-agent-context\/events\/debug-agent-context\.jsonl$/);
});

test("agent context debug logs honor an explicit disabled control", async () => {
  const root = await tempRoot();
  await persistSession(root, "admin", {
    sessionId: "session-agent-context-disabled",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  useRuntimeEventsEnv({ debug: { agentContext: false } });
  const disabled = await writeRuntimeEvent({
    source: "agent",
    scope: "session",
    category: "debug",
    level: "debug",
    event: "agent.context.executionScopeCreated",
    userId: "admin",
    sessionId: "session-agent-context-disabled",
    debugType: "agent-context",
    data: {},
  });
  assert.equal(disabled.skipped, true);
});

test("runtime-events writer filters debug session logs by business debug control", async () => {
  const root = await tempRoot();
  await persistSession(root, "admin", {
    sessionId: "session-debug-type",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  useRuntimeEventsEnv({ debug: { resend: false } });
  const skipped = await writeRuntimeEvent({
    source: "frontend",
    scope: "session",
    category: "debug",
    level: "debug",
    event: "resend.tick",
    userId: "admin",
    sessionId: "session-debug-type",
    debugType: "resend",
    data: {},
  });
  useRuntimeEventsEnv({ debug: { stateMachine: true } });
  const recorded = await writeRuntimeEvent({
    source: "frontend",
    scope: "session",
    category: "debug",
    level: "debug",
    event: "state.transition",
    userId: "admin",
    sessionId: "session-debug-type",
    debugType: "state-machine",
    data: {},
  });

  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, true);
  assert.equal(recorded.ok, true);
  assert.match(recorded.file, /session-debug-type\/events\/debug-state-machine\.jsonl$/);
  assert.equal((await readJsonl(recorded.file)).length, 1);
});

test("runtime-events writer rejects unregistered debug types", async () => {
  const root = await tempRoot();
  await persistSession(root, "admin", {
    sessionId: "session-debug-unknown",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  await assert.rejects(
    writeRuntimeEvent({
      source: "frontend",
      scope: "session",
      category: "debug",
      level: "debug",
      event: "unknown.trace",
      userId: "admin",
      sessionId: "session-debug-unknown",
      debugType: "unknown-debug",
      data: {},
    }),
    /Invalid runtime event debugType: unknown-debug/,
  );
});

test("runtime-events writer never suppresses an error with a disabled debug control", async () => {
  const root = await tempRoot();
  await persistSession(root, "admin", {
    sessionId: "session-debug-error",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  useRuntimeEventsEnv({ debug: { contextIdentity: false } });
  const result = await writeRuntimeEvent({
    source: "agent",
    scope: "session",
    category: "debug",
    level: "error",
    event: "agent.contextIdentity.failed",
    userId: "admin",
    sessionId: "session-debug-error",
    debugType: "context-identity",
    data: { reason: "invalid identity" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, undefined);
  assert.match(result.file, /session-debug-error\/events\/debug-context-identity\.jsonl$/);
});

test("disabled debug logs are skipped before payload sanitization", async () => {
  const root = await tempRoot();
  await persistSession(root, "admin", {
    sessionId: "session-skip-before-sanitize",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  let payloadReads = 0;
  const data = {};
  Object.defineProperty(data, "chunk", {
    enumerable: true,
    get() {
      payloadReads += 1;
      return "delta";
    },
  });

  useRuntimeEventsEnv({ debug: { frontendStreamDelta: false } });
  const result = await writeRuntimeEvent({
    source: "service",
    scope: "session",
    category: "debug",
    level: "debug",
    event: "service.authorityOutbox.eventSent",
    userId: "admin",
    sessionId: "session-skip-before-sanitize",
    debugType: "stream-delta",
    data,
  });

  assert.equal(result.skipped, true);
  assert.equal(payloadReads, 0);
  assert.equal("data" in result.record, false);
});

test("system debug logs still honor their debug control", async () => {
  const root = await tempRoot();
  const event = {
    scope: RUNTIME_EVENT_SCOPES.SYSTEM,
    source: "frontend",
    category: "debug",
    level: "debug",
    event: "frontend.toolLogWindow.executionWindowSelected",
    userId: "admin",
    debugType: "tool-log-window",
    data: { candidateCount: 100 },
  };

  useRuntimeEventsEnv({ debug: { frontendToolLogWindow: false } });
  const skipped = await writeRuntimeEvent(event);

  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.record.scope, "system");

  useRuntimeEventsEnv({ debug: { frontendToolLogWindow: true } });
  const recorded = await writeRuntimeEvent(event);
  assert.equal(recorded.file.startsWith(`${root}${path.sep}`), true);
  assert.equal((await readJsonl(recorded.file)).length, 1);

  assert.equal(recorded.ok, true);
  assert.equal(recorded.skipped, undefined);
  assert.equal(recorded.record.scope, "system");
  assert.match(recorded.file, /system\/frontend\/debug\.jsonl$/);
  assert.equal((await readJsonl(recorded.file))[0].data.candidateCount, 100);
});

test("non-debug system runtime events are not governed by session log controls", async () => {
  await tempRoot();
  useRuntimeEventsEnv({ log: { system: false } });
  const result = await writeRuntimeEvent({
    scope: RUNTIME_EVENT_SCOPES.SYSTEM,
    source: "service",
    category: "system",
    level: "info",
    event: "service.runtime.ready",
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, undefined);
  assert.equal((await readJsonl(result.file))[0].event, "service.runtime.ready");
});
