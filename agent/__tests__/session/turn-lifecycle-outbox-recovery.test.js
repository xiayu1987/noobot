/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFile, rename } from "node:fs/promises";
import { TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol";
import { createSessionFacade } from "../../src/session/index.js";
import { createTestSessionServices } from "../helpers/session-services.js";
import { buildHarness } from "./scoped-session-repositories.fixtures.js";
import { event, deliveryReceiptOf } from "./turn-lifecycle-session-contract.test-helpers.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";

const owner = { userId: "alice", sessionId: "outbox-recovery", persistenceScope: null };
const consumerId = "test-authority-consumer";
const action = () => ({
  ...event(TURN_EVENT.ACTION_ACCEPTED, "accepted", 0, {
    action: "send",
    phase: TURN_PHASE.ACTION,
  }),
  ...owner,
});
const terminal = () => ({
  ...event(TURN_EVENT.COMPLETED, "completed", 3, {
    phase: TURN_PHASE.COMPLETION,
    terminalStatus: { command: "completed" },
  }),
  ...owner,
});

async function setup(t) {
  const harness = buildHarness();
  const state = await harness.setup();
  t.after(() => harness.cleanup());
  const persistenceContext = state.sessionRepo.treePersistenceContext(
    owner.userId,
    owner.sessionId,
  );
  await state.sessionRepo.ensureSession({
    userId: owner.userId,
    sessionId: owner.sessionId,
    parentSessionId: "",
    caller: "user",
    persistenceContext,
  });
  const scope = await state.sessionRepo.requireSessionScope(
    owner.userId,
    owner.sessionId,
    persistenceContext,
  );
  return {
    ...state,
    ...scope,
    headPath: path.join(scope.sessionDir, "head.json"),
    facade: createSessionFacade(state.runtime),
    restart: () => createSessionFacade(createTestSessionServices({ workspaceRoot: state.root })),
  };
}

async function processTurn(facade) {
  const accepted = await facade.applyTurnLifecycleEvent(action());
  assert.equal(accepted.applied, true);
  const dialogProcessId = accepted.dialogProcessId;
  for (const [eventType, commandId, expectedRevision, phase, extra] of [
    [TURN_EVENT.PROCESSING_STARTED, "started", 1, TURN_PHASE.PROCESSING, {}],
    [
      TURN_EVENT.PROCESSING_COMPLETED,
      "processed",
      2,
      TURN_PHASE.COMPLETION,
      { completionCommitId: "completed" },
    ],
  ]) {
    const result = await facade.applyTurnLifecycleEvent({
      ...event(eventType, commandId, expectedRevision, { phase, ...extra }),
      ...owner,
      dialogProcessId,
    });
    assert.equal(result.applied, true, JSON.stringify(result));
  }
  return dialogProcessId;
}

for (const stage of ["acceptance", "terminal"]) {
  test(`committed ${stage} recovers its original outbox event after a lost response`, async (t) => {
    const h = await setup(t);
    const dialogProcessId = stage === "terminal" ? await processTurn(h.facade) : null;
    const request = stage === "terminal" ? { ...terminal(), dialogProcessId } : action();
    const targetSequence = stage === "terminal" ? 4 : 1;
    let blocked = false;
    setFsAdapter({
      async rename(source, target) {
        await rename(source, target);
        if (target === h.headPath) {
          blocked = true;
          throw new Error("injected response failure after head publication");
        }
      },
    });
    try {
      await assert.rejects(h.facade.applyTurnLifecycleEvent(request), {
        code: "SESSION_COMMIT_UNCERTAIN",
      });
    } finally {
      resetFsAdapter();
    }
    assert.equal(blocked, true);
    const bytes = await readFile(h.headPath, "utf8");
    const reader = await h.sessionRepo.requireSessionReader(owner.userId, owner.sessionId, {
      persistenceContext: h.sessionRepo.treePersistenceContext(owner.userId, owner.sessionId),
    });
    const receipt = await reader.readCommand(request.commandId);
    assert.equal((await reader.readLifecycleHead()).sequence, targetSequence);
    const expectedEnvelope = (await reader.readOutboxEvent(receipt.eventId)).envelope;
    assert.equal(Object.hasOwn(receipt, "envelope"), false);
    const restarted = h.restart();
    const pending = await restarted.getPendingAuthorityEvents({ ...owner, consumerId });
    assert.equal(pending.events.length, targetSequence);
    assert.deepEqual(pending.events.at(-1).envelope, expectedEnvelope);
    const replay = await restarted.applyTurnLifecycleEvent(request);
    assert.equal(replay.deduplicated, true);
    assert.deepEqual(replay.envelope, expectedEnvelope);
    assert.equal(await readFile(h.headPath, "utf8"), bytes);
  });
}

for (const stage of ["acceptance", "terminal"]) {
  test(`a failed ${stage} head publication never publishes an uncommitted lifecycle event`, async (t) => {
    const h = await setup(t);
    const dialogProcessId = stage === "terminal" ? await processTurn(h.facade) : null;
    const request = stage === "terminal" ? { ...terminal(), dialogProcessId } : action();
    const before = await readFile(h.headPath, "utf8");
    const beforeOutbox = (await h.facade.getPendingAuthorityEvents({ ...owner, consumerId }))
      .events;
    let injected = false;
    setFsAdapter({
      async rename(source, target) {
        if (target === h.headPath) {
          injected = true;
          throw new Error("injected head failure");
        }
        return rename(source, target);
      },
    });
    try {
      await assert.rejects(h.facade.applyTurnLifecycleEvent(request), {
        code: "SESSION_COMMIT_UNCERTAIN",
      });
    } finally {
      resetFsAdapter();
    }
    assert.equal(injected, true);
    assert.equal(await readFile(h.headPath, "utf8"), before);
    assert.deepEqual(
      (await h.restart().getPendingAuthorityEvents({ ...owner, consumerId })).events,
      beforeOutbox,
    );
  });
}

for (const stage of ["acceptance", "terminal"]) {
  test(
    `a process killed after ${stage} head commit recovers without rerunning the command`,
    { timeout: 20000 },
    async (t) => {
      const h = await setup(t);
      const dialogProcessId = stage === "terminal" ? await processTurn(h.facade) : null;
      const request = stage === "terminal" ? { ...terminal(), dialogProcessId } : action();
      const targetSequence = stage === "terminal" ? 4 : 1;
      const beforeEvents = (await h.facade.getPendingAuthorityEvents({ ...owner, consumerId }))
        .events;
      const servicesUrl = new URL("../helpers/session-services.js", import.meta.url).href;
      const facadeUrl = new URL("../../src/session/index.js", import.meta.url).href;
      const adapterUrl = new URL("../../src/shared/storage/fs-adapter.js", import.meta.url).href;
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          import.meta.resolve("@noobot/shared/testing/runtime-params"),
          "--input-type=module",
          "-e",
          `
    import { createTestSessionServices } from ${JSON.stringify(servicesUrl)};
    import { createSessionFacade } from ${JSON.stringify(facadeUrl)};
    import { setFsAdapter } from ${JSON.stringify(adapterUrl)};
    import { rename } from "node:fs/promises";
    const runtime = createTestSessionServices({ workspaceRoot: process.argv[1] });
    setFsAdapter({ rename: async (source, target) => {
      await rename(source, target);
      if (target === process.argv[2]) process.kill(process.pid, "SIGKILL");
    }});
    await createSessionFacade(runtime).applyTurnLifecycleEvent(JSON.parse(process.argv[3]));
  `,
          h.root,
          h.headPath,
          JSON.stringify(request),
          String(targetSequence),
        ],
        { encoding: "utf8", timeout: 15000 },
      );
      assert.equal(child.error, undefined, child.stderr);
      assert.equal(child.signal, "SIGKILL", child.stderr);
      const bytes = await readFile(h.headPath, "utf8");
      const restarted = h.restart();
      const pending = await restarted.getPendingAuthorityEvents({ ...owner, consumerId });
      assert.equal(pending.events.length, targetSequence);
      assert.deepEqual(pending.events.slice(0, -1), beforeEvents);
      const replay = await restarted.applyTurnLifecycleEvent(request);
      assert.equal(replay.deduplicated, true);
      assert.deepEqual(replay.envelope, pending.events.at(-1).envelope);
      assert.equal(await readFile(h.headPath, "utf8"), bytes);
    },
  );
}

