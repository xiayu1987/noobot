/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { upgradeImmutableContextIndexes } from "../../src/session/session-artifact-session/immutable-context-index-upgrade.js";

export function registerImmutableContextRepositoryTests({ fixture, message, ts }) {
  test("context history uses indexed dialogs and pins its committed generation", async (t) => {
    const { repository, persistenceContext, scope } = await fixture(t);
    const initial = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    await repository.commitChanges("u1", "s1", {
      persistenceContext,
      expectedGeneration: initial.generation,
      operationId: "history",
      committedAt: ts,
      changes: {
        messages: [1, 2, 3].map((number) => ({
          ...message(`m${number}`),
          dialogProcessId: `d${number}`,
          turnScopeId: `t${number}`,
        })),
      },
    });
    const pinned = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    await writeFile(scope.sessionFile, "invalid legacy manifest");
    const query = {
      persistenceContext,
      scope: { dialogProcessId: "d3", turnScopeId: "t3" },
      historyLimit: 1,
    };
    const source = await repository.requireContextSource("u1", "s1", query);
    assert.deepEqual(
      source.messages.map((item) => item.messageUid),
      ["m2"],
    );
    await repository.commitChanges("u1", "s1", {
      persistenceContext,
      expectedGeneration: pinned.generation,
      operationId: "later-history",
      committedAt: ts,
      changes: { messages: [{ ...message("m4"), dialogProcessId: "d4", turnScopeId: "t4" }] },
    });
    assert.deepEqual(
      (await pinned.readContextSource(query)).messages.map((item) => item.messageUid),
      ["m2"],
    );
    assert.deepEqual(
      (await repository.requireContextSource("u1", "s1", query)).messages.map(
        (item) => item.messageUid,
      ),
      ["m4"],
    );
    assert.deepEqual((await pinned.readContextSource({ ...query, historyLimit: 0 })).messages, []);
    await assert.rejects(pinned.readContextSource({ ...query, historyLimit: -1 }), /nonnegative/);
  });

  test("offline context index upgrade publishes its version with rebuilt indexes", async (t) => {
    const { repository, persistenceContext, scope } = await fixture(t);
    const initial = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    await repository.commitChanges("u1", "s1", {
      persistenceContext,
      expectedGeneration: initial.generation,
      operationId: "seed-upgrade",
      committedAt: ts,
      changes: { messages: [message("m1")] },
    });
    const store = new ImmutableSessionStore({ sessionDir: scope.sessionDir, sessionId: "s1" });
    const head = await store.snapshot();
    const facts = await store.get(head, "metadata", "facts");
    delete facts.contextIndexVersion;
    await store.commit({
      expectedGeneration: head.generation,
      operationId: "pre-index-version",
      changes: [
        { collection: "metadata", key: "facts", value: facts },
        { collection: "dialogOrder", key: "0000000000000001", remove: true },
        { collection: "dialogTurns", key: "d1", remove: true },
      ],
    });
    await writeFile(scope.sessionFile, "invalid legacy manifest");
    const pinned = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    const query = { scope: {}, historyLimit: 1 };
    await assert.rejects(pinned.readContextSource(query), {
      code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
    });
    const upgrade = { sessionDir: scope.sessionDir, sessionId: "s1" };
    assert.equal((await upgradeImmutableContextIndexes(upgrade)).result.upgraded, true);
    const reader = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    assert.deepEqual(
      (await reader.readContextSource(query)).messages.map((item) => item.messageUid),
      ["m1"],
    );
    assert.equal((await upgradeImmutableContextIndexes(upgrade)).aborted, true);
    assert.equal((await store.snapshot()).generation, reader.generation);
    await assert.rejects(pinned.readContextSource(query), {
      code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
    });
  });
}

