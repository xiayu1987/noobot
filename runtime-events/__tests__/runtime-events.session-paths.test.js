/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { writeRuntimeEvent } from "../src/index.js";

import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import {
  markSessionDeleted,
  pathExists,
  persistSession,
  readJsonl,
  tempRoot,
  useRuntimeEventsEnv,
} from "./runtime-events-test-fixtures.js";

test("workspace runtime events nest child session logs along the session tree", async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, "admin", "parent-session");
  const childDir = await persistSession(workspaceRoot, "admin", "child-session", "parent-session");
  const result = await writeRuntimeEvent({
    source: "agent",
    scope: "session",
    category: "system",
    event: "child.event",
    userId: "admin",
    sessionId: "child-session",
    parentSessionId: "parent-session",
  });

  assert.equal(result.ok, true);
  assert.equal(result.record.sessionId, "child-session");
  assert.equal(result.record.parentSessionId, "parent-session");
  assert.equal(result.file, path.join(childDir, "events", "system.jsonl"));
  assert.equal(
    childDir,
    path.join(
      workspaceRoot,
      "admin",
      WORKSPACE_LAYOUT.SESSION_DIR,
      "parent-session",
      "child-session",
    ),
  );
  assert.equal(
    await pathExists(
      path.join(workspaceRoot, "admin", WORKSPACE_LAYOUT.SESSION_DIR, "child-session"),
    ),
    false,
  );
});

test("grandchild session events nest under every ancestor", async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, "admin", "root");
  await persistSession(workspaceRoot, "admin", "child", "root");
  const leafDir = await persistSession(workspaceRoot, "admin", "leaf", "child");
  const result = await writeRuntimeEvent({
    source: "agent",
    scope: "session",
    category: "system",
    event: "leaf.event",
    userId: "admin",
    sessionId: "leaf",
  });
  assert.equal(result.ok, true);
  assert.equal(
    result.file,
    path.join(
      workspaceRoot,
      "admin",
      WORKSPACE_LAYOUT.SESSION_DIR,
      "root",
      "child",
      "leaf",
      "events",
      "system.jsonl",
    ),
  );
  assert.equal(path.dirname(path.dirname(result.file)), leafDir);
});

test("child events are refused while the child is not registered in the tree", async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, "admin", "parent-session");
  const result = await writeRuntimeEvent({
    source: "agent",
    scope: "session",
    category: "system",
    event: "child.event",
    userId: "admin",
    sessionId: "child-session",
    parentSessionId: "parent-session",
  });
  assert.equal(result.skipped, true);
  assert.equal(result.missingSession, true);
  const parentDir = path.join(
    workspaceRoot,
    "admin",
    WORKSPACE_LAYOUT.SESSION_DIR,
    "parent-session",
  );
  assert.equal(await pathExists(path.join(parentDir, "events")), false);
  assert.equal(await pathExists(path.join(parentDir, "child-session")), false);
});

test("child events are skipped when an ancestor is deleted", async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, "admin", "parent-session");
  const childDir = await persistSession(workspaceRoot, "admin", "child-session", "parent-session");
  await markSessionDeleted(workspaceRoot, "admin", "parent-session");
  const result = await writeRuntimeEvent({
    source: "agent",
    scope: "session",
    category: "system",
    event: "child.event",
    userId: "admin",
    sessionId: "child-session",
  });
  assert.equal(result.deleted, true);
  assert.equal(await pathExists(path.join(childDir, "events")), false);
});

test("an explicit parent that contradicts the tree is rejected", async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, "admin", "parent-session");
  await persistSession(workspaceRoot, "admin", "other-session");
  await persistSession(workspaceRoot, "admin", "child-session", "parent-session");
  const result = await writeRuntimeEvent({
    source: "agent",
    scope: "session",
    category: "system",
    event: "child.event",
    userId: "admin",
    sessionId: "child-session",
    parentSessionId: "other-session",
  });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /registered under "parent-session"/);
});

