/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import {
  readSessionArtifact,
  writeSessionArtifact,
  SESSION_ARTIFACT_PREDECESSOR,
} from "../src/session/session-artifact-store.js";
import {
  migrateSessionCheckpointIdentity,
  upgradeSessionCheckpointIdentity,
} from "../src/workspace-lifecycle/session-checkpoint-identity-upgrade.js";
import { upgradeSessionMessageIdentity } from "../src/workspace-lifecycle/session-message-identity-upgrade.js";
import { readSessionForProtocolRepair } from "@noobot/session-repair";
import { withTemp, canonicalMessages } from "./session/session-artifact-store-v2.test-helpers.js";
import {
  applySessionMessageFacts,
  createTestSessionRequiredFields,
} from "./helpers/session-message-facts.js";
import { TEST_STORAGE_SERVICE as storageService } from "./helpers/storage-service.js";

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const options = (base, sessionDir) => ({ base, sessionDir, storageService, backupBase: null });

async function createHistory(sessionDir, count) {
  const sessionId = "checkpoint-history";
  const turn = { turnScopeId: "scope-history", dialogProcessId: "dialog-history" };
  const sessionPayload = applySessionMessageFacts({
    ...createTestSessionRequiredFields(),
    sessionId,
    parentSessionId: "",
    aggregateVersion: 0,
    messages: canonicalMessages(
      Array.from({ length: count }, (_, i) => ({
        role: "assistant",
        content: `message ${i}`,
        ...turn,
      })),
      sessionId,
    ),
  });
  const receipts = [];
  for (let revision = 1; revision <= count; revision++) {
    receipts.push({
      checkpointId: `checkpoint-${revision}`,
      checkpointRevision: revision,
      requestHash: `sha256:request-${revision}`,
      persistedMessageUids: [],
      summarizedMessageUids: [sessionPayload.messages[revision - 1].messageUid],
      retainedMessageUids: [],
      markedCount: 1,
      committedAt: new Date(Date.UTC(2026, 0, 1, 0, revision)).toISOString(),
    });
    sessionPayload.messages[revision - 1].summarized = true;
    sessionPayload.turnSummaryCheckpoints = {
      [turn.turnScopeId]: { ...turn, checkpointRevision: revision, receipts: receipts.slice(-50) },
    };
    await writeSessionArtifact({
      sessionDir,
      storageService,
      sessionPayload,
      atomic: true,
      predecessor: SESSION_ARTIFACT_PREDECESSOR.CANONICAL,
    });
  }
  return sessionPayload;
}

async function downgrade(sessionDir) {
  const manifestFile = path.join(sessionDir, "session.json");
  const session = await readSessionArtifact({ storageService, sessionDir });
  const manifest = await readJson(manifestFile);
  manifest.schemaVersion = 18;
  manifest.turnSummaryCheckpoints = session.turnSummaryCheckpoints;
  for (const turn of manifest.turnOrder)
    for (const index of turn.summarySnapshots)
      index.messageUids = (await readJson(path.join(sessionDir, index.file))).summarizedMessageUids;
  await writeFile(manifestFile, JSON.stringify(manifest));
  return manifest;
}

test("v26 preserves all 60 checkpoint identities beyond the receipt window, hashes and subsequent writes", async () =>
  withTemp(async (base) => {
    const sessionDir = path.join(base, "runtime/agent/session/checkpoint-history");
    const original = await createHistory(sessionDir, 60);
    const legacy = await downgrade(sessionDir);
    const files = legacy.turnOrder[0].summarySnapshots.map((index) =>
      path.join(sessionDir, index.file),
    );
    const bytes = await Promise.all(files.map((file) => readFile(file, "utf8")));
    const migration = await upgradeSessionCheckpointIdentity({
      ...options(base, sessionDir),
      scopedSessionRoots: ["runtime/agent/session"],
    });
    assert.equal(migration.sessions.length, 1);
    assert.deepEqual(migration.quarantined, []);
    const stored = await readJson(path.join(sessionDir, "session.json"));
    assert.equal(stored.schemaVersion, 19);
    assert.equal(stored.turnOrder[0].summarySnapshots.length, 60);
    assert.equal(stored.turnSummaryCheckpoints["scope-history"].receipts.length, 50);
    for (const receipt of stored.turnSummaryCheckpoints["scope-history"].receipts) {
      assert.equal(Object.hasOwn(receipt, "summarizedMessageUids"), false);
      assert.equal(Object.hasOwn(receipt, "persistedMessageUids"), false);
    }
    for (const index of stored.turnOrder[0].summarySnapshots)
      assert.equal(Object.hasOwn(index, "messageUids"), false);
    assert.deepEqual(await Promise.all(files.map((file) => readFile(file, "utf8"))), bytes);
    assert.deepEqual(
      stored.turnOrder[0].summarySnapshots.map((index) => index.contentHash),
      legacy.turnOrder[0].summarySnapshots.map((index) => index.contentHash),
    );
    const eventsUpgrade = await upgradeSessionMessageIdentity({
      ...options(base, sessionDir),
      scopedSessionRoots: ["runtime/agent/session"],
    });
    assert.deepEqual(eventsUpgrade.quarantined, []);
    const reloaded = await readSessionArtifact({ storageService, sessionDir });
    assert.deepEqual(reloaded.turnSummaryCheckpoints, original.turnSummaryCheckpoints);
    assert.equal(reloaded.messages.length, 60);
    assert.deepEqual(
      (await readSessionForProtocolRepair({ sessionDir, session: stored })).turnSummaryCheckpoints,
      original.turnSummaryCheckpoints,
    );
    await writeSessionArtifact({
      storageService,
      sessionDir,
      sessionPayload: reloaded,
      atomic: true,
      predecessor: SESSION_ARTIFACT_PREDECESSOR.CANONICAL,
    });
    assert.equal(
      (await readJson(path.join(sessionDir, "session.json"))).turnOrder[0].summarySnapshots.length,
      60,
    );
    assert.equal(await migrateSessionCheckpointIdentity(options(base, sessionDir)), null);
  }));