export function registerImmutableLifecycleRepositoryTests({ fixture, ts }) {
  test("business lifecycle and timing publish only deltas and preserve accepted command replay", async (t) => {
    const { runtime, repository, persistenceContext, scope } = await fixture(t);
    await writeFile(scope.sessionFile, "invalid legacy manifest");
    repository.requireTurnView = () => assert.fail("lifecycle must not open the legacy view");
    repository.saveTurnView = () => assert.fail("lifecycle must not save the legacy view");
    const service = runtime.sessionMessageService;
    const request = {
      userId: "u1",
      sessionId: "s1",
      persistenceContext,
      sessionCaller: SESSION_CALLER.USER,
      eventType: "turn.action_accepted",
      phase: "action",
      action: "send",
      turnScopeId: "t1",
      presentationMessageId: "p1",
      commandId: "accept",
      causationId: "accept",
      executionId: "agent:t1",
      executionKind: "agent",
      rootExecutionId: "agent:t1",
      userMessage: { userMessageId: "um1", content: "hello", messageOrigin: "natural" },
    };
    const result = await service.applyTurnLifecycleEvent(request);
    assert.equal(result.applied, true);
    assert.equal(result.aggregateVersion, 1);
    assert.ok(result.dialogProcessId);
    const run = await runtime.sessionCrudService.getSessionRunContext({
      userId: "u1",
      sessionId: "s1",
      persistenceContext,
      turnScopeId: "t1",
      dialogProcessId: result.dialogProcessId,
    });
    assert.equal(run.startedAt, ts);
    assert.equal(run.sessionDir, scope.sessionDir);
    const terminalQuery = {
      userId: "u1",
      sessionId: "s1",
      persistenceContext,
      turnScopeId: "t1",
      commandId: "query-terminal",
    };
    assert.equal(
      (await runtime.sessionCrudService.resolveTurnTerminalState(terminalQuery)).reason,
      "turn_not_terminal",
    );
    assert.equal(
      (
        await runtime.sessionCrudService.resolveTurnTerminalState({
          ...terminalQuery,
          turnScopeId: "absent",
        })
      ).reason,
      "turn_not_found",
    );
    await assert.rejects(
      runtime.sessionCrudService.getSessionRunContext({
        userId: "u1",
        sessionId: "s1",
        persistenceContext,
        turnScopeId: "t1",
        dialogProcessId: "wrong",
      }),
    );
    const pinned = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    assert.equal((await pinned.readMetadata()).aggregateVersion, result.aggregateVersion);
    assert.equal((await pinned.readFacts()).messageCount, 1);
    assert.equal(
      (await pinned.readMessage(result.userMessage.messageUid)).message.content,
      "hello",
    );
    const replay = await service.applyTurnLifecycleEvent(request);
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.userMessage.messageUid, result.userMessage.messageUid);
    const afterReplay = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    assert.equal(afterReplay.generation, pinned.generation);
    const timing = {
      userId: "u1",
      sessionId: "s1",
      persistenceContext,
      turnScopeId: "t1",
      dialogProcessId: result.dialogProcessId,
      thinkingFinishedAt: ts,
    };
    assert.equal((await service.upsertTurnTiming(timing)).upserted, true);
    assert.equal((await service.upsertTurnTiming(timing)).reason, "unchanged");
    const current = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    assert.equal(await pinned.readTurnTiming("t1"), null);
    assert.equal((await current.readTurnTiming("t1")).thinkingFinishedAt, ts);
    assert.equal(current.generation, pinned.generation + 1);
    assert.equal((await current.readOutboxPage({ consumerId: "websocket" })).events.length, 1);
    const source = await current.readLifecycleSource();
    assert.equal(source.aggregateVersion, result.aggregateVersion);
    assert.deepEqual(source.messageTurnScopeIds, ["t1"]);
    assert.deepEqual(source.turnLifecycle.turns.t1, await current.readTurnState("t1"));
    assert.equal(source.turnLifecycle.activeTurnScopeId, "t1");
    assert.equal(source.turnTimings[0].thinkingFinishedAt, ts);
    assert.deepEqual((await pinned.readLifecycleSource()).turnTimings, []);
    const snapshot = await service.getTurnLifecycleSnapshot({
      userId: "u1",
      sessionId: "s1",
      persistenceContext,
      commandId: "snapshot",
      knownSequence: 0,
      terminalLimit: 10,
      resolveRecovery: async (active) => {
        assert.equal(active.turnScopeId, "t1");
        return "none";
      },
    });
    assert.equal(snapshot.found, true);
    assert.equal(snapshot.snapshot.activeTurn.turnScopeId, "t1");
  });
}
