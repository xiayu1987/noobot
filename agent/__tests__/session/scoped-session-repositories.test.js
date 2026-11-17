/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import {
  buildExecutionReport,
  EXECUTION_REPORT_PROTOCOL,
  EXECUTION_REPORT_VERSION,
} from "@noobot/session-protocol/execution-report";
import { createSessionPersistenceScope } from "@noobot/session-protocol";
import { resolveSessionArtifactMutationLock } from "../../src/session/session-artifact-files.js";
import { summarizeExecutionLogs } from "../../src/observability/execution-log/execution-log-summary.js";
import { createSessionFacade } from "../../src/session/index.js";
import { SessionTurnPersister } from "../../src/bot/execution/turn-persister.js";
import { readExecutionLogs } from "../../src/session/session-artifact-store.js";
import { provisionTestSession, testWallClock } from "../helpers/session-services.js";
import { useRuntimeEventsEnv } from "../helpers/runtime-events-env.js";
import { buildHarness, readJson } from "./scoped-session-repositories.fixtures.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createEmptySessionTree } from "@noobot/workspace-protocol/session-tree";

const SCOPED_ROOT = "runtime/plugin-data/workflow/session";

function scopedAccess(runtime, { sessionId, parentSessionId, node }) {
  const persistenceScope = createSessionPersistenceScope({
    scopeId: `agent:${sessionId}`,
    parentSessionId,
    allowedRoot: SCOPED_ROOT,
    relativeDir: `${SCOPED_ROOT}/${node}`,
  });
  const persistenceContext = runtime.createSessionPersistenceContext({
    userId: "alice",
    sessionId,
    persistenceScope,
  });
  return {
    persistenceScope,
    persistenceContext,
    locate: () =>
      runtime.repositories.sessionRepository.requireSessionScope(
        "alice",
        sessionId,
        persistenceContext,
      ),
  };
}

function ensureScopedSession(runtime, { sessionId, parentSessionId, persistenceContext }) {
  return runtime.repositories.sessionRepository.ensureSession({
    userId: "alice",
    sessionId,
    parentSessionId,
    caller: SESSION_CALLER.BOT,
    persistenceContext,
  });
}

test("scoped repositories keep all artifacts and metadata in their execution directory without default leakage", async () => {
  const harness = buildHarness();
  const { root, runtime, sessionRepo, executionRepo } = await harness.setup();
  try {
    const access = scopedAccess(runtime, {
      sessionId: "child-a",
      parentSessionId: "parent-a",
      node: "run-a/node-a",
    });
    const options = { persistenceContext: access.persistenceContext };
    await ensureScopedSession(runtime, {
      sessionId: "child-a",
      parentSessionId: "parent-a",
      persistenceContext: access.persistenceContext,
    });
    await sessionRepo.writeSessionMetadata(
      "alice",
      "child-a",
      { plugin: "workflow-test", sessionId: "child-a" },
      options,
    );
    await executionRepo.appendLog(
      "alice",
      "child-a",
      { type: "event", value: 1, dialogProcessId: "dp-a" },
      options,
    );

    const scope = await access.locate();
    assert.equal(scope.sessionDir, path.join(root, `alice/${SCOPED_ROOT}/run-a/node-a`));
    assert.equal(scope.resolvedParentSessionId, "parent-a");
    const scopedSnapshot = await createSessionFacade(runtime).readScopedSessionSnapshot({
      sessionDir: scope.sessionDir,
    });
    assert.equal(await sessionRepo.storageService.exists(scope.metadataFile), false);
    assert.deepEqual(scopedSnapshot.meta, {
      plugin: "workflow-test",
      sessionId: "child-a",
    });
    const reader = await sessionRepo.requireSessionReader("alice", "child-a", options);
    assert.equal((await reader.readMetadata()).parentSessionId, "parent-a");
    const headFile = path.join(scope.sessionDir, "head.json");
    const headBefore = await readFile(headFile);
    const summary = await sessionRepo.readSessionDisplaySummary("alice", "child-a", options);
    assert.deepEqual(
      await sessionRepo.readSessionDisplaySummary("alice", "child-a", options),
      summary,
    );
    assert.equal(await sessionRepo.storageService.exists(scope.sessionSummaryFile), false);
    assert.deepEqual(await readFile(headFile), headBefore);
    const facade = createSessionFacade(runtime);
    const snapshotRequest = { sessionDir: scope.sessionDir };
    const snapshot = await facade.readScopedSessionSnapshot(snapshotRequest);
    const corruptCache = "{invalid-summary-json";
    await writeFile(scope.sessionSummaryFile, corruptCache);
    assert.deepEqual(await facade.readScopedSessionSnapshot(snapshotRequest), snapshot);
    assert.equal(await readFile(scope.sessionSummaryFile, "utf8"), corruptCache);
    await rm(scope.sessionSummaryFile);
    assert.deepEqual(await facade.readScopedSessionSnapshot(snapshotRequest), snapshot);
    assert.equal(await sessionRepo.storageService.exists(scope.sessionSummaryFile), false);
    assert.deepEqual(await readFile(headFile), headBefore);
    assert.equal(await sessionRepo.storageService.exists(scope.sessionFile), false);
    assert.equal(
      (
        await readExecutionLogs({
          storageService: sessionRepo.storageService,
          sessionDir: scope.sessionDir,
        })
      )[0].value,
      1,
    );

    const defaultRoot = path.join(root, "alice/runtime/session");
    const { storageService } = sessionRepo;
    for (const file of ["child-a/session.json", "sessions.json", ".deleted-sessions.json"]) {
      assert.equal(await storageService.exists(path.join(defaultRoot, file)), false, file);
    }
    assert.deepEqual(
      await readJson(path.join(defaultRoot, "session-tree.json")),
      createEmptySessionTree(),
    );
    assert.equal(
      await storageService.exists(resolveSessionArtifactMutationLock(scope.sessionDir)),
      false,
    );
  } finally {
    await harness.cleanup();
  }
});

