/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createTurnMaterializer } from "../../src/session/session-artifact-session/turn-materializer.js";
import { buildSessionArtifactFileMap } from "../../src/session/session-artifact-store.js";
import { withTemp, writeSessionArtifact } from "./session-artifact-store-v2.test-helpers.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";

const TS = "2026-01-01T00:00:00.000Z";

test("checkpoint writer compacts accumulated updates and orders and rebuilds without caches", async () =>
  withTemp(async (sessionDir) => {
    const messages = [];
    const receipts = [];
    const payload = {
      sessionId: "checkpoint-compaction",
      aggregateVersion: 0,
      messages,
    };
    for (let revision = 1; revision <= 2; revision += 1) {
      for (let index = 0; index < 5; index += 1) {
        messages.push({
          role: "assistant",
          messageUid: `m-${revision}-${index}`,
          presentationMessageId: "pm_active",
          turnScopeId: "active",
          dialogProcessId: "dialog-active",
          content: `content-${index}`,
          summarized: true,
          ts: TS,
        });
        if (messages.length > 1) messages[0].content = `updated-${revision}-${index}`;
        await writeSessionArtifact({ sessionDir, sessionPayload: payload });
      }
      receipts.push({
        checkpointId: `checkpoint-${revision}`,
        checkpointRevision: revision,
        requestHash: "sha256:fixture",
        persistedMessageUids: messages.map((message) => message.messageUid),
        summarizedMessageUids: messages.slice(-5).map((message) => message.messageUid),
        retainedMessageUids: [],
        markedCount: 5,
        committedAt: TS,
      });
      payload.turnSummaryCheckpoints = {
        active: {
          dialogProcessId: "dialog-active",
          turnScopeId: "active",
          checkpointRevision: revision,
          receipts,
        },
      };
      await writeSessionArtifact({ sessionDir, sessionPayload: payload });
      const manifest = JSON.parse(
        await readFile(buildSessionArtifactFileMap(sessionDir).session, "utf8"),
      );
      const item = manifest.turnOrder[0];
      const snapshot = JSON.parse(
        await readFile(path.join(sessionDir, item.summarySnapshots.at(-1).file), "utf8"),
      );
      const placement = snapshot.records.filter((record) =>
        ["order", "append_positions"].includes(record.op),
      );
      assert.equal(placement.length, 1);
      assert.equal(placement[0].op, revision === 1 ? "order" : "append_positions");
      assert.equal(placement[0].positions.length, 5);
      const updates = snapshot.records.filter((record) => record.op === "upsert");
      assert.equal(new Set(updates.map((record) => record.messageUid)).size, updates.length);
      assert.equal(snapshot.persistedMessageUids.length, messages.length);
      const restored = await createTurnMaterializer({
        payloadByteBudget: 0,
        identityByteBudget: 0,
      }).materialize({
        storageService,
        sessionDir,
        item,
      });
      assert.deepEqual(
        restored.map(({ messageUid, content }) => ({ messageUid, content })),
        messages.map(({ messageUid, content }) => ({ messageUid, content })),
      );
      assert.equal(item.summarySnapshots.length, revision);
      assert.equal(item.committedBytes, 0);
    }
  }));
