/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol";
import { projectCommittedTurnOutbox } from "@noobot/event-protocol/turn-outbox";
import { createEmptyAuthorityOutboxCheckpoint } from "@noobot/event-protocol/outbox";
import { createSessionFacade } from "../../src/session/index.js";
import { createTestSessionServices } from "../helpers/session-services.js";
import {
  authorityOutboxJournalPath,
  readAuthorityOutbox,
  readAuthorityOutboxRecords,
  removeAuthorityOutboxTurnScopes,
} from "../../src/session/authority-outbox-store/outbox-journal.js";
import { buildHarness } from "./scoped-session-repositories.fixtures.js";
import { event, deliveryReceiptOf } from "./turn-lifecycle-session-contract.test-helpers.js";

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
  test(`saved ${stage} recovers its original outbox event after projection failure`, async (t) => {
    const h = await setup(t);
    const dialogProcessId = stage === "terminal" ? await processTurn(h.facade) : null;
    const request = stage === "terminal" ? { ...terminal(), dialogProcessId } : action();
    const targetSequence = stage === "terminal" ? 4 : 1;
    const journal = authorityOutboxJournalPath(h.sessionDir);
    await mkdir(path.dirname(journal), { recursive: true });
    const beforeJournal = await readAuthorityOutboxRecords(h.sessionDir);
    let blocked = false;
    const write = h.storageService.writeJsonAtomic.bind(h.storageService);
    h.storageService.writeJsonAtomic = async (file, payload) => {
      const result = await write(file, payload);
      if (file === h.sessionFile && payload.turnLifecycle.sequence === targetSequence) {
        if (beforeJournal.length) await rename(journal, `${journal}.saved`);
        await mkdir(journal);
        blocked = true;
      }
      return result;
    };
    await assert.rejects(h.facade.applyTurnLifecycleEvent(request), { code: "EISDIR" });
    assert.equal(blocked, true);
    h.storageService.writeJsonAtomic = write;
    await rm(journal, { recursive: true });
    if (beforeJournal.length) await rename(`${journal}.saved`, journal);
    const bytes = await readFile(h.sessionFile, "utf8");
    const manifest = JSON.parse(bytes);
    const receipt = manifest.turnLifecycle.commandReceipts.at(-1);
    assert.equal(manifest.turnLifecycle.sequence, targetSequence);
    assert.equal((await readAuthorityOutboxRecords(h.sessionDir)).length, beforeJournal.length);
    const restarted = h.restart();
    const pending = await restarted.getPendingAuthorityEvents({ ...owner, consumerId });
    assert.equal(pending.events.length, targetSequence);
    assert.deepEqual(pending.events.at(-1).envelope, receipt.envelope);
    const journalAfterRecovery = await readFile(journal, "utf8");
    const replay = await restarted.applyTurnLifecycleEvent(request);
    assert.equal(replay.deduplicated, true);
    assert.deepEqual(replay.envelope, receipt.envelope);
    assert.equal(await readFile(h.sessionFile, "utf8"), bytes);
    assert.equal(await readFile(journal, "utf8"), journalAfterRecovery);
  });
}

for (const stage of ["acceptance", "terminal"]) {
  test(`a failed ${stage} manifest save never publishes an uncommitted lifecycle event`, async (t) => {
    const h = await setup(t);
    const dialogProcessId = stage === "terminal" ? await processTurn(h.facade) : null;
    const request = stage === "terminal" ? { ...terminal(), dialogProcessId } : action();
    const before = await readFile(h.sessionFile, "utf8");
    const beforeOutbox = (await h.facade.getPendingAuthorityEvents({ ...owner, consumerId }))
      .events;
    const write = h.storageService.writeJsonAtomic.bind(h.storageService);
    h.storageService.writeJsonAtomic = (file, payload) => {
      if (file === h.sessionFile) throw new Error("injected manifest failure");
      return write(file, payload);
    };
    await assert.rejects(h.facade.applyTurnLifecycleEvent(request), /injected manifest failure/);
    h.storageService.writeJsonAtomic = write;
    assert.equal(await readFile(h.sessionFile, "utf8"), before);
    assert.deepEqual(
      (await h.restart().getPendingAuthorityEvents({ ...owner, consumerId })).events,
      beforeOutbox,
    );
  });
}