test("session facade execution reads do not create a default shadow session for scoped workflows", async () => {
  const harness = buildHarness();
  const { root, runtime, sessionRepo } = await harness.setup();
  try {
    const access = scopedAccess(runtime, {
      sessionId: "child-facade",
      parentSessionId: "parent-facade",
      node: "run-facade/node-facade",
    });
    const session = createSessionFacade(runtime);
    const payload = {
      userId: "alice",
      sessionId: "child-facade",
      dialogProcessId: "dp-facade",
      persistenceScope: access.persistenceScope,
    };
    await ensureScopedSession(runtime, {
      sessionId: "child-facade",
      parentSessionId: "parent-facade",
      persistenceContext: access.persistenceContext,
    });
    assert.deepEqual(await session.getExecutionTurnLogs(payload), []);
    await session.appendExecutionLog({
      ...payload,
      event: "workflow_started",
      ts: "2026-01-01T00:00:00.000Z",
    });

    const scope = await access.locate();
    const projected = (await readFile(path.join(scope.sessionDir, "events/system.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(projected.length, 1);
    assert.equal(projected[0].event, "workflow_started");
    assert.equal(typeof projected[0].data.executionLogSourceId, "string");
    assert.deepEqual(
      await readJson(path.join(root, "alice/runtime/session/session-tree.json")),
      createEmptySessionTree(),
    );
    assert.equal(
      await sessionRepo.storageService.exists(
        path.join(root, "alice/runtime/session/child-facade/events"),
      ),
      false,
    );
    assert.equal(
      (
        await readExecutionLogs({
          storageService: sessionRepo.storageService,
          sessionDir: scope.sessionDir,
        })
      )[0].event,
      "workflow_started",
    );
    assert.equal(
      await sessionRepo.storageService.exists(
        path.join(root, "alice/runtime/session/child-facade/session.json"),
      ),
      false,
    );
  } finally {
    await harness.cleanup();
  }
});

test("scoped Agent persistence keeps assistant and tool turns beside the child user turn", async (t) => {
  useRuntimeEventsEnv(t, { executionLog: { sessionTurnFullDebug: true } });
  const harness = buildHarness();
  const { root, runtime, sessionRepo, executionRepo } = await harness.setup();
  try {
    const access = scopedAccess(runtime, {
      sessionId: "child-agent",
      parentSessionId: "root-agent",
      node: "root-agent/node-agent",
    });
    await ensureScopedSession(runtime, {
      sessionId: "child-agent",
      parentSessionId: "root-agent",
      persistenceContext: access.persistenceContext,
    });
    const session = createSessionFacade(runtime);
    const turnIdentity = {
      userId: "alice",
      sessionId: "child-agent",
      dialogProcessId: "dialog-workflow-node-agent",
      turnScopeId: "workflow-node:agent",
      persistenceScope: access.persistenceScope,
    };
    await session.appendTurns({
      userId: "alice",
      sessionId: "child-agent",
      persistenceScope: access.persistenceScope,
      turns: [
        {
          attachments: [],
          transferEnvelopes: [],
          messageUid: "sm_node_task",
          role: "user",
          messageOrigin: "internal",
          content: "node task",
          dialogProcessId: turnIdentity.dialogProcessId,
          turnScopeId: turnIdentity.turnScopeId,
        },
      ],
    });
    await new SessionTurnPersister({ session, now: testWallClock }).appendAgentMessages({
      ...turnIdentity,
      messages: [
        {
          attachments: [],
          transferEnvelopes: [],
          messageUid: "sm_tool_call",
          role: "assistant",
          presentationMessageId: "pm_fx1",
          modelMessageId: "mm_scoped_session_repositor_1",
          type: "tool_call",
          content: "",
          tool_calls: [{ id: "call-1", function: { name: "read_file", arguments: "{}" } }],
        },
        {
          attachments: [],
          transferEnvelopes: [],
          messageUid: "sm_tool_result",
          role: "tool",
          presentationMessageId: "pm_fx1",
          type: "tool_result",
          content: "body",
          tool_call_id: "call-1",
        },
        {
          attachments: [],
          transferEnvelopes: [],
          messageUid: "sm_done",
          role: "assistant",
          presentationMessageId: "pm_fx1",
          modelMessageId: "mm_scoped_session_repositor_2",
          type: "message",
          content: "done",
        },
      ],
    });

    const reader = await sessionRepo.requireSessionReader("alice", "child-agent", {
      persistenceContext: access.persistenceContext,
    });
    const scopedSession = await reader.exportSession();
    assert.deepEqual(
      scopedSession.messages.map((message) => message.role),
      ["user", "assistant", "tool", "assistant"],
    );
    assert.equal(scopedSession.messages.at(-1).content, "done");
    const diagnostics = (
      await executionRepo.getTurnLogs("alice", "child-agent", turnIdentity.dialogProcessId, {
        persistenceContext: access.persistenceContext,
      })
    ).filter(({ event }) => event === "session_turn_full");
    assert.deepEqual(
      diagnostics.map(({ data }) => data.artifactRef.messageUid),
      ["sm_tool_call", "sm_tool_result", "sm_done"],
    );
    assert.equal(
      diagnostics.every(
        ({ sessionId, parentSessionId, dialogProcessId }) =>
          sessionId === "child-agent" &&
          parentSessionId === "root-agent" &&
          dialogProcessId === turnIdentity.dialogProcessId,
      ),
      true,
    );
    assert.equal(
      await sessionRepo.storageService.exists(
        path.join(root, "alice/runtime/session/child-agent/session.json"),
      ),
      false,
    );
  } finally {
    await harness.cleanup();
  }
});

test("scoped repositories isolate concurrent contexts and mutation locks", async () => {
  const harness = buildHarness();
  const { runtime, sessionRepo, executionRepo } = await harness.setup();
  try {
    const nodes = ["node-1", "node-2"].map((node, index) => ({
      node,
      sessionId: `child-${index}`,
      access: scopedAccess(runtime, {
        sessionId: `child-${index}`,
        parentSessionId: "parent",
        node: `run/${node}`,
      }),
    }));

    await Promise.all(
      nodes.map(async ({ node, sessionId, access }, index) => {
        const options = { persistenceContext: access.persistenceContext };
        await ensureScopedSession(runtime, {
          sessionId,
          parentSessionId: "parent",
          persistenceContext: access.persistenceContext,
        });
        await Promise.all([
          sessionRepo.writeSessionMetadata("alice", sessionId, { node }, options),
          executionRepo.appendLog(
            "alice",
            sessionId,
            { index, dialogProcessId: `dp-${index}` },
            options,
          ),
        ]);
      }),
    );

    const [firstScope, secondScope] = await Promise.all(nodes.map(({ access }) => access.locate()));
    assert.notEqual(firstScope.sessionDir, secondScope.sessionDir);
    const facade = createSessionFacade(runtime);
    const snapshots = await Promise.all(
      [firstScope, secondScope].map(({ sessionDir }) =>
        facade.readScopedSessionSnapshot({ sessionDir }),
      ),
    );
    assert.deepEqual(
      snapshots.map(({ meta }) => meta.node),
      ["node-1", "node-2"],
    );
    for (const scope of [firstScope, secondScope]) {
      assert.equal(
        await sessionRepo.storageService.exists(
          resolveSessionArtifactMutationLock(scope.sessionDir),
        ),
        false,
      );
    }
  } finally {
    await harness.cleanup();
  }
});

test("scoped metadata writes reject non-object metadata without leaving files or locks", async () => {
  const harness = buildHarness();
  const { runtime, sessionRepo } = await harness.setup();
  try {
    const access = scopedAccess(runtime, {
      sessionId: "child",
      parentSessionId: "parent",
      node: "run-fail/node",
    });
    await ensureScopedSession(runtime, {
      sessionId: "child",
      parentSessionId: "parent",
      persistenceContext: access.persistenceContext,
    });
    for (const metadata of [null, [], "boom"]) {
      await assert.rejects(
        sessionRepo.writeSessionMetadata("alice", "child", metadata, {
          persistenceContext: access.persistenceContext,
        }),
        { name: "TypeError", message: /plain object/ },
      );
    }
    const scope = await access.locate();
    assert.equal(await sessionRepo.storageService.exists(scope.metadataFile), false);
    assert.equal(
      await sessionRepo.storageService.exists(resolveSessionArtifactMutationLock(scope.sessionDir)),
      false,
    );
  } finally {
    await harness.cleanup();
  }
});

test("session facade writes per-turn execution reports into the scoped session directory", async () => {
  const harness = buildHarness();
  const { root, runtime, sessionRepo } = await harness.setup();
  try {
    const access = scopedAccess(runtime, {
      sessionId: "child-report",
      parentSessionId: "parent-report",
      node: "run-report/node-report",
    });
    await ensureScopedSession(runtime, {
      sessionId: "child-report",
      parentSessionId: "parent-report",
      persistenceContext: access.persistenceContext,
    });
    const session = createSessionFacade(runtime);
    const scopePayload = {
      userId: "alice",
      sessionId: "child-report",
      persistenceScope: access.persistenceScope,
    };

    for (const [dialogProcessId, status, error] of [
      ["dp-1", "completed", null],
      ["dp-2", "failed", new Error("boom")],
    ]) {
      await session.saveExecutionReport({
        ...scopePayload,
        report: buildExecutionReport({
          status,
          sessionId: "child-report",
          parentSessionId: "parent-report",
          dialogProcessId,
          startedAt: "2026-05-21T00:00:00.000Z",
          finishedAt: "2026-05-21T00:00:01.000Z",
          executionSummary: summarizeExecutionLogs([]),
          error,
        }),
      });
    }

    const scope = await access.locate();
    assert.equal(
      (await readJson(path.join(scope.sessionDir, "execution-reports/dp-1.json"))).status,
      "completed",
    );
    assert.equal(
      (await session.getExecutionReport({ ...scopePayload, dialogProcessId: "dp-2" })).status,
      "failed",
    );
    assert.equal(
      await session.getExecutionReport({ ...scopePayload, dialogProcessId: "missing" }),
      null,
    );
    assert.equal(
      await sessionRepo.storageService.exists(
        path.join(root, "alice/runtime/session/child-report/execution-reports"),
      ),
      false,
    );
  } finally {
    await harness.cleanup();
  }
});

test("execution report writes reject deleted sessions and invalid turn keys", async () => {
  const harness = buildHarness();
  const { runtime, sessionRepo, executionRepo } = await harness.setup();
  const reportFor = (sessionId, dialogProcessId) => ({
    protocol: EXECUTION_REPORT_PROTOCOL,
    version: EXECUTION_REPORT_VERSION,
    status: "failed",
    sessionId,
    parentSessionId: "",
    dialogProcessId,
    turnScopeId: "",
    caller: "",
    startedAt: "",
    finishedAt: "",
    durationMs: null,
    summary: null,
    summaryError: { name: "Error", message: "missing" },
    error: { name: "Error", message: "boom" },
  });
  const treeOptions = (sessionId) => ({
    persistenceContext: sessionRepo.treePersistenceContext("alice", sessionId),
  });
  try {
    for (const sessionId of ["gone", "live"]) {
      await provisionTestSession(runtime, {
        userId: "alice",
        sessionId,
        caller: SESSION_CALLER.USER,
      });
    }
    await sessionRepo.markSessionsDeleted("alice", ["gone"]);
    await assert.rejects(
      executionRepo.saveReport("alice", "gone", reportFor("gone", "dp-1"), treeOptions("gone")),
      { code: "SESSION_DELETED" },
    );
    for (const dialogProcessId of ["", "../escape", "a/b"]) {
      await assert.rejects(
        executionRepo.saveReport(
          "alice",
          "live",
          reportFor("live", dialogProcessId),
          treeOptions("live"),
        ),
        { code: "DIALOG_PROCESS_ID_INVALID" },
      );
      await assert.rejects(
        executionRepo.getReport("alice", "live", dialogProcessId, treeOptions("live")),
        { code: "DIALOG_PROCESS_ID_INVALID" },
      );
    }
    const liveScope = await sessionRepo.requireSessionScope(
      "alice",
      "live",
      treeOptions("live").persistenceContext,
    );
    assert.equal(
      await sessionRepo.storageService.exists(path.join(liveScope.sessionDir, "execution-reports")),
      false,
    );
  } finally {
    await harness.cleanup();
  }
});
