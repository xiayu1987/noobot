/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { executeEmptySessionCleanup } from "../../agent/__tests__/helpers/session-services.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { BotManager } from "#agent/bot";
import {
  createSessionPersistenceScope,
  requireMessageDeleteResponse,
  requireTurnReplaceResponse,
} from "@noobot/session-protocol";
import { selectMainSessionDetailEntry } from "@noobot/session-protocol/session-detail";
import { readApiResponseEnvelope } from "@noobot/shared/request-error";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  resolvePluginDataRelativePath,
  resolveScopedSessionRoots,
} from "@noobot/workspace-protocol";
import { createConfiguredSessionRuntime } from "../bootstrap/create-app-dependencies.js";
import { createPluginServicePorts } from "../services/plugin-service-ports.js";
import {
  deleteSessionMessagesFromApi,
  getSessionDetailApi,
  replaceSessionTurnApi,
} from "../../client/noobot-chat/src/infrastructure/api/chat/chatApi.js";
import { createSessionDetailApplicator } from "../../client/noobot-chat/src/modules/session/model/list/sessionDetailApply.js";
import { createSessionDetailRequests } from "../../client/noobot-chat/src/modules/session/model/list/sessionDetailRequests.js";
import { createSessionMutationApplicator } from "../../client/noobot-chat/src/modules/session/model/list/sessionMutationApply.js";
import { express, registerSessionRoutes, withTestServer } from "./routes/session-routes.helpers.js";
import { initializeUserWorkspace } from "../../agent/__tests__/helpers/user-workspace.js";
import { createAcceptedAgentExecution } from "../../agent/__tests__/helpers/accepted-run-identity.js";
import { PartitionJournal } from "../../agent/src/session/partition-storage/partition-journal.js";
import {
  createPartitionBotFixture,
  firstSend,
  identity,
} from "./partition-bot-assembly.test-helpers.js";

test("Bot requires explicit storage assembly without choosing an implicit backend", () => {
  assert.throws(() => new BotManager({}), /BotManager requires createSessionRuntime/);
});

test("missing storage budget rejects startup without enabling an old backend", async (t) => {
  const f = await createPartitionBotFixture(t);
  f.setBudget(undefined);
  await assert.rejects(f.service.rebuildRuntimeConfig(), {
    code: "CONFIG_VALIDATION_FAILED",
    details: { path: "partitionSessionStorage" },
  });
  assert.equal(f.assemblyAttempts, 0);
  assert.equal(f.state.bot, null);
});

test("storage assembly failure leaves the published Bot writable and propagates without fallback", async (t) => {
  const f = await createPartitionBotFixture(t);
  const { bot } = await f.service.rebuildRuntimeConfig();
  await bot.session.applyTurnLifecycleEvent(firstSend());
  const { sessionDir } = await bot.session.locateSessionScope(identity);
  const head = await readFile(join(sessionDir, "CURRENT"));
  const failure = new Error("partition storage policy rejected");
  f.failAssembly(failure);
  await assert.rejects(f.service.rebuildRuntimeConfig(), (cause) => cause === failure);
  assert.equal(f.state.bot, bot);
  assert.equal(await f.access.runOperation(() => f.access.session), bot.session);
  assert.deepEqual(await readFile(join(sessionDir, "CURRENT")), head);
  await bot.session.renameSession({ ...identity, title: "Still active" });
  f.failAssembly(null);
  const { bot: next } = await f.service.rebuildRuntimeConfig();
  assert.equal(
    (await next.session.getSessionDisplayData(identity)).sessions[0].title,
    "Still active",
  );
});