test("compacted lifecycle events are not recreated from receipts", async (t) => {
  const h = await setup(t);
  const accepted = await h.facade.applyTurnLifecycleEvent(action());
  const receipt = deliveryReceiptOf(accepted.envelope);
  const acknowledged = await h.facade.acknowledgeAuthorityEvents({
    ...owner,
    consumerId,
    acknowledgements: [receipt],
  });
  assert.equal(acknowledged.acknowledged, true, JSON.stringify(acknowledged));
  assert.equal(acknowledged.delivered, 1);
  const compacted = await h.facade.compactAuthorityEvents({
    ...owner,
    retainDeliveredAfter: "2999-01-01T00:00:00.000Z",
  });
  assert.equal(compacted.removed, 1, JSON.stringify(compacted));
  assert.deepEqual((await h.facade.getPendingAuthorityEvents({ ...owner, consumerId })).events, []);
  const started = await h.facade.applyTurnLifecycleEvent({
    ...event(TURN_EVENT.PROCESSING_STARTED, "started", 1, { phase: TURN_PHASE.PROCESSING }),
    ...owner,
    dialogProcessId: accepted.dialogProcessId,
  });
  const delivered = await h.facade.acknowledgeAuthorityEvents({
    ...owner,
    consumerId,
    acknowledgements: [deliveryReceiptOf(started.envelope)],
  });
  assert.equal(delivered.delivered, 1);
  const removed = await h.facade.compactAuthorityEvents({
    ...owner,
    retainDeliveredAfter: "2999-01-01T00:00:00.000Z",
  });
  assert.equal(removed.removed, 1);
  const replay = await h.restart().applyTurnLifecycleEvent(action());
  assert.equal(replay.deduplicated, true);
  assert.deepEqual(
    (await h.restart().getPendingAuthorityEvents({ ...owner, consumerId })).events,
    [],
  );
});

