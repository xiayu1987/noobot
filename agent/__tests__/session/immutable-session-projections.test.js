/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createSessionPersistenceScope } from "@noobot/session-protocol";
import { AGENT_SCOPED_SESSION_ROOTS } from "@noobot/workspace-protocol";
import { createTestSessionServices, provisionTestSession } from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";

const ts = "2026-01-01T00:00:00.000Z";

async function fixture(t) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "immutable-projections-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await initializeUserWorkspace(workspaceRoot, "u1");
  const runtime = createTestSessionServices({ workspaceRoot }, { now: () => ts });
  const repository = runtime.repositories.sessionRepository;
  await provisionTestSession(runtime, {
    userId: "u1",
    sessionId: "s1",
    caller: SESSION_CALLER.USER,
  });
  const persistenceContext = repository.treePersistenceContext("u1", "s1");
  const scope = await repository.requireSessionScope("u1", "s1", persistenceContext);
  const reader = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  const request = {
    persistenceContext,
    expectedGeneration: reader.generation,
    operationId: "rename",
    committedAt: ts,
    changes: { sessionMetadata: { customTitle: "committed title" } },
  };
  return { runtime, repository, persistenceContext, scope, request, workspaceRoot };
}

test("incremental commits and replay do not enumerate or project the session list", async (t) => {
  const { repository, request, persistenceContext } = await fixture(t);
  const list = t.mock.method(repository, "listSessionIds", () =>
    assert.fail("commit listed sessions"),
  );
  const project = t.mock.method(repository, "_buildSessionSummaryFromReader", () =>
    assert.fail("commit rebuilt list projection"),
  );
  await repository.commitChanges("u1", "s1", request);
  const committed = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  assert.equal((await committed.readMetadata()).customTitle, "committed title");
  await repository.commitChanges("u1", "s1", request);
  assert.equal(
    (await repository.requireSessionReader("u1", "s1", { persistenceContext })).generation,
    committed.generation,
  );
  list.mock.restore();
  project.mock.restore();
  assert.equal((await repository.readSessionsSummary("u1")).sessions[0].title, "committed title");
});

test("settings update is visible from the committed head without a second projection write", async (t) => {
  const { repository, persistenceContext, request } = await fixture(t);
  const project = t.mock.method(repository, "_buildSessionSummaryFromReader");
  await repository.updateSessionSettings("u1", "s1", {
    persistenceContext,
    settings: { customTitle: "settings title" },
  });
  assert.equal(project.mock.callCount(), 0);
  assert.equal((await repository.readSessionsSummary("u1")).sessions[0].title, "settings title");
  const reader = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  const next = { ...request, expectedGeneration: reader.generation };
  await repository.commitChanges("u1", "s1", next);
  const beforeReplay = project.mock.callCount();
  await repository.commitChanges("u1", "s1", next);
  assert.equal(project.mock.callCount(), beforeReplay);
});

test("list read turns asynchronous immutable metadata failure into an unavailable entry", async (t) => {
  const { repository } = await fixture(t);
  const fault = Object.assign(new Error("metadata read failed"), { code: "EIO" });
  const requireReader = repository.requireSessionReader.bind(repository);
  t.mock.method(repository, "requireSessionReader", async (...args) => ({
    ...(await requireReader(...args)),
    readMetadata: async () => {
      throw fault;
    },
  }));
  const rebuilt = await repository.readSessionsSummary("u1");
  assert.equal(rebuilt.sessions[0].availability, "unavailable");
  assert.deepEqual(rebuilt.sessions[0].unavailableReason, { code: "EIO", message: fault.message });
});

test("agent scope discovery reads head metadata and rejects a missing committed head", async (t) => {
  const { runtime, repository } = await fixture(t);
  const allowedRoot = AGENT_SCOPED_SESSION_ROOTS[0];
  const persistenceContext = runtime.createSessionPersistenceContext({
    userId: "u1",
    sessionId: "agent-one",
    persistenceScope: createSessionPersistenceScope({
      scopeId: "agent:agent-one",
      parentSessionId: "s1",
      allowedRoot,
      relativeDir: `${allowedRoot}/agent-one`,
    }),
  });
  await repository.ensureSession({
    userId: "u1",
    sessionId: "agent-one",
    parentSessionId: "s1",
    caller: SESSION_CALLER.BOT,
    persistenceContext,
  });
  const scope = await repository.requireSessionScope("u1", "agent-one", persistenceContext);
  await writeFile(scope.sessionFile, "invalid old manifest");
  const discovered = await repository.listAgentSessionScopes("u1");
  assert.equal(discovered.get("agent-one").parentSessionId, "s1");
  const reader = await repository.requireSessionReader("u1", "agent-one", {
    persistenceContext: discovered.get("agent-one").persistenceContext,
  });
  assert.equal((await reader.readMetadata()).parentSessionId, "s1");
  await cp(scope.sessionDir, path.join(path.dirname(scope.sessionDir), "wrong-identity"), {
    recursive: true,
  });
  await assert.rejects(repository.listAgentSessionScopes("u1"), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await rm(path.join(path.dirname(scope.sessionDir), "wrong-identity"), { recursive: true });
  await rm(path.join(scope.sessionDir, "head.json"));
  await assert.rejects(repository.listAgentSessionScopes("u1"));
});