for (const stage of ["acceptance", "terminal"]) {
  test(
    `a process killed after ${stage} manifest commit recovers without rerunning the command`,
    { timeout: 20000 },
    async (t) => {
      const h = await setup(t);
      const dialogProcessId = stage === "terminal" ? await processTurn(h.facade) : null;
      const request = stage === "terminal" ? { ...terminal(), dialogProcessId } : action();
      const targetSequence = stage === "terminal" ? 4 : 1;
      const beforeRecords = await readAuthorityOutboxRecords(h.sessionDir);
      const servicesUrl = new URL("../helpers/session-services.js", import.meta.url).href;
      const facadeUrl = new URL("../../src/session/index.js", import.meta.url).href;
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
    const runtime = createTestSessionServices({ workspaceRoot: process.argv[1] });
    const write = runtime.storageService.writeJsonAtomic.bind(runtime.storageService);
    runtime.storageService.writeJsonAtomic = async (file, payload) => {
      const result = await write(file, payload);
      if (file === process.argv[2] && payload.turnLifecycle.sequence === Number(process.argv[4])) process.kill(process.pid, "SIGKILL");
      return result;
    };
    await createSessionFacade(runtime).applyTurnLifecycleEvent(JSON.parse(process.argv[3]));
  `,
          h.root,
          h.sessionFile,
          JSON.stringify(request),
          String(targetSequence),
        ],
        { encoding: "utf8", timeout: 15000 },
      );
      assert.equal(child.error, undefined, child.stderr);
      assert.equal(child.signal, "SIGKILL", child.stderr);
      assert.deepEqual(await readAuthorityOutboxRecords(h.sessionDir), beforeRecords);
      const bytes = await readFile(h.sessionFile, "utf8");
      const receipts = JSON.parse(bytes).turnLifecycle.commandReceipts;
      const restarted = h.restart();
      const pending = await restarted.getPendingAuthorityEvents({ ...owner, consumerId });
      assert.deepEqual(
        pending.events.map((entry) => entry.envelope),
        receipts.map((receipt) => receipt.envelope),
      );
      const replay = await restarted.applyTurnLifecycleEvent(request);
      assert.equal(replay.deduplicated, true);
      assert.equal(await readFile(h.sessionFile, "utf8"), bytes);
    },
  );
}

test("compacted and explicitly removed lifecycle events are not recreated from receipts", async (t) => {
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
  assert.deepEqual(await readAuthorityOutbox(h.sessionDir), []);
  await h.facade.applyTurnLifecycleEvent({
    ...event(TURN_EVENT.PROCESSING_STARTED, "started", 1, { phase: TURN_PHASE.PROCESSING }),
    ...owner,
    dialogProcessId: accepted.dialogProcessId,
  });
  assert.equal(await removeAuthorityOutboxTurnScopes(h.sessionDir, ["t1"]), 1);
  assert.deepEqual(await readAuthorityOutbox(h.sessionDir), []);
  assert.deepEqual(
    (await h.restart().getPendingAuthorityEvents({ ...owner, consumerId })).events,
    [],
  );
});

test("overwriting the receipt ledger first persists its undelivered events", async (t) => {
  const h = await setup(t);
  await h.facade.applyTurnLifecycleEvent(action());
  const session = await h.sessionRepo.findById(owner.userId, owner.sessionId, {
    persistenceContext: h.sessionRepo.treePersistenceContext(owner.userId, owner.sessionId),
  });
  const expectedEnvelope = session.turnLifecycle.commandReceipts[0].envelope;
  await rm(authorityOutboxJournalPath(h.sessionDir));
  session.turnLifecycle.commandReceipts = [];
  await h.sessionRepo.save(owner.userId, session, {
    persistenceContext: h.sessionRepo.treePersistenceContext(owner.userId, owner.sessionId),
  });
  assert.deepEqual(
    (await readAuthorityOutbox(h.sessionDir)).map((entry) => entry.envelope),
    [expectedEnvelope],
  );
});

test("outbox projection rejects conflicting receipts without modifying its sources", async (t) => {
  const h = await setup(t);
  await h.facade.applyTurnLifecycleEvent(action());
  const lifecycle = JSON.parse(await readFile(h.sessionFile, "utf8")).turnLifecycle;
  const records = await readAuthorityOutboxRecords(h.sessionDir);
  const checkpoint = createEmptyAuthorityOutboxCheckpoint();
  for (const mutate of [
    (record) => {
      record.committedAt = "2026-07-19T00:00:00.000Z";
    },
    (record) => {
      record.envelope.producer.id = "conflicting-producer";
    },
  ]) {
    const conflicting = structuredClone(records);
    mutate(conflicting[0]);
    const before = structuredClone({ records: conflicting, lifecycle, checkpoint });
    assert.throws(
      () => projectCommittedTurnOutbox(conflicting, lifecycle, checkpoint),
      /conflicting lifecycle receipt/,
    );
    assert.deepEqual({ records: conflicting, lifecycle, checkpoint }, before);
  }
  const before = structuredClone({ records, lifecycle, checkpoint });
  assert.equal(projectCommittedTurnOutbox(records, lifecycle, checkpoint).added, 0);
  assert.deepEqual({ records, lifecycle, checkpoint }, before);
});
