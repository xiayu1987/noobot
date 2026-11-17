/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { buildSessionArtifactFileMap } from "../../src/session/session-artifact-files.js";
import { readCheckpointReceiptProjection } from "../../src/session/session-artifact-session/checkpoint-receipts.js";
import {
  createTurnMaterializer,
  forgetVerifiedSnapshot,
} from "../../src/session/session-artifact-session/turn-materializer.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { withTemp, writeSessionArtifact } from "./session-artifact-store-v2.test-helpers.js";

for (const [name, read] of Object.entries({
  receipts: readCheckpointReceiptProjection,
  messages: async (options) => {
    const messages = await createTurnMaterializer({
      payloadByteBudget: 0,
      identityByteBudget: 0,
    }).materialize({
      ...options,
      item: options.session.turnOrder[0],
    });
    assert.deepEqual(
      messages.map((message) => message.messageUid),
      ["m1"],
    );
    return readCheckpointReceiptProjection(options);
  },
}))
  test(`parallel ${name} verification preserves first-error order and settles the failed batch`, async () =>
    withTemp(async (sessionDir) => {
      const concurrency = QUANTITY_THRESHOLDS.artifact.checkpointVerificationConcurrency;
      const receipts = Array.from({ length: concurrency * 2 }, (_, index) => ({
        checkpointId: `c-${index}`,
        checkpointRevision: index + 1,
        requestHash: "sha256:fixture",
        persistedMessageUids: ["m1"],
        summarizedMessageUids: ["m1"],
        retainedMessageUids: [],
        markedCount: 1,
        committedAt: "2026-01-01T00:00:00.000Z",
      }));
      await writeSessionArtifact({
        sessionDir,
        sessionPayload: {
          sessionId: "concurrency",
          aggregateVersion: 0,
          messages: [
            {
              role: "user",
              messageOrigin: "natural",
              messageUid: "m1",
              turnScopeId: "active",
              dialogProcessId: "active",
              content: "question",
              summarized: true,
            },
          ],
          turnSummaryCheckpoints: {
            active: {
              dialogProcessId: "active",
              turnScopeId: "active",
              checkpointRevision: receipts.length,
              receipts,
            },
          },
        },
      });
      const session = JSON.parse(
        await readFile(buildSessionArtifactFileMap(sessionDir).session, "utf8"),
      );
      const indexes = session.turnOrder[0].summarySnapshots;
      for (const index of indexes) forgetVerifiedSnapshot(sessionDir, index.file);
      const firstError = new Error("first in manifest, last to finish");
      const secondError = new Error("second in manifest, first to finish");
      let release;
      const barrier = new Promise((resolve) => {
        release = resolve;
      });
      let active = 0;
      let maximum = 0;
      let reads = 0;
      const observedStorage = Object.create(storageService);
      observedStorage.readJson = async (file) => {
        active += 1;
        maximum = Math.max(maximum, active);
        reads += 1;
        try {
          if (file === path.join(sessionDir, indexes[0].file)) {
            await barrier;
            throw firstError;
          }
          if (file === path.join(sessionDir, indexes[1].file)) {
            release();
            throw secondError;
          }
          return await storageService.readJson(file);
        } finally {
          active -= 1;
        }
      };
      await assert.rejects(
        read({ storageService: observedStorage, sessionDir, session }),
        (error) => {
          assert.ok(error instanceof AggregateError);
          assert.equal(error.cause, firstError);
          assert.deepEqual(error.errors, [firstError, secondError]);
          return true;
        },
      );
      assert.equal(active, 0, "failure cannot leave verification reads running");
      assert.equal(reads, concurrency, "later batches cannot run after a failed batch");
      assert.ok(maximum <= concurrency);
      const restored = await read({ storageService, sessionDir, session });
      assert.equal(restored.turnSummaryCheckpoints.active.receipts.length, receipts.length);
    }));
