/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { WebSocket } from "ws";
import { join, relative } from "node:path";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_UPGRADE_OWNER } from "@noobot/workspace-protocol";
import { isPathWithinRoot } from "@noobot/path-resolver";
import {
  initializeUserWorkspace,
  releaseQuarantinedUnits,
} from "../../agent/__tests__/helpers/user-workspace.js";
import {
  createParentExecutionScope,
  DETACHED_REQUEST_METADATA,
} from "../../agent/__tests__/bot/detached-subsession-runner.test-helpers.js";
import { createAgentDetachedSubSessionStrategy } from "../../agent/src/bot/session/detached-subsession-strategy.js";
import { PartitionJournal } from "../../agent/src/session/partition-storage/partition-journal.js";
import { quarantineMigrationUnit } from "../../agent/src/workspace-lifecycle/migration-quarantine.js";
import { AGENT_TRANSPORT_EVENT } from "@noobot/agent-transport-protocol/events";
import { assertWorkspaceStorageReady } from "noobot-agent/workspace-session-storage";
import { createConfiguredSessionRuntime } from "../bootstrap/create-app-dependencies.js";
import {
  closeServer,
  createProtocolTestCommand,
  startAuthoritativeServerWithWs,
  waitForCondition,
} from "./routes/chat-websocket-server.test-helpers.js";
import { express, registerSessionRoutes, withTestServer } from "./routes/session-routes.helpers.js";
import { withRuntimeEventsEnv } from "./runtime-events-root.test-helpers.js";
import { TURN_EVENT } from "@noobot/session-protocol";
import {
  createPartitionBotFixture,
  firstSend,
  identity,
} from "./partition-bot-assembly.test-helpers.js";

test("workspace maintenance drains Bot operations and revokes only its retained pages", async (t) => {
  const { service, workspaceRoot, budget, setBudget } = await createPartitionBotFixture(t);
  setBudget({ ...budget, maxJournals: 2 });
  const other = { ...identity, userId: "other-user" };
  await initializeUserWorkspace(workspaceRoot, other.userId);
  const { bot } = await service.rebuildRuntimeConfig();
  await bot.session.applyTurnLifecycleEvent(firstSend());
  await bot.session.applyTurnLifecycleEvent(firstSend(other));
  const request = {
    sessionId: identity.sessionId,
    cursor: null,
    limit: 1,
    maxBytes: 4096,
    direction: "backward",
  };
  const page = (userId, cursor = null) =>
    bot.session.getSessionDisplayPage({ userId, request: { ...request, cursor } });
  const a = await page(identity.userId);
  const b = await page(other.userId);
  assert.ok(a.nextCursor && b.nextCursor);
  const started = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const work = bot.session.withSessionLifecycleMutation(identity, async () => {
    started.resolve();
    await resume.promise;
    return bot.session.locateSessionScope(identity);
  });
  await started.promise;
  const journalClosing = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const close = PartitionJournal.prototype.close;
  const fault = t.mock.method(PartitionJournal.prototype, "close", async function () {
    if (isPathWithinRoot(bot.getWorkspacePath(identity.userId), this.root)) {
      journalClosing.resolve();
      await finish.promise;
    }
    return close.call(this);
  });
  const maintenance = bot.repairUserWorkspace(identity.userId);
  try {
    await assert.rejects(page(identity.userId), { code: "WORKSPACE_MAINTENANCE" });
    await assert.rejects(bot.repairUserWorkspace(identity.userId), {
      code: "WORKSPACE_MAINTENANCE",
    });
    assert.equal((await page(other.userId, b.nextCursor)).nextCursor, null);
    resume.resolve();
    await work;
    await Promise.race([journalClosing.promise, maintenance]);
    await assert.rejects(bot.session.listSessionIds({ userId: identity.userId }), {
      code: "WORKSPACE_MAINTENANCE",
    });
    assert.ok((await page(other.userId)).nextCursor);
  } finally {
    resume.resolve();
    finish.resolve();
    await Promise.all([work, maintenance]);
    fault.mock.restore();
  }
  await assert.rejects(page(identity.userId, a.nextCursor), {
    code: "SESSION_PAGE_SNAPSHOT_EXPIRED",
  });
  assert.ok((await page(identity.userId)).nextCursor);
});