test("invalid global storage budget rejects rebuild before storage assembly", async (t) => {
  const f = await createPartitionBotFixture(t);
  const { bot } = await f.service.rebuildRuntimeConfig();
  await bot.session.applyTurnLifecycleEvent(firstSend());
  const { sessionDir } = await bot.session.locateSessionScope(identity);
  const head = await readFile(join(sessionDir, "CURRENT"));
  for (const [invalidBudget, reason] of [
    [undefined, "Invalid partition session storage budget fields"],
    [null, "Invalid partition session storage budget fields"],
    [{}, "Invalid partition session storage budget fields"],
    [{ ...f.budget, maxJournals: Number.MAX_SAFE_INTEGER + 1 }, "Invalid maxJournals"],
    [{ ...f.budget, unexpected: true }, "Invalid partition session storage budget fields"],
    [
      { ...f.budget, journalLimits: { ...f.budget.journalLimits, queueBytes: 1 } },
      "Inconsistent partition journal budgets",
    ],
    [
      {
        ...f.budget,
        journalLimits: { ...f.budget.journalLimits, transactionBytes: 1024, pageBytes: 2048 },
      },
      "Entity directory page budget requires fanout of at least four",
    ],
  ]) {
    f.setBudget(invalidBudget);
    await assert.rejects(f.service.rebuildRuntimeConfig(), {
      code: "CONFIG_VALIDATION_FAILED",
      details: { path: "partitionSessionStorage" },
      message: `invalid partitionSessionStorage: ${reason}`,
    });
    assert.equal(f.assemblyAttempts, 1);
    assert.equal(f.state.bot, bot);
    assert.deepEqual(await readFile(join(sessionDir, "CURRENT")), head);
  }
  await bot.session.renameSession({ ...identity, title: "Budget rejection preserved authority" });
  f.setBudget(f.budget);
  const { bot: next } = await f.service.rebuildRuntimeConfig();
  assert.equal(
    (await next.session.getSessionDisplayData(identity)).sessions[0].title,
    "Budget rejection preserved authority",
  );
});

