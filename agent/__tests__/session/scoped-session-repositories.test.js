/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  buildExecutionReport,
  EXECUTION_REPORT_PROTOCOL,
  EXECUTION_REPORT_VERSION,
} from "@noobot/session-protocol/execution-report";
import { resolveSessionArtifactMutationLock } from "../../src/session/session-artifact-files.js";
import { ExecutionLogRepository } from "../../src/observability/execution-log/execution-log-repository.js";
import { summarizeExecutionLogs } from "../../src/observability/execution-log/execution-log-summary.js";
import { ExecutionLogService } from "../../src/observability/execution-log/execution-log-service.js";
import { createSessionFacade } from "../../src/session/index.js";
import { SessionMessageService } from "../../src/session/services/session-message-service.js";
import { SessionTurnPersister } from "../../src/bot/execution/turn-persister.js";
import {
  ScopedSessionLocationResolver,
  createPersistenceContext,
} from "../../src/session/session-location-resolver.js";
import {
  readExecutionLogs,
  readSessionArtifact,
} from "../../src/session/session-artifact-store.js";
import { buildHarness, readJson } from "./scoped-session-repositories.fixtures.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createEmptySessionTree } from "@noobot/workspace-protocol/session-tree";

test("scoped repositories keep all artifacts and metadata in their execution directory without default leakage", async () => {
  const harness = buildHarness();
  const { root, pathResolver, sessionRepo, taskRepo, executionRepo } = await harness.setup();
  try {
    const resolver = new ScopedSessionLocationResolver({
      pathResolver,
      userId: "alice",
      sessionId: "child-a",
      parentSessionId: "parent-a",
      scopeId: "agent:child-a",
      allowedRoot: "runtime/plugin-data/workflow/session",
      relativeDir: "runtime/plugin-data/workflow/session/run-a/node-a",
    });
    const context = createPersistenceContext({
      locationResolver: resolver,
      metadataContributor: ({ sessionId, parentSessionId, scope }) => ({
        plugin: "workflow-test",
        sessionId,
        parentSessionId,
        sessionDir: scope.sessionDir,
      }),
    });

    await sessionRepo.withSessionMutation(
      "alice",
      "child-a",
      "parent-a",
      async () => {
        await sessionRepo.ensureSession({
          userId: "alice",
          sessionId: "child-a",
          parentSessionId: "parent-a",
          caller: SESSION_CALLER.BOT,
          persistenceContext: context,
        });
        await taskRepo.save(
          "alice",
          "child-a",
          {
            taskId: "task-a",
            skillName: "skill",
            taskName: "task",
            taskStatus: "start",
          },
          "parent-a",
          context,
        );
        await executionRepo.appendLog(
          "alice",
          "child-a",
          { type: "event", value: 1, dialogProcessId: "dp-a" },
          "parent-a",
          context,
        );
      },
      context,
    );

    const scope = await resolver.resolveSessionScope("alice", "child-a", "parent-a");
    assert.equal(
      scope.sessionDir,
      path.join(root, "alice/runtime/plugin-data/workflow/session/run-a/node-a"),
    );
    assert.deepEqual(await readJson(scope.metadataFile), {
      plugin: "workflow-test",
      sessionId: "child-a",
      parentSessionId: "parent-a",
      sessionDir: scope.sessionDir,
    });
    assert.equal((await readJson(scope.sessionFile)).parentSessionId, "parent-a");
    await sessionRepo.ensureSessionDisplaySummary("alice", "child-a", "parent-a", context);
    assert.equal((await readJson(scope.sessionSummaryFile)).sessionId, "child-a");
    assert.equal((await readJson(scope.taskFile)).tasks[0].taskId, "task-a");
    assert.equal((await readExecutionLogs(scope.sessionDir))[0].value, 1);

    const defaultRoot = path.join(root, "alice/runtime/session");
    assert.equal(
      await sessionRepo.storageService.exists(path.join(defaultRoot, "child-a/session.json")),
      false,
    );
    assert.equal(
      await sessionRepo.storageService.exists(path.join(defaultRoot, "sessions.json")),
      false,
    );
    assert.equal(
      await sessionRepo.storageService.exists(path.join(defaultRoot, ".deleted-sessions.json")),
      false,
    );
    assert.deepEqual(
      await readJson(path.join(defaultRoot, "session-tree.json")),
      createEmptySessionTree(),
    );
    assert.equal(
      await sessionRepo.storageService.exists(resolveSessionArtifactMutationLock(scope.sessionDir)),
      false,
    );
  } finally {
    await harness.cleanup();
  }
});

