/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildSessionArtifactFileMap,
  readSessionArtifact,
} from "../../src/session/session-artifact-store.js";
import { createTurnMaterializer } from "../../src/session/session-artifact-session/turn-materializer.js";
import { replaceJournalRecords } from "../../src/session/session-artifact-session/turn-journal-store.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";
import { withTemp, writeSessionArtifact } from "./session-artifact-store-v2.test-helpers.js";

const TS = "2026-01-01T00:00:00.000Z";

function message(uid, role, content) {
  return role === "user"
    ? { role, messageOrigin: "natural", content, turnScopeId: "active", messageUid: uid, ts: TS }
    : {
        role,
        presentationMessageId: `pm_${uid}`,
        content,
        turnScopeId: "active",
        messageUid: uid,
        ts: TS,
      };
}

function receipt(revision, persisted, summarized) {
  return {
    checkpointId: `checkpoint-${revision}`,
    checkpointRevision: revision,
    requestHash: "sha256:fixture",
    persistedMessageUids: persisted,
    summarizedMessageUids: summarized,
    retainedMessageUids: [],
    markedCount: summarized.length,
    committedAt: TS,
  };
}

function payloadOf(messages, receipts) {
  return {
    ...createTestSessionRequiredFields(),
    sessionId: "materializer",
    aggregateVersion: 0,
    messages,
    turnSummaryCheckpoints: {
      active: {
        dialogProcessId: "dialog-active",
        turnScopeId: "active",
        checkpointRevision: receipts.length,
        receipts,
      },
    },
  };
}

async function manifestTurn(root) {
  const files = buildSessionArtifactFileMap(root);
  return JSON.parse(await readFile(files.session, "utf8")).turnOrder[0];
}

const uids = (messages) => messages.map((item) => item.messageUid);

async function seedCheckpointedTurn(root) {
  const base = [message("m1", "user", "question"), message("m2", "assistant", "answer")];
  await writeSessionArtifact({
    sessionDir: root,
    sessionPayload: payloadOf(base, [receipt(1, ["m1", "m2"], ["m1"])]),
  });
  return base;
}

test("verified checkpoint chain and journal prefix are reused across reads", async () =>
  withTemp(async (root) => {
    const base = await seedCheckpointedTurn(root);
    const materializer = createTurnMaterializer({ byteBudget: 1024 * 1024 });
    const first = await materializer.materialize(root, await manifestTurn(root));
    assert.deepEqual(uids(first), ["m1", "m2"]);
    assert.equal(Object.isFrozen(first[0]), true);
    const second = await materializer.materialize(root, await manifestTurn(root));
    assert.equal(second[0], first[0], "checkpoint message must come from the verified cache");

    const grown = [...base, message("m3", "assistant", "tail")];
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: payloadOf(grown, [receipt(1, ["m1", "m2"], ["m1"])]),
    });
    const item = await manifestTurn(root);
    assert.ok(item.committedBytes > 0, "tail message must live in the turn journal");
    const third = await materializer.materialize(root, item);
    assert.deepEqual(uids(third), ["m1", "m2", "m3"]);
    assert.equal(third[0], first[0]);
    assert.equal(Object.isFrozen(third[2]), true, "journal tail messages are frozen as well");
    const fourth = await materializer.materialize(root, item);
    assert.equal(fourth[2], third[2], "journal prefix must be reused, not re-parsed");
    assert.throws(() => {
      fourth[2].content = "mutated";
    }, TypeError);
  }));

test("journal replacement changes the identity and forces a full journal read", async () =>
  withTemp(async (root) => {
    const base = await seedCheckpointedTurn(root);
    const grown = [...base, message("m3", "assistant", "tail")];
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: payloadOf(grown, [receipt(1, ["m1", "m2"], ["m1"])]),
    });
    const materializer = createTurnMaterializer({ byteBudget: 1024 * 1024 });
    const item = await manifestTurn(root);
    const before = await materializer.materialize(root, item);
    const journal = path.join(root, item.file);
    const records = (await readFile(journal, "utf8")).trim().split("\n").map(JSON.parse);
    const committedBytes = await replaceJournalRecords(journal, records);
    assert.equal(committedBytes, item.committedBytes);
    const after = await materializer.materialize(root, { ...item, committedBytes });
    assert.deepEqual(uids(after), ["m1", "m2", "m3"]);
    assert.notEqual(after[2], before[2], "a replaced journal must be parsed again");
    assert.equal(after[0], before[0], "the unchanged checkpoint chain stays verified");
  }));

test("checkpoint chain is re-verified when a link changes on disk or in the manifest", async () =>
  withTemp(async (root) => {
    await seedCheckpointedTurn(root);
    const materializer = createTurnMaterializer({ byteBudget: 1024 * 1024 });
    const item = await manifestTurn(root);
    await materializer.materialize(root, item);
    const snapshotFile = path.join(root, item.summarySnapshots[0].file);
    const original = await readFile(snapshotFile, "utf8");
    await writeFile(`${snapshotFile}.tmp`, original.replace('"answer"', '"ANSWER"'), "utf8");
    await rename(`${snapshotFile}.tmp`, snapshotFile);
    await assert.rejects(materializer.materialize(root, item), {
      code: "SESSION_SUMMARY_SNAPSHOT_HASH_MISMATCH",
    });
    await writeFile(`${snapshotFile}.tmp`, original, "utf8");
    await rename(`${snapshotFile}.tmp`, snapshotFile);
    assert.deepEqual(uids(await materializer.materialize(root, item)), ["m1", "m2"]);
    await assert.rejects(
      materializer.materialize(root, {
        ...item,
        summarySnapshots: [{ ...item.summarySnapshots[0], contentHash: "sha256:other" }],
      }),
      { code: "SESSION_SUMMARY_SNAPSHOT_HASH_MISMATCH" },
    );
    const shortened = await materializer.materialize(root, {
      ...item,
      summarySnapshots: [],
      messageOrder: [],
    });
    assert.deepEqual(uids(shortened), [], "a shortened chain must not reuse cached state");
  }));

test("byte budget evicts least recently materialized turns", async () =>
  withTemp(async (root) => {
    await seedCheckpointedTurn(root);
    const item = await manifestTurn(root);
    const unbounded = createTurnMaterializer({ byteBudget: 1024 * 1024 });
    await unbounded.materialize(root, item);
    const entryBytes = unbounded.cachedBytes();
    assert.ok(entryBytes > 0);
    const tight = createTurnMaterializer({ byteBudget: entryBytes - 1 });
    const first = await tight.materialize(root, item);
    assert.equal(tight.cachedBytes(), 0, "an entry above the budget is not retained");
    const second = await tight.materialize(root, item);
    assert.notEqual(second[0], first[0]);
    assert.throws(() => createTurnMaterializer({ byteBudget: -1 }), TypeError);
  }));

test("session reads expose frozen materialized messages without breaking writers", async () =>
  withTemp(async (root) => {
    const base = await seedCheckpointedTurn(root);
    const restored = await readSessionArtifact({ sessionDir: root });
    assert.deepEqual(uids(restored.messages), ["m1", "m2"]);
    const next = [...restored.messages, message("m3", "assistant", "after read")];
    await writeSessionArtifact({
      sessionDir: root,
      sessionPayload: payloadOf(next, [receipt(1, ["m1", "m2"], ["m1"])]),
    });
    assert.deepEqual(uids((await readSessionArtifact({ sessionDir: root })).messages), [
      ...uids(base),
      "m3",
    ]);
  }));
