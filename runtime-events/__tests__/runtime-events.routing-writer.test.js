/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
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

test("session runtime event requires userId and sessionId", async () => {
  const result = await writeRuntimeEvent({
    scope: RUNTIME_EVENT_SCOPES.SESSION,
    source: "agent",
    category: "system",
    level: "error",
    event: "agent.session.missingContext",
  });

  assert.equal(result.ok, false);
  assert.match(result.error.message, /requires userId and sessionId/);
});

test("startup and system events write JSONL without session context", async () => {
  await tempRoot();
  const startup = await writeRuntimeEvent({
    scope: RUNTIME_EVENT_SCOPES.STARTUP,
    source: "service",
    category: "state",
    level: "info",
    event: "service.startup.listen.started",
    data: { port: 3000 },
  });
  const system = await writeRuntimeEvent({
    scope: RUNTIME_EVENT_SCOPES.SYSTEM,
    source: "agent",
    category: "transport",
    level: "warn",
    event: "agent.runtime.queue.timeout",
  });

  assert.equal(startup.ok, true);
  assert.equal(system.ok, true);
  assert.match(startup.file, /runtime\/events\/startup\/service\/state\.jsonl$/);
  assert.match(system.file, /runtime\/events\/system\/agent\/transport\.jsonl$/);
  assert.equal((await readJsonl(startup.file))[0].scope, "startup");
  assert.equal((await readJsonl(system.file))[0].scope, "system");
});

test("session runtime events write to runtime session events path", async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, "admin", {
    sessionId: "s_1",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const result = await writeRuntimeEvent({
    source: "agent",
    scope: "session",
    category: "system",
    level: "error",
    event: "agent.multimodal_parse.failed",
    userId: "admin",
    sessionId: "s_1",
    dialogProcessId: "dialog:1",
    turnScopeId: "client-turn:1",
  });

  assert.equal(result.ok, true);
  assert.match(result.file, /admin\/runtime\/session\/s_1\/events\/system\.jsonl$/);
  const [record] = await readJsonl(result.file);
  assert.equal(record.sessionId, "s_1");
  assert.equal(record.userId, "admin");
  assert.equal(record.dialogProcessId, "dialog:1");
  assert.equal(record.turnScopeId, "client-turn:1");
  assert.equal(result.record.workspaceRoot, undefined);
  assert.equal(record.workspaceRoot, undefined);
});

test("explicit session scope writes to the session events path", async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, "admin", {
    sessionId: "session_1",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  const result = await writeRuntimeEvent({
    scope: "session",
    source: "agent",
    category: "system",
    level: "warn",
    event: "agent.explicit.session",
    userId: "admin",
    sessionId: "session_1",
    data: { token: "secret", count: 1 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.record.scope, "session");
  assert.equal(result.record.sessionId, "session_1");
  assert.equal(result.record.data.token, "[Redacted]");
  assert.match(result.file, /admin\/runtime\/session\/session_1\/events\/system\.jsonl$/);
});

test("runtime events without a declared scope are rejected", async () => {
  await tempRoot();
  const result = await writeRuntimeEvent({
    source: "service",
    category: "config",
    level: "warn",
    event: "service.undeclared.scope",
    userId: "admin",
    sessionId: "session-1",
  });

  assert.equal(result.ok, false);
  assert.match(result.error.message, /Invalid runtime event scope: undefined/);
});

test("routed runtime events write under NOOBOT_WORKSPACE_ROOT and fail when it is missing", async () => {
  const previousWorkspaceRoot = process.env.NOOBOT_WORKSPACE_ROOT;
  const workspaceRoot = await tempRoot();
  const event = {
    source: "agent-proxy",
    scope: "startup",
    category: "state",
    level: "info",
    event: "agentProxy.default.startup",
  };
  try {
    const result = await writeRuntimeEvent(event);
    assert.equal(result.ok, true);
    assert.equal(result.record.workspaceRoot, undefined);
    assert.equal(result.file.startsWith(`${workspaceRoot}${path.sep}`), true);
    assert.match(result.file, /runtime\/events\/startup\/agent-proxy\/state\.jsonl$/);

    delete process.env.NOOBOT_WORKSPACE_ROOT;
    const missing = await writeRuntimeEvent(event);
    assert.equal(missing.ok, false);
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.NOOBOT_WORKSPACE_ROOT;
    else process.env.NOOBOT_WORKSPACE_ROOT = previousWorkspaceRoot;
  }
});

test("desktopRoot writes system events under the explicit desktop root", async () => {
  await tempRoot();
  const desktopRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-runtime-events-desktop-"));
  const result = await writeRuntimeEvent(
    {
      scope: "system",
      source: "service",
      category: "transport",
      level: "warn",
      event: "service.explicit.desktopRoot",
    },
    { desktopRoot },
  );

  assert.equal(result.ok, true);
  assert.equal(result.record.scope, "system");
  assert.equal(result.file, path.join(desktopRoot, "system", "service", "transport.jsonl"));
});

test("desktopRoot rejects session-scoped events", async () => {
  await tempRoot();
  const desktopRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-runtime-events-desktop-"));
  const result = await writeRuntimeEvent(
    {
      source: "service",
      scope: "session",
      userId: "admin",
      sessionId: "session-1",
      category: "system",
      event: "service.desktop.session",
    },
    { desktopRoot },
  );

  assert.equal(result.ok, false);
  assert.match(String(result.error?.message), /owned by the workspace/);
});

test("explicit session scope with partial session context is rejected", async () => {
  await tempRoot();
  const result = await writeRuntimeEvent({
    scope: "session",
    source: "service",
    category: "transport",
    level: "warn",
    event: "service.explicit.partialSession",
    sessionId: "session-only",
    dialogProcessId: "dialog-1",
  });

  assert.equal(result.ok, false);
  assert.match(result.error.message, /requires userId and sessionId/);
});

test("runtime event jsonl transport appends without rotating below max file bytes", async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, "admin", {
    sessionId: "rotation-1",
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  useRuntimeEventsEnv({ storage: { maxFileBytes: 1024 * 1024 } });
  const first = await writeRuntimeEvent({
    source: "agent",
    scope: "session",
    category: "system",
    level: "info",
    event: "agent.runtime.rotation.first",
    userId: "admin",
    sessionId: "rotation-1",
    data: { message: "small" },
  });
  useRuntimeEventsEnv({ storage: { maxFileBytes: 1024 * 1024 } });
  const second = await writeRuntimeEvent({
    source: "agent",
    scope: "session",
    category: "system",
    level: "info",
    event: "agent.runtime.rotation.second",
    userId: "admin",
    sessionId: "rotation-1",
    data: { message: "small" },
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.rotatedFile, null);
  const records = await readJsonl(second.file);
  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map((record) => record.event),
    ["agent.runtime.rotation.first", "agent.runtime.rotation.second"],
  );
});
