/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  readSessionArtifact,
  writeSessionArtifact as writeCanonical,
  SESSION_ARTIFACT_PREDECESSOR,
} from "../../src/session/session-artifact-store.js";
import { createTurnMaterializer } from "../../src/session/session-artifact-session/turn-materializer.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { turnRecord } from "../helpers/turn-record.js";
import { withTemp, writeSessionArtifact } from "./session-artifact-store-v2.test-helpers.js";

async function manifestOf(root) {
  return JSON.parse(await readFile(path.join(root, "session.json"), "utf8"));
}

function failedManifestStorage(root) {
  const failure = new Error("injected manifest commit failure");
  return Object.assign(Object.create(storageService), {
    writeJsonAtomic: async (file, payload) => {
      if (file === path.join(root, "session.json")) throw failure;
      return storageService.writeJsonAtomic(file, payload);
    },
  });
}

async function assertFailedCommitPreservesPrevious(root, next) {
  const previous = await manifestOf(root);
  const previousFile = path.join(root, previous.turnOrder[0].file);
  const previousBytes = await readFile(previousFile);
  const before = await readSessionArtifact({ storageService, sessionDir: root });
  await assert.rejects(
    writeCanonical({
      storageService: failedManifestStorage(root),
      sessionDir: root,
      sessionPayload: next,
      atomic: true,
      predecessor: SESSION_ARTIFACT_PREDECESSOR.CANONICAL,
    }),
    /injected manifest commit failure/,
  );
  assert.deepEqual(await manifestOf(root), previous);
  assert.deepEqual(await readFile(previousFile), previousBytes);
  const fresh = createTurnMaterializer({ payloadByteBudget: 0, identityByteBudget: 0 });
  assert.deepEqual(
    await fresh.materialize({ storageService, sessionDir: root, item: previous.turnOrder[0] }),
    before.messages,
  );
  await writeCanonical({
    storageService,
    sessionDir: root,
    sessionPayload: next,
    atomic: true,
    predecessor: SESSION_ARTIFACT_PREDECESSOR.CANONICAL,
  });
  const committed = await manifestOf(root);
  assert.notEqual(committed.turnOrder[0].file, previous.turnOrder[0].file);
  assert.deepEqual(
    (await readSessionArtifact({ storageService, sessionDir: root })).messages,
    next.messages,
  );
}

async function seed(root) {
  await writeSessionArtifact({
    sessionDir: root,
    sessionPayload: {
      sessionId: "commit-boundary",
      aggregateVersion: 0,
      messages: [
        { role: "user", messageOrigin: "natural", content: "question", turnScopeId: "active" },
        {
          role: "assistant",
          presentationMessageId: "pm_boundary",
          content: "answer",
          turnScopeId: "active",
        },
      ],
    },
  });
  return readSessionArtifact({ storageService, sessionDir: root });
}

test("terminal compaction preserves the old committed journal when manifest publication fails", async () =>
  withTemp(async (root) => {
    const session = await seed(root);
    const dialogProcessId = session.messages[0].dialogProcessId;
    session.turnLifecycle.turns.active = turnRecord({
      turnScopeId: "active",
      dialogProcessId,
      state: "completed",
    });
    session.turnLifecycle.sequence = 1;
    await assertFailedCommitPreservesPrevious(root, session);
  }));

test("summary compaction preserves the old committed journal when manifest publication fails", async () =>
  withTemp(async (root) => {
    const session = await seed(root);
    const uids = session.messages.map((message) => message.messageUid);
    session.turnSummaryCheckpoints = {
      active: {
        dialogProcessId: session.messages[0].dialogProcessId,
        turnScopeId: "active",
        checkpointRevision: 1,
        receipts: [
          {
            checkpointId: "boundary-checkpoint",
            checkpointRevision: 1,
            requestHash: "sha256:boundary",
            persistedMessageUids: uids,
            summarizedMessageUids: [uids[0]],
            retainedMessageUids: [],
            markedCount: 1,
            committedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    };
    await assertFailedCommitPreservesPrevious(root, session);
  }));