test(
  "workspace maintenance drains an admitted run and its asynchronous memory work",
  { timeout: 10000 },
  async (t) => {
    const { service, workspaceRoot, budget, setBudget } = await createPartitionBotFixture(t);
    setBudget({ ...budget, maxJournals: 2 });
    const other = { ...identity, userId: "other-user" };
    await initializeUserWorkspace(workspaceRoot, other.userId);
    const { bot } = await service.rebuildRuntimeConfig();
    await bot.session.applyTurnLifecycleEvent(firstSend());
    await bot.session.applyTurnLifecycleEvent(firstSend(other));
    const execution = Promise.withResolvers();
    const summary = Promise.withResolvers();
    const summaryStarted = Promise.withResolvers();
    const summaryRead = Promise.withResolvers();
    const memory = bot.sessionRunner.memoryPostProcessService;
    let capture;
    t.mock.method(bot.sessionRunner.runner, "runSession", async (payload) => {
      await execution.promise;
      capture = memory.runMemoryPostProcessFlow(payload);
      return bot.session.listSessionIds(payload);
    });
    t.mock.method(memory, "capture", async (payload) => {
      memory.scheduleMemorySummarizeFlow(payload);
    });
    t.mock.method(memory, "summarize", async (payload) => {
      summaryStarted.resolve();
      await summary.promise;
      summaryRead.resolve(bot.session.listSessionIds(payload));
      await summaryRead.promise;
    });
    let repaired = false;
    const work = bot.runSession(identity);
    const maintenance = bot.repairUserWorkspace(identity.userId).then(() => {
      repaired = true;
    });
    try {
      await assert.rejects(bot.runSession(identity), { code: "WORKSPACE_MAINTENANCE" });
      await assert.rejects(bot.resolveExecutionIntent(identity), { code: "WORKSPACE_MAINTENANCE" });
      await assert.rejects(bot.replaceSessionTurn({ ...identity, attachments: [] }), {
        code: "WORKSPACE_MAINTENANCE",
      });
      assert.deepEqual(await bot.session.listSessionIds(other), [other.sessionId]);
      execution.resolve();
      assert.deepEqual(await work, [identity.sessionId]);
      await capture;
      await summaryStarted.promise;
      assert.equal(repaired, false);
      await assert.rejects(bot.session.listSessionIds(identity), { code: "WORKSPACE_MAINTENANCE" });
    } finally {
      execution.resolve();
      summary.resolve();
      await Promise.all([work, maintenance]);
    }
    assert.deepEqual(await summaryRead.promise, [identity.sessionId]);
    assert.deepEqual(await bot.session.listSessionIds(identity), [identity.sessionId]);
  },
);

test(
  "workspace maintenance drains the detached entry through terminal publication",
  { timeout: 10000 },
  async (t) => {
    const { service, budget, setBudget } = await createPartitionBotFixture(t);
    setBudget({ ...budget, maxJournals: 2 });
    const { bot } = await service.rebuildRuntimeConfig();
    await bot.repairUserWorkspace(identity.userId);
    await bot.session.applyTurnLifecycleEvent(firstSend());
    const started = Promise.withResolvers();
    const resume = Promise.withResolvers();
    const strategy = createAgentDetachedSubSessionStrategy({
      userId: identity.userId,
      parentSessionId: identity.sessionId,
      parentDialogProcessId: "parent-dialog",
    });
    t.mock.method(
      bot.sessionRunner.runner,
      "runSession",
      async ({ sessionId, dialogProcessId, turnScopeId }) => ({
        sessionId,
        dialogProcessId,
        turnScopeId,
        answer: "done",
        traces: [],
        messageSource: { sessionId, dialogProcessId, turnScopeId },
        transferEnvelopes: [],
      }),
    );
    const request = {
      strategy,
      parentExecutionScope: createParentExecutionScope(),
      abortSignal: new AbortController().signal,
      metadata: DETACHED_REQUEST_METADATA,
      message: "child",
      attachments: [],
      async systemMessageFactory() {
        started.resolve();
        await resume.promise;
        return [];
      },
    };
    const runPluginDetachedSubSession = bot.sessionRunner._createDetachedSubSessionRunner();
    const work = runPluginDetachedSubSession(request);
    await Promise.race([started.promise, work]);
    const maintenance = bot.repairUserWorkspace(identity.userId);
    try {
      await assert.rejects(bot.runDetachedSubSession(request), { code: "WORKSPACE_MAINTENANCE" });
      resume.resolve();
      assert.equal((await work).lifecycle.state, "completed");
    } finally {
      resume.resolve();
      await Promise.all([work, maintenance]);
    }
  },
);

