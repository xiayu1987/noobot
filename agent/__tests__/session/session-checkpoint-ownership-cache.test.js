/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { createTurnMaterializer } from "../../src/session/session-artifact-session/turn-materializer.js";
import { buildSessionArtifactFileMap } from "../../src/session/session-artifact-store.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { withTemp, writeSessionArtifact } from "./session-artifact-store-v2.test-helpers.js";

test("historical ownership survives body eviction while the active turn adds checkpoints", async () =>
  withTemp(async (sessionDir) => {
    const messages = [];
    const turnSummaryCheckpoints = {};
    for (let turn = 0; turn < 4; turn += 1) {
      const turnScopeId = `history-${turn}`;
      const persistedMessageUids = [];
      const receipts = [];
      for (let revision = 1; revision <= 3; revision += 1) {
        const messageUid = `${turnScopeId}-${revision}`;
        persistedMessageUids.push(messageUid);
        messages.push({
          role: "assistant",
          messageUid,
          presentationMessageId: `pm_${turnScopeId}`,
          turnScopeId,
          dialogProcessId: turnScopeId,
          content: "x".repeat(65536),
          summarized: true,
        });
        receipts.push({
          checkpointId: messageUid,
          checkpointRevision: revision,
          requestHash: "sha256:fixture",
          persistedMessageUids: [...persistedMessageUids],
          summarizedMessageUids: [messageUid],
          retainedMessageUids: [],
          markedCount: 1,
          committedAt: "2026-01-01T00:00:00.000Z",
        });
      }
      turnSummaryCheckpoints[turnScopeId] = {
        dialogProcessId: turnScopeId,
        turnScopeId,
        checkpointRevision: receipts.length,
        receipts,
      };
    }
    const payload = {
      sessionId: "ownership",
      aggregateVersion: 0,
      messages,
      turnSummaryCheckpoints,
    };
    await writeSessionArtifact({ sessionDir, sessionPayload: payload });
    await delay(TIME_THRESHOLDS.agent.snapshotIdentityGuardMs + 10);
    const readManifest = async () =>
      JSON.parse(await readFile(buildSessionArtifactFileMap(sessionDir).session, "utf8"));
    const materializer = createTurnMaterializer({
      payloadByteBudget: 16384,
      identityByteBudget: 16384,
    });
    const history = (await readManifest()).turnOrder;
    const ownership = [];
    for (const item of history)
      ownership.push(
        await materializer.materializeMessageUids({ storageService, sessionDir, item }),
      );
    for (let revision = 1; revision <= 3; revision += 1) {
      const messageUid = `active-${revision}`;
      messages.push({
        role: "assistant",
        messageUid,
        presentationMessageId: "pm_active",
        turnScopeId: "active",
        dialogProcessId: "active",
        content: "new checkpoint",
        summarized: true,
      });
      const active = messages.filter((message) => message.turnScopeId === "active");
      const receipts = turnSummaryCheckpoints.active?.receipts || [];
      turnSummaryCheckpoints.active = {
        dialogProcessId: "active",
        turnScopeId: "active",
        checkpointRevision: revision,
        receipts: [
          ...receipts,
          {
            checkpointId: messageUid,
            checkpointRevision: revision,
            requestHash: "sha256:fixture",
            persistedMessageUids: active.map((message) => message.messageUid),
            summarizedMessageUids: [messageUid],
            retainedMessageUids: [],
            markedCount: 1,
            committedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      };
      await writeSessionArtifact({ sessionDir, sessionPayload: payload });
      const manifest = await readManifest();
      await materializer.materializeEntries({
        storageService,
        sessionDir,
        item: manifest.turnOrder.at(-1),
      });
      for (const [index, item] of manifest.turnOrder.slice(0, history.length).entries())
        assert.equal(
          await materializer.materializeMessageUids({ storageService, sessionDir, item }),
          ownership[index],
        );
      assert.ok(materializer.cachedBytes() <= 32768);
    }
  }));