test("real partition Bot exposes published display pages through tree and scoped access", async (t) => {
  const { service } = await createPartitionBotFixture(t);
  const { bot } = await service.rebuildRuntimeConfig();
  const authoritySessionId = "display-parent";
  await bot.session.createSession({
    ...identity,
    sessionId: authoritySessionId,
    parentSessionId: "",
    caller: SESSION_CALLER.USER,
  });
  await bot.session.applyTurnLifecycleEvent({
    ...firstSend(),
    parentSessionId: authoritySessionId,
  });
  const { userId, sessionId } = identity;
  const { sessionDir } = await bot.session.locateSessionScope(identity);
  const request = { sessionId, cursor: null, limit: 1, maxBytes: 4096, direction: "backward" };
  const readTree = (cursor) =>
    bot.session.getSessionDisplayPage({ userId, request: { ...request, cursor } });
  const readScoped = (cursor) =>
    bot.session.readScopedDisplayPage({
      userId,
      authoritySessionId,
      sessionDir,
      request: { ...request, cursor },
    });
  const startRequest = { ...request, terminalLimit: 1, reconcileTurnScopeIds: [] };
  const { nextCursor: treeCursor, ...tree } = await bot.session.getSessionDetailStart({
    userId,
    request: startRequest,
  });
  const { nextCursor: scopedCursor, ...scoped } = await bot.session.readScopedDetailStart({
    userId,
    authoritySessionId,
    sessionDir,
    request: startRequest,
  });
  assert.deepEqual(scoped, tree);
  assert.equal(tree.turnLifecycleSnapshot.activeTurnScopeId, firstSend().turnScopeId);
  assert.equal(tree.stats.messageCount, 1);
  assert.equal(tree.stats.displayMessageCount, 2);
  assert.ok(treeCursor);
  assert.ok(scopedCursor);
  assert.notDeepEqual(scopedCursor, treeCursor);
  await assert.rejects(readTree(scopedCursor), { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
  await assert.rejects(readScoped(treeCursor), { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
  await assert.rejects(
    bot.session.releaseScopedDisplayPage({
      userId,
      authoritySessionId,
      sessionDir,
      request: { sessionId, cursor: treeCursor },
    }),
    { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" },
  );
  assert.equal(tree.aggregateVersion, await bot.session.readSessionAggregateVersion(identity));
  const { nextCursor: releaseCursor } = await readScoped(null);
  const {
    messages: [row],
    nextCursor: contentSelectionCursor,
  } = await bot.session.getSessionDisplayPage({
    userId,
    request: { ...request, direction: "forward" },
  });
  await bot.session.releaseSessionDisplayPage({
    userId,
    request: { sessionId, cursor: contentSelectionCursor },
  });
  assert.equal(Object.hasOwn(row, "content"), false);
  const readContent = () =>
    bot.session.getSessionMessageContentPage({
      userId,
      sessionId,
      persistenceScope: null,
      messageUid: row.messageUid,
      expectedContentReference: row.contentReference,
      byteOffset: 0,
      maxBytes: row.contentBytes,
    });
  const content = await readContent();
  assert.equal(JSON.parse(Buffer.from(content.dataBase64, "base64").toString()), "分区 Bot input");
  const committed = await bot.session.deleteFromMessage({
    ...identity,
    commandId: "delete-retained-turn",
    expectedAggregateVersion: tree.aggregateVersion,
    anchor: { turnScopeId: firstSend().turnScopeId },
  });
  const current = await readTree(null);
  assert.ok(current.generation > tree.generation);
  assert.ok(current.aggregateVersion > tree.aggregateVersion);
  assert.equal(current.generation, committed.generation);
  assert.equal(current.aggregateVersion, committed.committedAggregateVersion);
  assert.equal(current.aggregateVersion, await bot.session.readSessionAggregateVersion(identity));
  assert.equal(current.stats.messageCount, 0);
  assert.equal(current.stats.displayMessageCount, 0);
  assert.equal(current.nextCursor, null);
  assert.deepEqual(await readScoped(null), current);
  const tail = await readTree(treeCursor);
  assert.deepEqual(await readScoped(scopedCursor), tail);
  assert.equal(tail.generation, tree.generation);
  assert.equal(tail.aggregateVersion, tree.aggregateVersion);
  assert.deepEqual(tail.stats, tree.stats);
  assert.deepEqual(tail.messages[0], row);
  await assert.rejects(readContent(), { code: "SESSION_MESSAGE_NOT_FOUND" });
  assert.equal(tail.nextCursor, null);
  assert.deepEqual(
    await bot.session.releaseScopedDisplayPage({
      userId,
      authoritySessionId,
      sessionDir,
      request: { sessionId, cursor: releaseCursor },
    }),
    { released: true },
  );
  await assert.rejects(readScoped(releaseCursor), { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
});

test("partition workspace maintenance drains admitted writes and retires only that workspace's pages", async (t) => {
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
  const readPage = (userId, cursor = null) =>
    bot.session.getSessionDisplayPage({ userId, request: { ...request, cursor } });
  const { nextCursor } = await readPage(identity.userId);
  const otherPage = await readPage(other.userId);
  assert.ok(nextCursor);
  assert.ok(otherPage.nextCursor);

  const entered = Promise.withResolvers();
  const resumeWrite = Promise.withResolvers();
  const title = "Last admitted write";
  const inFlight = bot.runWorkspaceOperation(identity.userId, async () => {
    entered.resolve();
    await resumeWrite.promise;
    return bot.session.renameSession({ ...identity, title });
  });
  await entered.promise;
  const snapshots = bot.sessionRuntime.repositories.sessionRepository.pageSnapshots;
  let maintenanceEntered = false;
  const maintenance = bot.sessionRuntime.workspaceAdmission.withMaintenance(identity.userId, () => {
    maintenanceEntered = true;
    assert.equal(snapshots.entries.size, 1);
  });
  try {
    await assert.rejects(bot.session.renameSession({ ...identity, title: "Rejected" }), {
      code: "WORKSPACE_MAINTENANCE",
    });
    await assert.rejects(readPage(identity.userId, nextCursor), { code: "WORKSPACE_MAINTENANCE" });
    await bot.session.renameSession({ ...other, title: "Other workspace remains writable" });
    assert.equal(maintenanceEntered, false);
  } finally {
    resumeWrite.resolve();
    await Promise.all([inFlight, maintenance]);
  }

  assert.equal(maintenanceEntered, true);
  await assert.rejects(readPage(identity.userId, nextCursor), {
    code: "SESSION_PAGE_SNAPSHOT_EXPIRED",
  });
  assert.equal(
    (await readPage(other.userId, otherPage.nextCursor)).generation,
    otherPage.generation,
  );
  assert.equal((await bot.session.getSessionDisplayData(identity)).sessions[0].title, title);
});

test("real partition Bot isolates a failed page snapshot release by workspace", async (t) => {
  const { service, workspaceRoot, budget, setBudget } = await createPartitionBotFixture(t);
  setBudget({ ...budget, maxJournals: 2 });
  const other = { ...identity, userId: "other-user" };
  await initializeUserWorkspace(workspaceRoot, other.userId);
  const { bot } = await service.rebuildRuntimeConfig();
  await bot.session.applyTurnLifecycleEvent(firstSend());
  await bot.session.applyTurnLifecycleEvent(firstSend(other));
  const { userId, sessionId } = identity;
  const request = { sessionId, cursor: null, limit: 1, maxBytes: 4096, direction: "backward" };
  const { nextCursor: cursor } = await bot.session.getSessionDisplayPage({ userId, request });
  assert.ok(cursor);
  const { sessionDir } = await bot.session.locateSessionScope(identity);
  const failure = new Error("page snapshot release failed");
  const releaseSnapshot = PartitionJournal.prototype.releaseSnapshot;
  const fault = t.mock.method(
    PartitionJournal.prototype,
    "releaseSnapshot",
    async function (snapshot) {
      if (this.root === sessionDir) throw failure;
      return releaseSnapshot.call(this, snapshot);
    },
  );
  const expected = { code: "SESSION_SNAPSHOT_RELEASE_UNCERTAIN", cause: failure };
  const selection = { userId, request: { sessionId, cursor } };
  try {
    await assert.rejects(bot.session.releaseSessionDisplayPage(selection), expected);
    await assert.rejects(bot.session.getSessionDisplayPage({ userId, request }), expected);
    const next = await bot.session.getSessionDisplayPage({ userId: other.userId, request });
    assert.ok(next.nextCursor);
    const tail = await bot.session.getSessionDisplayPage({
      userId: other.userId,
      request: { ...request, cursor: next.nextCursor },
    });
    assert.equal(tail.nextCursor, null);
  } finally {
    fault.mock.restore();
    assert.deepEqual(await bot.session.releaseSessionDisplayPage(selection), { released: true });
  }
  assert.ok((await bot.session.getSessionDisplayPage({ userId, request })).nextCursor);
});

test("real partition Bot reclaims a failed single-page reader without a release cursor", async (t) => {
  const { service } = await createPartitionBotFixture(t);
  const { bot } = await service.rebuildRuntimeConfig();
  await bot.session.applyTurnLifecycleEvent(firstSend());
  const { userId, sessionId } = identity;
  const { sessionDir } = await bot.session.locateSessionScope(identity);
  const request = { sessionId, cursor: null, limit: 2, maxBytes: 8192, direction: "backward" };
  const read = () => bot.session.getSessionDisplayPage({ userId, request });
  const snapshots = bot.sessionRuntime.sessionCrudService.sessionRepo.pageSnapshots;
  let now = 0;
  t.mock.method(snapshots, "now", () => now);
  const failure = new Error("single-page snapshot release failed");
  const releaseSnapshot = PartitionJournal.prototype.releaseSnapshot;
  const fault = t.mock.method(
    PartitionJournal.prototype,
    "releaseSnapshot",
    async function (snapshot) {
      if (this.root === sessionDir) throw failure;
      return releaseSnapshot.call(this, snapshot);
    },
  );
  const expected = { code: "SESSION_SNAPSHOT_RELEASE_UNCERTAIN", cause: failure };
  try {
    await assert.rejects(read(), expected);
    await assert.rejects(read(), expected);
    assert.equal(snapshots.entries.size, 1);
  } finally {
    fault.mock.restore();
  }
  now = snapshots.limits.idleMs;
  await snapshots.expire();
  assert.equal(snapshots.entries.size, 0);
  const page = await read();
  assert.equal(page.messages.length, 2);
  assert.equal(page.nextCursor, null);
  assert.equal(snapshots.entries.size, 0);
});

test("real Bot preserves Agent-owned scoped placement and replay across replacement", async (t) => {
  const { service } = await createPartitionBotFixture(t);
  const { bot } = await service.rebuildRuntimeConfig();
  await bot.session.applyTurnLifecycleEvent(firstSend());
  const allowedRoot = "runtime/agent/session";
  const turnScopeId = "child-turn";
  const request = {
    ...firstSend(),
    sessionId: "child",
    parentSessionId: identity.sessionId,
    turnScopeId,
    ...createAcceptedAgentExecution(turnScopeId, "child"),
    persistenceScope: createSessionPersistenceScope({
      scopeId: "agent:internal-turn:child-turn",
      parentSessionId: identity.sessionId,
      allowedRoot,
      relativeDir: `${allowedRoot}/child`,
    }),
  };
  const accepted = await bot.session.applyTurnLifecycleEvent(request);
  const { sessionDir } = await bot.session.locateSessionScope({
    userId: request.userId,
    sessionId: request.sessionId,
    persistenceScope: request.persistenceScope,
  });
  const scoped = await bot.session.readScopedSessionSnapshot({
    userId: identity.userId,
    authoritySessionId: identity.sessionId,
    sessionDir,
  });
  assert.equal(scoped.sessionSummary.sessionId, "child");
  assert.deepEqual(await bot.session.listSessionIds(identity), [identity.sessionId]);
  const head = await readFile(join(sessionDir, "CURRENT"));
  const { bot: next } = await service.rebuildRuntimeConfig();
  const replay = await next.session.applyTurnLifecycleEvent(request);
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.userMessage.messageUid, accepted.userMessage.messageUid);
  assert.deepEqual(await readFile(join(sessionDir, "CURRENT")), head);
  assert.deepEqual(
    await next.session.readScopedSessionSnapshot({
      userId: identity.userId,
      authoritySessionId: identity.sessionId,
      sessionDir,
    }),
    scoped,
  );
  assert.deepEqual(await next.session.listSessionIds(identity), [identity.sessionId]);
});

test("plugin session port reads a versioned body only under its committed parent", async (t) => {
  const pluginId = "workflow";
  const scopedSessionRoots = resolveScopedSessionRoots([
    { pluginId, scopedSessionRoots: ["session"] },
  ]);
  const { service } = await createPartitionBotFixture(t, {
    assemble: (config, dependencies) =>
      createConfiguredSessionRuntime(config, { ...dependencies, scopedSessionRoots }),
  });
  const { bot } = await service.rebuildRuntimeConfig();
  const { userId, sessionId: authoritySessionId } = identity;
  await bot.session.applyTurnLifecycleEvent(firstSend());
  await bot.session.applyTurnLifecycleEvent(firstSend({ ...identity, sessionId: "other-root" }));
  const sessionId = "plugin-child";
  const segments = ["session", authoritySessionId, "dialog-directory"];
  const persistenceScope = createSessionPersistenceScope({
    scopeId: "agent:internal-turn:plugin-child",
    parentSessionId: authoritySessionId,
    allowedRoot: resolvePluginDataRelativePath(pluginId, "session"),
    relativeDir: resolvePluginDataRelativePath(pluginId, ...segments),
  });
  const accepted = await bot.session.applyTurnLifecycleEvent({
    ...firstSend({ userId, sessionId, persistenceScope }),
    parentSessionId: authoritySessionId,
  });
  const { sessionDir } = await bot.session.locateSessionScope({
    userId,
    sessionId,
    persistenceScope,
  });
  const {
    messages: [row],
    nextCursor,
  } = await bot.session.readScopedDisplayPage({
    userId,
    authoritySessionId,
    sessionDir,
    request: { sessionId, direction: "forward", cursor: null, limit: 1, maxBytes: 4096 },
  });
  await bot.session.releaseScopedDisplayPage({
    userId,
    authoritySessionId,
    sessionDir,
    request: { sessionId, cursor: nextCursor },
  });
  assert.equal(row.messageUid, accepted.userMessage.messageUid);
  const sessions = createPluginServicePorts({ bot, translateText: (key) => key }).sessions;
  const contributes = { agent: { scopedSessionRoots: ["session"] } };
  const port = sessions.forPlugin({ id: pluginId, contributes });
  const request = {
    messageUid: row.messageUid,
    byteOffset: 0,
    maxBytes: row.contentBytes,
    expectedContentReference: row.contentReference,
  };
  const selection = { userId, authoritySessionId, sessionId, segments, request };
  const body = await port.readMessageContentPage(selection);
  assert.equal(
    JSON.parse(Buffer.from(body.dataBase64, "base64").toString()),
    accepted.userMessage.content,
  );
  await assert.rejects(
    port.readMessageContentPage({ ...selection, authoritySessionId: "other-root" }),
    {
      code: "SESSION_NOT_FOUND",
    },
  );
  await assert.rejects(port.readMessageContentPage({ ...selection, sessionId: "other-child" }), {
    code: "SESSION_NOT_FOUND",
  });
  await assert.rejects(
    sessions.forPlugin({ id: "other-plugin" }).readMessageContentPage(selection),
    {
      code: "SESSION_NOT_FOUND",
    },
  );
  await assert.rejects(
    port.readMessageContentPage({
      ...selection,
      request: { ...request, expectedContentReference: "stale-version" },
    }),
    { code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT" },
  );
  await assert.rejects(
    port.readMessageContentPage({
      ...selection,
      request: { ...request, messageUid: "unknown-message" },
    }),
    { code: "SESSION_MESSAGE_NOT_FOUND" },
  );

  const deleted = await bot.session.deleteSessionBranch(
    { userId, sessionIds: [authoritySessionId] },
    executeEmptySessionCleanup,
  );
  assert.deepEqual(deleted.deletedSessionIds, [authoritySessionId, sessionId]);
  await assert.rejects(stat(sessionDir), { code: "ENOENT" });
  assert.deepEqual(await bot.session.listSessionIds({ userId }), ["other-root"]);
});

test("real Bot rebuild and HTTP preserve partition authority, first-send replay and retained reads", async (t) => {
  const { service, access, state } = await createPartitionBotFixture(t);
  const { bot } = await service.rebuildRuntimeConfig();
  assert.ok(bot instanceof BotManager);
  const accepted = await bot.session.applyTurnLifecycleEvent(firstSend());
  const { sessionDir } = await bot.session.locateSessionScope(identity);
  const head = await readFile(join(sessionDir, "CURRENT"));
  for (const file of ["head.json", "immutable-session.format", "session.json"])
    await assert.rejects(stat(join(sessionDir, file)), { code: "ENOENT" });

  const app = express();
  registerSessionRoutes(app, {
    bot: access,
    runBotOperation: access.runOperation,
    translateText: (key) => key,
  });
  await withTestServer(app, async (baseUrl) => {
    const url = `${baseUrl}/internal/session/user/session`;
    const initial = await fetch(url);
    assert.equal(initial.status, 200);
    const detail = await initial.json();
    const repository = bot.sessionRuntime.repositories.sessionRepository;
    await using reader = await repository.requireSessionReader(
      identity.userId,
      identity.sessionId,
      {
        persistenceContext: bot.sessionRuntime.createSessionPersistenceContext(identity),
      },
    );
    const closing = Promise.withResolvers();
    const close = bot.close.bind(bot);
    bot.close = () => {
      closing.resolve();
      return close();
    };
    const rebuilding = service.rebuildRuntimeConfig();
    await closing.promise;
    try {
      assert.equal(state.bot, bot);
      assert.equal((await reader.readMetadata()).sessionId, identity.sessionId);
      const rejected = await fetch(url);
      assert.equal(rejected.status, 503);
      assert.equal((await rejected.json()).errorCode, "RUNTIME_CLOSED");
    } finally {
      await reader.close();
    }
    const { bot: next } = await rebuilding;
    assert.ok(next instanceof BotManager);
    assert.notEqual(next, bot);
    const replay = await next.session.applyTurnLifecycleEvent(firstSend());
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.userMessage.messageUid, accepted.userMessage.messageUid);
    assert.deepEqual(await readFile(join(sessionDir, "CURRENT")), head);
    const reopened = await fetch(url);
    assert.equal(reopened.status, 200);
    assert.deepEqual(await reopened.json(), detail);
    await assert.rejects(bot.runSession({}), { code: "RUNTIME_CLOSED" });
    await next.session.renameSession({ ...identity, title: "Reopened partition" });
    assert.equal(
      (await next.session.getSessionDisplayData(identity)).sessions[0].title,
      "Reopened partition",
    );
  });
});

for (const replace of [false, true]) {
  const route = replace ? "replace-turn" : "delete-from";
  const requestMutation = replace ? replaceSessionTurnApi : deleteSessionMessagesFromApi;
  const requireMutation = replace ? requireTurnReplaceResponse : requireMessageDeleteResponse;

  test(`partition Bot HTTP ${route} exposes rows and complete statistics at the committed generation`, async (t) => {
    const { service, access } = await createPartitionBotFixture(t);
    const { bot } = await service.rebuildRuntimeConfig();
    const turns = ["keep", "remove"].map((id) => ({
      role: "user",
      messageOrigin: "natural",
      messageUid: `message-${id}`,
      userMessageId: `um-${id}`,
      content: id,
      dialogProcessId: `dialog-${id}`,
      turnScopeId: id,
      attachments: [],
      transferEnvelopes: [],
    }));
    await bot.session.createSession({
      ...identity,
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    await bot.session.appendTurns({ ...identity, turns });
    const app = express();
    app.use(express.json());
    registerSessionRoutes(app, {
      bot: access,
      runBotOperation: access.runOperation,
      translateText: (key) => key,
    });
    await withTestServer(app, async (baseUrl) => {
      const authFetch = (path, options) =>
        fetch(`${baseUrl}${path.replace(/^\/api\//, "/")}`, options);
      const session = {
        sessionId: identity.sessionId,
        knownGeneration: null,
        aggregateVersion: 0,
        messages: [],
        sessionDocs: [],
      };
      const sessions = { value: [session] };
      const { fetchSessionDetail } = createSessionDetailRequests({
        sessions,
        activeSessionId: { value: identity.sessionId },
        userId: { value: identity.userId },
        authFetch,
        getSessionDetailApi,
        isSameSessionIdentity: (left, right) => left === right,
      });
      const { applySessionDetail } = createSessionDetailApplicator({
        sessions,
        chatStore: { applyTurnTimingSnapshot() {} },
        makeViewMessage: (value) => ({ ...value }),
        onSessionDetailApplied() {},
      });
      const applySessionMutation = createSessionMutationApplicator({
        sessions,
        applySessionDetail,
        fetchSessionDetail,
      });
      const readDetail = () =>
        fetchSessionDetail(identity.sessionId, { source: "integration", requireFresh: true });
      const initial = await readDetail();
      applySessionDetail(initial);
      const before = selectMainSessionDetailEntry(initial);
      assert.equal(
        await bot.session.readSessionAggregateVersion(identity),
        before.aggregateVersion,
      );
      assert.equal(before.stats.displayMessageCount, 2);
      const command = {
        userId: identity.userId,
        sessionId: identity.sessionId,
        parentSessionId: "",
        commandId: route,
        expectedAggregateVersion: before.aggregateVersion,
        anchor: { turnScopeId: "remove" },
        ...(replace ? { newContent: "edited", turnScopeId: "replacement", attachments: [] } : {}),
      };
      async function mutate() {
        const response = await requestMutation(command, { fetcher: authFetch });
        const { ok: _envelopeOk, ...body } = await readApiResponseEnvelope(response);
        return requireMutation(body);
      }
      const committed = await mutate();
      assert.equal(committed.deduplicated, false);
      assert.equal(committed.projection.generation, before.generation + 1);
      assert.equal(await applySessionMutation(committed), true);
      const after = selectMainSessionDetailEntry(await readDetail());
      assert.equal(after.generation, committed.projection.generation);
      assert.equal(after.generation, committed.generation);
      assert.equal(after.aggregateVersion, committed.committedAggregateVersion);
      assert.equal(
        await bot.session.readSessionAggregateVersion(identity),
        committed.committedAggregateVersion,
      );
      const expectedMessages = replace ? ["keep", "edited"] : ["keep"];
      assert.deepEqual(
        after.messages.map(({ content }) => content),
        expectedMessages,
      );
      assert.deepEqual(
        session.messages.map(({ content }) => content),
        expectedMessages,
      );
      assert.equal(session.knownGeneration, after.generation);
      assert.equal(session.aggregateVersion, after.aggregateVersion);
      assert.deepEqual(
        selectMainSessionDetailEntry({ ...initial, sessions: session.sessionDocs }),
        after,
      );
      assert.equal(after.messages[0].messageUid, before.messages[0].messageUid);
      assert.equal(after.stats.messageCount, after.messages.length);
      assert.equal(after.stats.displayMessageCount, after.messages.length);

      await service.rebuildRuntimeConfig();
      assert.deepEqual(await mutate(), { ...committed, deduplicated: true });
      assert.deepEqual(selectMainSessionDetailEntry(await readDetail()), after);
    });
  });
}