test("workspace runtime events ignore placeholder parent session ids", async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, "admin", "real-session");
  const result = await writeRuntimeEvent({
    source: "agent-proxy",
    scope: "session",
    category: "transport",
    event: "root.transport",
    userId: "admin",
    sessionId: "real-session",
    parentSessionId: "undefined",
    data: { parentSessionId: "NULL" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.record.parentSessionId, undefined);
  assert.match(result.file, /real-session\/events\/transport\.jsonl$/);
  assert.equal(
    await pathExists(path.join(workspaceRoot, "admin", WORKSPACE_LAYOUT.SESSION_DIR, "undefined")),
    false,
  );
});

test("placeholder parent session id cannot create an unpersisted session directory", async () => {
  const workspaceRoot = await tempRoot();
  const result = await writeRuntimeEvent({
    source: "agent-proxy",
    scope: "session",
    category: "transport",
    event: "draft.transport",
    userId: "admin",
    sessionId: "draft-session",
    parentSessionId: "undefined",
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.missingSession, true);
  assert.equal(
    await pathExists(path.join(workspaceRoot, "admin", WORKSPACE_LAYOUT.SESSION_DIR, "undefined")),
    false,
  );
  assert.equal(
    await pathExists(
      path.join(workspaceRoot, "admin", WORKSPACE_LAYOUT.SESSION_DIR, "draft-session"),
    ),
    false,
  );
});

test("workspace runtime events do not create an unpersisted session directory", async () => {
  const workspaceRoot = await tempRoot();
  const sessionDir = path.join(
    workspaceRoot,
    "admin",
    WORKSPACE_LAYOUT.SESSION_DIR,
    "draft-session",
  );
  useRuntimeEventsEnv({ debug: { workflowDiagnostics: true } });
  const result = await writeRuntimeEvent({
    source: "frontend",
    scope: "session",
    category: "debug",
    level: "debug",
    event: "frontend.workflowRender.draft",
    userId: "admin",
    sessionId: "draft-session",
    debugType: "workflow-diagnostics",
    data: {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.missingSession, true);
  assert.equal(await pathExists(sessionDir), false);
});

test("runtime event writer does not recreate a deleted session directory", async () => {
  const workspaceRoot = await tempRoot();
  const userId = "admin";
  const sessionId = "deleted-runtime-session";
  const { sessionDir } = await markSessionDeleted(workspaceRoot, userId, sessionId);
  const result = await writeRuntimeEvent({
    source: "frontend",
    scope: "session",
    category: "message",
    event: "late.event",
    userId,
    sessionId,
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.deleted, true);
  assert.equal(await pathExists(sessionDir), false);
});

test("runtime event writer does not recreate a deleted parent session for child logs", async () => {
  const workspaceRoot = await tempRoot();
  const userId = "admin";
  const parentSessionId = "deleted-parent-session";
  await markSessionDeleted(workspaceRoot, userId, parentSessionId);
  const sessionDir = path.join(
    workspaceRoot,
    userId,
    WORKSPACE_LAYOUT.SESSION_DIR,
    parentSessionId,
  );
  const result = await writeRuntimeEvent({
    source: "agent",
    scope: "session",
    category: "system",
    event: "late.child.event",
    userId,
    sessionId: "child-session",
    parentSessionId,
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.deleted, true);
  assert.equal(await pathExists(sessionDir), false);
});

test("runtime-events writer records normal session logs when their control is enabled", async () => {
  const root = await tempRoot();
  await persistSession(root, "admin", "session-log-default");
  useRuntimeEventsEnv({ log: { message: true } });
  const result = await writeRuntimeEvent({
    source: "frontend",
    scope: "session",
    category: "message",
    level: "info",
    event: "chat.message",
    userId: "admin",
    sessionId: "session-log-default",
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, undefined);
  assert.equal((await readJsonl(result.file)).length, 1);
});