test(
  "WebSocket workspace maintenance drains acceptance, cross-socket stop and terminal publication",
  { timeout: 15000 },
  async (t) => {
    const { service, workspaceRoot, budget, setBudget } = await createPartitionBotFixture(t);
    setBudget({ ...budget, maxJournals: 2 });
    const other = { ...identity, userId: "other-user" };
    await initializeUserWorkspace(workspaceRoot, other.userId);
    const { bot } = await service.rebuildRuntimeConfig();
    await bot.repairUserWorkspace(identity.userId);
    await bot.repairUserWorkspace(other.userId);
    let intentEntered = false;
    const releaseIntent = Promise.withResolvers();
    let aborted = false;
    const releaseRunner = Promise.withResolvers();
    const cleanup = new AbortController();
    const original = bot.resolveExecutionIntent.bind(bot);
    t.mock.method(bot, "resolveExecutionIntent", async (payload) => {
      if (payload.userId === identity.userId) {
        intentEntered = true;
        await releaseIntent.promise;
      }
      return original(payload);
    });
    t.mock.method(bot.sessionRunner.runner, "runSession", async (payload) => {
      const { userId, sessionId, dialogProcessId, turnScopeId, eventListener, abortSignal } =
        payload;
      if (userId === other.userId) {
        throw Object.assign(new Error("other workspace reached its runner"), { code: "OTHER_RUN" });
      }
      eventListener.onEvent({
        event: "agent_lifecycle_state_changed",
        data: { state: "running", sessionId, dialogProcessId, turnScopeId },
      });
      if (!abortSignal.aborted) await once(abortSignal, "abort", { signal: cleanup.signal });
      aborted = true;
      await releaseRunner.promise;
      abortSignal.throwIfAborted();
    });

    await withRuntimeEventsEnv({ workspaceRoot }, async () => {
      const server = await startAuthoritativeServerWithWs({
        bot,
        resolveAuthByApiKey: (request) => ({
          userId: request.headers.authorization === "Bearer other" ? other.userId : identity.userId,
        }),
      });
      const received = {};
      const sockets = [];
      const wait = async (stage, predicate) => {
        try {
          await waitForCondition(predicate, { timeoutMs: 3000, message: stage });
        } catch (cause) {
          throw new Error(`${stage}: ${JSON.stringify(received)}`, { cause });
        }
      };
      const open = async (name, token) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/chat/ws`, {
          headers: { authorization: `Bearer ${token}` },
          handshakeTimeout: 3000,
        });
        sockets.push(ws);
        const events = (received[name] = []);
        ws.on("message", (raw) => events.push(JSON.parse(String(raw))));
        await once(ws, "open");
        return {
          send: (payload) => ws.send(JSON.stringify(createProtocolTestCommand(payload))),
          async wait(stage, predicate) {
            await wait(`${name}: ${stage}`, () => events.some(predicate));
            return events.find(predicate);
          },
        };
      };
      const lifecycle = (type) => (event) =>
        event.event === "turn_lifecycle" && event.data.payload.eventType === type;
      const failed = (code) => (event) =>
        event.event === AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT && event.data.error?.code === code;
      const send = {
        sessionId: identity.sessionId,
        turnScopeId: "ws-turn",
        message: "hello",
        createIfAbsent: true,
      };
      let maintenance;
      let reopened = false;
      try {
        const origin = await open("origin", "owner");
        const second = await open("second", "owner");
        const isolated = await open("isolated", "other");
        origin.send(send);
        await wait("intent not reached", () => intentEntered);
        maintenance = bot.repairUserWorkspace(identity.userId).then(() => {
          reopened = true;
        });
        second.send({ ...send, sessionId: "rejected", turnScopeId: "rejected" });
        await second.wait("maintenance rejection", failed("WORKSPACE_MAINTENANCE"));
        isolated.send(send);
        await isolated.wait("other workspace execution", failed("OTHER_RUN"));
        assert.equal(reopened, false);
        releaseIntent.resolve();
        const processing = await origin.wait(
          "processing",
          lifecycle(TURN_EVENT.PROCESSING_STARTED),
        );
        second.send({
          action: "stop",
          sessionId: send.sessionId,
          turnScopeId: send.turnScopeId,
          expectedRevision: processing.data.payload.revision,
        });
        await second.wait("cross-socket stop accepted", lifecycle(TURN_EVENT.STOP_ACCEPTED));
        await wait("runner was not aborted", () => aborted);
        assert.equal(reopened, false);
        await assert.rejects(bot.session.listSessionIds(identity), {
          code: "WORKSPACE_MAINTENANCE",
        });
        releaseRunner.resolve();
        await origin.wait("terminal publication", lifecycle(TURN_EVENT.STOP_COMPLETED));
        await maintenance;
        const { session } = await bot.session.getSessionBundle(identity);
        assert.equal(session.turnLifecycle.turns[send.turnScopeId].state, "stop_completed");
      } finally {
        cleanup.abort();
        releaseIntent.resolve();
        releaseRunner.resolve();
        for (const ws of sockets) ws.terminate();
        await closeServer(server);
        await maintenance;
      }
    });
  },
);

async function workspaceWithQuarantine(t, owner, relativePath) {
  const { service, workspaceRoot } = await createPartitionBotFixture(t, {
    assemble: (config, dependencies) =>
      createConfiguredSessionRuntime(config, { ...dependencies, assertWorkspaceStorageReady }),
  });
  const other = { ...identity, userId: "other-user" };
  await initializeUserWorkspace(workspaceRoot, other.userId);
  const { bot } = await service.rebuildRuntimeConfig();
  await bot.repairUserWorkspace(other.userId);
  await bot.repairUserWorkspace(identity.userId);
  const base = bot.getWorkspacePath(identity.userId);
  const held = join(base, WORKSPACE_LAYOUT.MIGRATION_QUARANTINE_DIR, owner, relativePath);
  const original = join(base, relativePath);
  await mkdir(join(original, ".."), { recursive: true });
  await writeFile(original, "{}");
  await quarantineMigrationUnit({
    base,
    kind: owner,
    relativePath,
    error: new Error("Fixture quarantine"),
    move: true,
  });
  return { service, bot, other, base, owner, held, relativePath };
}

test("a historical session quarantine blocks only while its retained source is missing", async (t) => {
  const { bot, other, base, held } = await workspaceWithQuarantine(
    t,
    WORKSPACE_LAYOUT_UPGRADE_OWNER.MODEL_CONTEXT_SNAPSHOT,
    "runtime/session/missing/model-message-snapshots/staged.json",
  );
  const displaced = join(base, "missing-quarantine-fixture");
  await rename(held, displaced);
  await writeFile(join(base, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE), JSON.stringify({ version: 45 }));

  await assert.rejects(bot.repairUserWorkspace(identity.userId), {
    code: "WORKSPACE_MIGRATION_QUARANTINE_CONFLICT",
    details: { destination: held },
  });
  await assert.rejects(bot.session.listSessionIds(identity), { code: "WORKSPACE_MAINTENANCE" });
  assert.deepEqual(await bot.session.listSessionIds(other), []);

  await rename(displaced, held);
  await bot.repairUserWorkspace(identity.userId);
  assert.deepEqual(await bot.session.listSessionIds(identity), []);
});

test("a current layout stays closed until its non-session quarantine is resolved offline", async (t) => {
  const { service, bot, other, base, owner, held, relativePath } = await workspaceWithQuarantine(
    t,
    WORKSPACE_LAYOUT_UPGRADE_OWNER.ATTACHMENT_CATALOG,
    "runtime/attach/catalog.json",
  );
  const blocked = {
    code: "SESSION_STORAGE_UPGRADE_BLOCKED",
    details: { quarantinePaths: [relative(base, held)] },
  };
  await assert.rejects(bot.repairUserWorkspace(identity.userId), blocked);
  await assert.rejects(bot.session.listSessionIds(identity), { code: "WORKSPACE_MAINTENANCE" });
  assert.deepEqual(await bot.session.listSessionIds(other), []);

  const replacement = (await service.rebuildRuntimeConfig()).bot;
  await assert.rejects(replacement.session.listSessionIds(identity), (error) => {
    assert.equal(error.code, "WORKSPACE_MAINTENANCE");
    assert.equal(error.cause.code, blocked.code);
    assert.deepEqual(error.cause.details, blocked.details);
    return true;
  });
  await assert.rejects(replacement.repairUserWorkspace(identity.userId), blocked);
  assert.deepEqual(await releaseQuarantinedUnits({ base, kind: owner }), [relativePath]);
  await replacement.repairUserWorkspace(identity.userId);
  assert.deepEqual(await replacement.session.listSessionIds(identity), []);
});

test("failed workspace retirement stays closed until a retry releases the resident slot", async (t) => {
  const { service, workspaceRoot, access } = await createPartitionBotFixture(t);
  const other = { ...identity, userId: "other-user" };
  await initializeUserWorkspace(workspaceRoot, other.userId);
  const { bot } = await service.rebuildRuntimeConfig();
  await bot.session.applyTurnLifecycleEvent(firstSend(other));
  await bot.session.applyTurnLifecycleEvent(firstSend());
  const app = express();
  app.use(express.json());
  registerSessionRoutes(app, { bot: access, runBotOperation: access.runOperation });
  await withTestServer(app, async (url) => {
    const page = async (userId, status, errorCode) => {
      const response = await fetch(
        `${url}/internal/session/${userId}/${identity.sessionId}/display-page`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cursor: null, limit: 1, maxBytes: 4096, direction: "backward" }),
        },
      );
      const body = await response.json();
      assert.equal(response.status, status, JSON.stringify(body));
      if (errorCode) assert.equal(body.errorCode, errorCode);
      return body;
    };
    const failure = new Error("injected workspace journal close failure");
    const close = PartitionJournal.prototype.close;
    const fault = t.mock.method(PartitionJournal.prototype, "close", async function () {
      await close.call(this);
      if (isPathWithinRoot(bot.getWorkspacePath(identity.userId), this.root)) throw failure;
    });
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await assert.rejects(bot.repairUserWorkspace(identity.userId), (error) => {
          assert.ok(error instanceof AggregateError);
          assert.deepEqual(error.errors, [failure]);
          return true;
        });
        await page(identity.userId, 503, "WORKSPACE_MAINTENANCE");
        assert.deepEqual(await bot.session.listSessionIds(other), [other.sessionId]);
        const blocked = await page(other.userId, 503, "SESSION_JOURNAL_RETIREMENT_FAILED");
        assert.equal(blocked.error, "Could not retire a resident journal for admission");
      }
      assert.equal(fault.mock.callCount(), 4);
    } finally {
      fault.mock.restore();
    }
    assert.ok((await page(other.userId, 200)).page.nextCursor);
    await page(identity.userId, 503, "WORKSPACE_MAINTENANCE");
    await bot.repairUserWorkspace(identity.userId);
    await bot.repairUserWorkspace(other.userId);
    assert.ok((await page(identity.userId, 200)).page.nextCursor);
  });
});