test("v26 rejects conflicting legacy copies before changing source bytes", async () =>
  withTemp(async (base) => {
    const sessionDir = path.join(base, "session");
    await createHistory(sessionDir, 1);
    const legacy = await downgrade(sessionDir);
    const file = path.join(sessionDir, "session.json");
    legacy.turnSummaryCheckpoints["scope-history"].receipts[0].summarizedMessageUids = [
      "conflicting-uid",
    ];
    const bytes = JSON.stringify(legacy);
    await writeFile(file, bytes);
    await assert.rejects(migrateSessionCheckpointIdentity(options(base, sessionDir)), {
      code: "SESSION_SUMMARY_CHECKPOINT_IDENTITY_INVALID",
    });
    assert.equal(await readFile(file, "utf8"), bytes);
  }));

test("schema18 identity upgrade preserves the complete checkpoint chain beyond 50 receipts", async () =>
  withTemp(async (base) => {
    const sessionDir = path.join(base, "runtime/agent/session/checkpoint-history");
    const original = await createHistory(sessionDir, 60);
    const legacy = await downgrade(sessionDir);
    const indexes = legacy.turnOrder[0].summarySnapshots;
    const files = indexes.map((index) => path.join(sessionDir, index.file));
    const bytes = await Promise.all(files.map((file) => readFile(file, "utf8")));
    const result = await upgradeSessionMessageIdentity({
      ...options(base, sessionDir),
      scopedSessionRoots: ["runtime/agent/session"],
    });
    assert.deepEqual(result.quarantined, []);
    assert.equal(result.sessions.length, 1);
    const manifest = await readJson(path.join(sessionDir, "session.json"));
    assert.equal(manifest.schemaVersion, 21);
    assert.equal(manifest.turnOrder[0].summarySnapshots.length, 60);
    assert.deepEqual(
      manifest.turnOrder[0].summarySnapshots.map((index) => index.contentHash),
      indexes.map((index) => index.contentHash),
    );
    assert.deepEqual(await Promise.all(files.map((file) => readFile(file, "utf8"))), bytes);
    const reloaded = await readSessionArtifact({ storageService, sessionDir });
    assert.deepEqual(reloaded.turnSummaryCheckpoints, original.turnSummaryCheckpoints);
    assert.equal(reloaded.messages.length, 60);
    const repeated = await upgradeSessionMessageIdentity({
      ...options(base, sessionDir),
      scopedSessionRoots: ["runtime/agent/session"],
    });
    assert.deepEqual(repeated.sessions, []);
    assert.deepEqual(repeated.quarantined, []);
  }));

for (const [name, corrupt] of Object.entries({
  dangling: (state) => {
    state.receipts[0].checkpointId = "missing";
  },
  duplicate: (state) => {
    state.receipts[0].summarizedMessageUids = [];
  },
  owner: (state) => {
    state.dialogProcessId = "another-dialog";
  },
  scope: (state) => {
    state.turnScopeId = "another-scope";
  },
})) {
  test(`normal and repair readers reject ${name} checkpoint identity`, async () =>
    withTemp(async (base) => {
      const sessionDir = path.join(base, "session");
      await createHistory(sessionDir, 1);
      const file = path.join(sessionDir, "session.json");
      const manifest = await readJson(file);
      corrupt(manifest.turnSummaryCheckpoints["scope-history"]);
      await writeFile(file, JSON.stringify(manifest));
      for (const read of [
        () => readSessionArtifact({ storageService, sessionDir }),
        () => readSessionForProtocolRepair({ sessionDir, session: manifest }),
      ])
        await assert.rejects(read(), { code: "SESSION_SUMMARY_CHECKPOINT_IDENTITY_INVALID" });
    }));
}

for (const corruption of [
  "manifest-json",
  "checkpoint-json",
  "receipt-conflict",
  "hash-conflict",
]) {
  test(`v26 quarantines ${corruption} and continues migrating healthy sessions`, async () =>
    withTemp(async (base) => {
      for (const name of ["bad", "good"]) {
        const sessionDir = path.join(base, "runtime/agent/session", name);
        await createHistory(sessionDir, 1);
        const manifest = await downgrade(sessionDir);
        if (name === "good") continue;
        const manifestFile = path.join(sessionDir, "session.json");
        const checkpointFile = path.join(
          sessionDir,
          manifest.turnOrder[0].summarySnapshots[0].file,
        );
        if (corruption === "manifest-json") await writeFile(manifestFile, "{");
        if (corruption === "checkpoint-json") await writeFile(checkpointFile, "{");
        if (corruption === "receipt-conflict") {
          manifest.turnSummaryCheckpoints["scope-history"].receipts[0].summarizedMessageUids = [
            "conflict",
          ];
          await writeFile(manifestFile, JSON.stringify(manifest));
        }
        if (corruption === "hash-conflict") {
          const checkpoint = await readJson(checkpointFile);
          checkpoint.summarizedMessageUids = ["conflict"];
          await writeFile(checkpointFile, JSON.stringify(checkpoint));
        }
      }
      const result = await upgradeSessionCheckpointIdentity({
        ...options(base, base),
        scopedSessionRoots: ["runtime/agent/session"],
      });
      assert.equal(result.quarantined.length, 1);
      assert.equal(result.sessions.length, 1);
      assert.equal(
        (await readJson(path.join(base, "runtime/agent/session/good/session.json"))).schemaVersion,
        19,
      );
    }));
}
