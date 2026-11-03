/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { buildSessionArtifactFileMap } from "../../src/session/session-artifact-store.js";
import {
  buildStoredCheckpointReceipts,
  readCheckpointReceiptProjection,
} from "../../src/session/session-artifact-session/checkpoint-receipts.js";
import { getVerifiedSnapshotCache } from "../../src/session/session-artifact-session/verified-snapshot-cache.js";
import { createTestSessionRequiredFields } from "./session-message-facts.js";
import { TEST_STORAGE_SERVICE as storageService } from "./storage-service.js";
import {
  withTemp,
  writeSessionArtifact,
} from "../session/session-artifact-store-v2.test-helpers.js";

const TS = "2026-01-01T00:00:00.000Z";
const SNAPSHOT_COUNT = 8;
const payloadBudget = LENGTH_THRESHOLDS.artifact.verifiedSnapshotCacheBytes;

function message(uid, role, content) {
  const base = { role, content, turnScopeId: "active", messageUid: uid, ts: TS };
  return role === "user"
    ? { ...base, messageOrigin: "natural" }
    : { ...base, presentationMessageId: "pm_active" };
}

function receipt(revision) {
  return {
    checkpointId: `checkpoint-${revision}`,
    checkpointRevision: revision,
    requestHash: "sha256:fixture",
    persistedMessageUids: ["m1", "m2"],
    summarizedMessageUids: ["m1"],
    retainedMessageUids: [],
    markedCount: 1,
    committedAt: TS,
  };
}

await withTemp(async (root) => {
  await writeSessionArtifact({
    sessionDir: root,
    sessionPayload: {
      ...createTestSessionRequiredFields(),
      sessionId: "over-budget",
      aggregateVersion: 0,
      messages: [message("m1", "user", "question"), message("m2", "assistant", "x".repeat(8192))],
      turnSummaryCheckpoints: {
        active: {
          dialogProcessId: "dialog-active",
          turnScopeId: "active",
          checkpointRevision: SNAPSHOT_COUNT,
          receipts: Array.from({ length: SNAPSHOT_COUNT }, (_, index) => receipt(index + 1)),
        },
      },
    },
  });
  await delay(TIME_THRESHOLDS.agent.snapshotIdentityGuardMs + 10);
  const session = JSON.parse(await readFile(buildSessionArtifactFileMap(root).session, "utf8"));
  assert.equal(session.turnOrder.flatMap((turn) => turn.summarySnapshots).length, SNAPSHOT_COUNT);

  let reads = 0;
  const countedStorage = Object.create(storageService);
  countedStorage.readJson = async (file) => {
    reads += 1;
    return storageService.readJson(file);
  };
  const options = { storageService: countedStorage, sessionDir: root, session };
  await readCheckpointReceiptProjection(options);
  assert.equal(reads, SNAPSHOT_COUNT, "first projection verifies every snapshot from disk");
  assert.ok(getVerifiedSnapshotCache().cachedBytes().payload <= payloadBudget);

  reads = 0;
  for (let scan = 0; scan < 3; scan += 1) {
    await readCheckpointReceiptProjection(options);
    await buildStoredCheckpointReceipts(options);
  }
  assert.equal(reads, 0, "payload eviction must not force receipt projections to re-read");
});
