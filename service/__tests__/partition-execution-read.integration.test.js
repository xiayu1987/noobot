/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { TURN_EVENT, TURN_PHASE, TURN_STATE } from "@noobot/session-protocol";
import {
  createPartitionBotFixture,
  firstSend,
  identity,
} from "./partition-bot-assembly.test-helpers.js";

test("execution reads observe lifecycle-only partition commits without session metadata changes", async (t) => {
  const { service } = await createPartitionBotFixture(t);
  const { bot } = await service.rebuildRuntimeConfig();
  const first = firstSend();
  const accepted = await bot.session.applyTurnLifecycleEvent(first);
  const query = { userId: identity.userId, executionId: first.executionId };
  const initial = await bot.session.getExecution(query);
  assert.equal(initial.execution.state, TURN_STATE.ACTION_REQUESTING);
  const repo = bot.sessionRuntime.repositories.sessionRepository;
  const context = bot.sessionRuntime.createSessionPersistenceContext(identity);
  const open = () =>
    repo.requireSessionReader(identity.userId, identity.sessionId, { persistenceContext: context });
  await using before = await open();
  const started = await bot.session.applyTurnLifecycleEvent({
    ...identity,
    turnScopeId: first.turnScopeId,
    dialogProcessId: accepted.dialogProcessId,
    presentationMessageId: first.presentationMessageId,
    eventType: TURN_EVENT.PROCESSING_STARTED,
    commandId: "processing-started",
    causationId: "processing-started",
    expectedRevision: accepted.turn.revision,
    phase: TURN_PHASE.PROCESSING,
  });
  assert.equal(started.applied, true);
  await using after = await open();
  assert.ok(after.generation > before.generation);
  assert.deepEqual(await after.readMetadata(), await before.readMetadata());
  const persisted = await after.readTurnState(first.turnScopeId);
  assert.equal(persisted.state, TURN_STATE.PROCESSING);
  const refreshed = await bot.session.getExecution(query);
  assert.equal(refreshed.execution.state, persisted.state);
  assert.equal(refreshed.execution.revision, persisted.revision);
});