test("session facade execution reads do not create a default shadow session for scoped workflows", async () => {
  const harness = buildHarness();
  const { root, pathResolver, sessionRepo, executionRepo } = await harness.setup();
  try {
    const resolver = new ScopedSessionLocationResolver({
      pathResolver,
      userId: "alice",
      sessionId: "child-facade",
      parentSessionId: "parent-facade",
      scopeId: "workflow:child-facade",
      allowedRoot: "runtime/plugin-data/workflow/session",
      relativeDir: "runtime/plugin-data/workflow/session/run-facade/node-facade",
    });
    const persistenceContext = createPersistenceContext({ locationResolver: resolver });
    const executionLogService = new ExecutionLogService({
      executionRepo: new ExecutionLogRepository({ executionRepository: executionRepo }),
      sessionRepo,
    });
    const session = createSessionFacade({
      sessionTreeService: {},
      sessionCrudService: {},
      sessionMessageService: {},
      executionReadService: {},
      sessionContextService: {},
      taskService: {},
      executionLogService,
    });

    await sessionRepo.ensureSession({
      userId: "alice",
      sessionId: "child-facade",
      parentSessionId: "parent-facade",
      caller: SESSION_CALLER.BOT,
      persistenceContext,
    });
    await session.getExecutionTurnLogs({
      userId: "alice",
      sessionId: "child-facade",
      dialogProcessId: "dp-facade",
      parentSessionId: "parent-facade",
      persistenceContext,
    });
    await session.appendExecutionLog({
      userId: "alice",
      sessionId: "child-facade",
      parentSessionId: "parent-facade",
      dialogProcessId: "dp-facade",
      persistenceContext,
      event: "workflow_started",
    });

    const scope = await resolver.resolveSessionScope("alice", "child-facade", "parent-facade");
    assert.equal(await sessionRepo.storageService.exists(scope.sessionFile), true);
    assert.equal((await readExecutionLogs(scope.sessionDir))[0].event, "workflow_started");
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

test("scoped Agent persistence keeps assistant and tool turns beside the child user turn", async () => {
  const harness = buildHarness();
  const { root, pathResolver, sessionRepo, executionRepo } = await harness.setup();
  try {
    const resolver = new ScopedSessionLocationResolver({
      pathResolver,
      userId: "alice",
      sessionId: "child-agent",
      parentSessionId: "root-agent",
      scopeId: "agent:child-agent",
      allowedRoot: "runtime/plugin-data/workflow/session",
      relativeDir: "runtime/plugin-data/workflow/session/root-agent/node-agent",
    });
    const context = createPersistenceContext({ locationResolver: resolver });
    await sessionRepo.ensureSession({
      userId: "alice",
      sessionId: "child-agent",
      parentSessionId: "root-agent",
      caller: SESSION_CALLER.BOT,
      persistenceContext: context,
    });
    const messageService = new SessionMessageService({ sessionRepo });
    const persister = new SessionTurnPersister({
      session: {
        appendTurns: (payload = {}) => messageService.appendTurns(payload),
        appendExecutionLog: (payload = {}) =>
          executionRepo.appendLog(
            payload.userId,
            payload.sessionId,
            {
              event: payload.event,
              type: payload.type,
              data: payload.data,
              dialogProcessId: payload.dialogProcessId,
            },
            payload.parentSessionId,
            payload.persistenceContext,
          ),
      },
    });
    await messageService.appendTurns({
      userId: "alice",
      sessionId: "child-agent",
      parentSessionId: "root-agent",
      persistenceContext: context,
      turns: [
        {
          role: "user",
          content: "node task",
          dialogProcessId: "dialog-workflow-node-agent",
          turnScopeId: "workflow-node:agent",
        },
      ],
    });
    await persister.appendAgentMessages({
      userId: "alice",
      sessionId: "child-agent",
      parentSessionId: "root-agent",
      dialogProcessId: "dialog-workflow-node-agent",
      turnScopeId: "workflow-node:agent",
      persistenceContext: context,
      messages: [
        {
          role: "assistant",
          type: "tool_call",
          content: "",
          tool_calls: [{ id: "call-1", function: { name: "read_file", arguments: "{}" } }],
        },
        { role: "tool", type: "tool_result", content: "body", tool_call_id: "call-1" },
        { role: "assistant", type: "message", content: "done" },
      ],
    });

    const scope = await resolver.resolveSessionScope("alice", "child-agent", "root-agent");
    const scopedSession = await readSessionArtifact({ sessionDir: scope.sessionDir });
    assert.deepEqual(
      scopedSession.messages.map((message) => message.role),
      ["user", "assistant", "tool", "assistant"],
    );
    assert.equal(scopedSession.messages.at(-1).content, "done");
    assert.equal(
      (await readExecutionLogs(scope.sessionDir)).some((item) =>
        JSON.stringify(item).includes("session_turn_full"),
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
  const { pathResolver, sessionRepo, taskRepo, executionRepo } = await harness.setup();
  try {
    const makeContext = (name, index) => {
      const resolver = new ScopedSessionLocationResolver({
        pathResolver,
        userId: "alice",
        sessionId: `child-${index}`,
        parentSessionId: "parent",
        scopeId: `agent:${name}`,
        allowedRoot: "runtime/plugin-data/workflow/session",
        relativeDir: `runtime/plugin-data/workflow/session/run/${name}`,
      });
      return {
        resolver,
        context: createPersistenceContext({
          locationResolver: resolver,
          metadataContributor: () => ({ node: name }),
        }),
      };
    };
    const first = makeContext("node-1", 0);
    const second = makeContext("node-2", 1);

    await Promise.all(
      [first, second].map(({ context }, index) =>
        sessionRepo.withSessionMutation(
          "alice",
          `child-${index}`,
          "parent",
          async () => {
            await sessionRepo.ensureSession({
              userId: "alice",
              caller: SESSION_CALLER.USER,
              sessionId: `child-${index}`,
              parentSessionId: "parent",
              persistenceContext: context,
            });
            await taskRepo.save(
              "alice",
              `child-${index}`,
              { taskId: `task-${index}`, taskStatus: "start" },
              "parent",
              context,
            );
            await executionRepo.appendLog(
              "alice",
              `child-${index}`,
              { index, dialogProcessId: `dp-${index}` },
              "parent",
              context,
            );
          },
          context,
        ),
      ),
    );

    const firstScope = await first.resolver.resolveSessionScope("alice", "child-0", "parent");
    const secondScope = await second.resolver.resolveSessionScope("alice", "child-1", "parent");
    assert.notEqual(firstScope.sessionDir, secondScope.sessionDir);
    assert.equal((await readJson(firstScope.metadataFile)).node, "node-1");
    assert.equal((await readJson(secondScope.metadataFile)).node, "node-2");
    assert.equal((await readJson(firstScope.taskFile)).tasks[0].taskId, "task-0");
    assert.equal((await readJson(secondScope.taskFile)).tasks[0].taskId, "task-1");
  } finally {
    await harness.cleanup();
  }
});

test("scoped metadata contributor failures abort the locked mutation", async () => {
  const harness = buildHarness();
  const { pathResolver, sessionRepo } = await harness.setup();
  try {
    const resolver = new ScopedSessionLocationResolver({
      pathResolver,
      userId: "alice",
      sessionId: "child",
      parentSessionId: "parent",
      scopeId: "agent:child",
      allowedRoot: "runtime/plugin-data/workflow/session",
      relativeDir: "runtime/plugin-data/workflow/session/run-fail/node",
    });
    const context = createPersistenceContext({
      locationResolver: resolver,
      metadataContributor: () => {
        throw new Error("metadata boom");
      },
    });
    await assert.rejects(
      () =>
        sessionRepo.withSessionMutation(
          "alice",
          "child",
          "parent",
          async () => {
            await sessionRepo.ensureSession({
              userId: "alice",
              caller: SESSION_CALLER.USER,
              sessionId: "child",
              parentSessionId: "parent",
              persistenceContext: context,
            });
          },
          context,
        ),
      /metadata boom/,
    );
    const scope = await resolver.resolveSessionScope("alice", "child", "parent");
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
  const { root, pathResolver, sessionRepo, executionRepo } = await harness.setup();
  try {
    const resolver = new ScopedSessionLocationResolver({
      pathResolver,
      userId: "alice",
      sessionId: "child-report",
      parentSessionId: "parent-report",
      scopeId: "workflow:child-report",
      allowedRoot: "runtime/plugin-data/workflow/session",
      relativeDir: "runtime/plugin-data/workflow/session/run-report/node-report",
    });
    const persistenceContext = createPersistenceContext({ locationResolver: resolver });
    const session = createSessionFacade({
      sessionTreeService: {},
      sessionCrudService: {},
      sessionMessageService: {},
      executionReadService: {},
      sessionContextService: {},
      taskService: {},
      executionLogService: new ExecutionLogService({
        executionRepo: new ExecutionLogRepository({ executionRepository: executionRepo }),
        sessionRepo,
      }),
    });
    const scopePayload = {
      userId: "alice",
      sessionId: "child-report",
      parentSessionId: "parent-report",
      persistenceContext,
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
          executionSummary: summarizeExecutionLogs([]),
          error,
        }),
      });
    }

    const scope = await resolver.resolveSessionScope("alice", "child-report", "parent-report");
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
  const { root, sessionRepo, executionRepo } = await harness.setup();
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
  try {
    await sessionRepo.markSessionsDeleted("alice", ["gone"]);
    await assert.rejects(executionRepo.saveReport("alice", "gone", reportFor("gone", "dp-1")), {
      code: "SESSION_DELETED",
    });
    for (const dialogProcessId of ["", "../escape", "a/b"]) {
      await assert.rejects(
        executionRepo.saveReport("alice", "live", reportFor("live", dialogProcessId)),
        { code: "DIALOG_PROCESS_ID_INVALID" },
      );
      await assert.rejects(executionRepo.getReport("alice", "live", dialogProcessId), {
        code: "DIALOG_PROCESS_ID_INVALID",
      });
    }
    for (const sessionId of ["gone", "live"]) {
      assert.equal(
        await sessionRepo.storageService.exists(
          path.join(root, `alice/runtime/session/${sessionId}/execution-reports`),
        ),
        false,
      );
    }
  } finally {
    await harness.cleanup();
  }
});