test("later lifecycle commits preserve the original undelivered event and command receipt", async (t) => {
  const h = await setup(t);
  const accepted = await h.facade.applyTurnLifecycleEvent(action());
  await h.facade.applyTurnLifecycleEvent({
    ...event(TURN_EVENT.PROCESSING_STARTED, "started", 1, { phase: TURN_PHASE.PROCESSING }),
    ...owner,
    dialogProcessId: accepted.dialogProcessId,
  });
  const restarted = h.restart();
  const before = await readFile(h.headPath, "utf8");
  const replay = await restarted.applyTurnLifecycleEvent(action());
  assert.equal(replay.deduplicated, true);
  assert.deepEqual(replay.envelope, accepted.envelope);
  const pending = await restarted.getPendingAuthorityEvents({ ...owner, consumerId });
  assert.equal(pending.events.length, 2);
  assert.deepEqual(pending.events[0].envelope, accepted.envelope);
  assert.equal(await readFile(h.headPath, "utf8"), before);
});

test("restarted lifecycle and outbox reject conflicting identities without changing committed state", async (t) => {
  const h = await setup(t);
  const accepted = await h.facade.applyTurnLifecycleEvent(action());
  const restarted = h.restart();
  const before = await readFile(h.headPath, "utf8");
  const pending = await restarted.getPendingAuthorityEvents({ ...owner, consumerId });
  const conflict = await restarted.applyTurnLifecycleEvent({ ...action(), action: "continue" });
  assert.equal(conflict.reason, "idempotency_key_reused");
  assert.equal(await readFile(h.headPath, "utf8"), before);
  const receipt = deliveryReceiptOf(accepted.envelope);
  for (const change of [
    { sequence: receipt.sequence + 1 },
    { orderingScopeId: "foreign-session" },
    { orderingDomain: "foreign-domain" },
  ]) {
    await assert.rejects(
      restarted.acknowledgeAuthorityEvents({
        ...owner,
        consumerId,
        acknowledgements: [{ ...receipt, ...change }],
      }),
      { code: "AUTHORITY_OUTBOX_INTEGRITY_INVALID" },
    );
    assert.equal(await readFile(h.headPath, "utf8"), before);
    assert.deepEqual(await restarted.getPendingAuthorityEvents({ ...owner, consumerId }), pending);
  }
});
