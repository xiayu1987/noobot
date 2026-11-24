/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_VERSION } from "@noobot/semantic-transfer-protocol";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createTestSessionServices,
  provisionTestSession,
  commitTestSessionChanges,
} from "../helpers/session-services.js";
import {
  canonicalMessages,
  withTempWorkspace,
} from "./session-repository-boundary.summaries.fixtures.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { PartitionJournalOwner } from "../../src/session/partition-storage/partition-journal-owner.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { commitFixtureTransaction, journalTestLimits } from "../helpers/partition-journal-cases.js";
import { PARTITION_JOURNAL_HEAD_FILE } from "@noobot/session-protocol/partition-journal";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { ACTIVITY_TIMELINE_ERROR_CODE } from "@noobot/event-protocol/activity-timeline";

function canonicalTransferEnvelope(sessionId) {
  return {
    protocol: "noobot.semantic-transfer",
    version: TRANSFER_VERSION,
    transferId: "transfer:multimodal-parse-1",
    presentationMessageId: "message-1",
    identity: {
      sessionId,
      producer: { type: "tool", id: "call-1" },
    },
    direction: "output",
    payload: {
      mode: "attachment",
      attachments: [
        {
          identity: {
            attachmentId: "attachment-1",
            sessionId,
            attachmentSource: "model",
          },
          role: "primary",
          name: "parsed.md",
          mimeType: "text/markdown",
        },
      ],
    },
    intent: {
      source: "tool",
      reason: "multimodal_parse_artifact",
      scenario: "tool",
      strategy: "tool_result_text",
    },
    meta: {},
  };
}

test("session detail derives transfer envelopes from the canonical Session", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "canonical-display-source";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    const repository = runtime.repositories.sessionRepository;
    await provisionTestSession(runtime, {
      userId,
      sessionId,
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });

    const messages = canonicalMessages(
      [
        {
          attachments: [],
          role: "assistant",
          presentationMessageId: "pm_fx1",
          content: "parsed",
          transferEnvelopes: [canonicalTransferEnvelope(sessionId)],
        },
      ],
      sessionId,
      "canonical_display",
    );
    await commitTestSessionChanges(runtime, { userId, sessionId, changes: { messages } });
    const scope = await repository.requireSessionScope(
      userId,
      sessionId,
      repository.treePersistenceContext(userId, sessionId),
    );
    const summaryFile = path.join(scope.sessionDir, "session-summary.json");
    const staleSummary = {
      messages: [{ transferEnvelopes: [{ intent: { reason: "multimodal_parse_tool" } }] }],
    };
    await writeFile(summaryFile, JSON.stringify(staleSummary), "utf8");

    repository.findById = async () => {
      throw new Error("display must read the partition authority directly");
    };
    const detail = await runtime.sessionCrudService.getSessionDisplayData({ userId, sessionId });
    assert.equal(
      detail.sessions[0].messages[0].transferEnvelopes[0].intent.reason,
      "multimodal_parse_artifact",
    );

    const cachedDetail = await runtime.sessionCrudService.getSessionDisplayData({
      userId,
      sessionId,
    });
    assert.equal(
      cachedDetail.sessions[0].messages[0].transferEnvelopes[0].intent.reason,
      "multimodal_parse_artifact",
    );
    await runtime.close();
  });
});

test("failed Session repair projects an unavailable list item", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "unavailable-display-source";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    const repository = runtime.repositories.sessionRepository;
    await provisionTestSession(runtime, {
      userId,
      sessionId,
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });

    const scope = await repository.requireSessionScope(
      userId,
      sessionId,
      repository.treePersistenceContext(userId, sessionId),
    );
    await writeFile(
      path.join(scope.sessionDir, PARTITION_JOURNAL_HEAD_FILE),
      "{invalid-json",
      "utf8",
    );
    await assert.rejects(
      repository.readSessionDisplaySummary(userId, sessionId, {
        persistenceContext: repository.treePersistenceContext(userId, sessionId),
      }),
    );

    const { sessions: summaries } = await runtime.sessionCrudService.getAllSessionSummaries({
      userId,
    });
    const unavailable = summaries.find((item) => item.sessionId === sessionId);
    assert.equal(unavailable.availability, "unavailable");
    assert.ok(unavailable.unavailableReason.code);
    await assert.rejects(runtime.close(), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.message, "Journal owner shutdown failed");
      assert.equal(error.errors.length, 1);
      assert.equal(error.errors[0].code, "SESSION_STORAGE_CORRUPT");
      return true;
    });
  });
});

test("list availability covers its local projection while detail and audit reject invalid activity", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "invalid-activity-source";
    const healthyId = "healthy-activity-source";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    const repository = runtime.repositories.sessionRepository;
    for (const id of [sessionId, healthyId]) {
      await provisionTestSession(runtime, {
        userId,
        sessionId: id,
        parentSessionId: "",
        caller: SESSION_CALLER.USER,
      });
    }
    const context = repository.treePersistenceContext(userId, sessionId);
    const scope = await repository.requireSessionScope(userId, sessionId, context);
    const [message] = canonicalMessages(
      [{ role: "assistant", content: "analysis" }],
      sessionId,
      "invalid_activity",
    );
    await commitTestSessionChanges(runtime, {
      userId,
      sessionId,
      changes: { messages: [message] },
    });
    await using owner = new PartitionJournalOwner({
      durableAncestor: workspaceRoot,
      limits: journalTestLimits({ transactionBytes: 16 * 1024 }),
      maxJournals: 1,
    });
    await using lease = await owner.acquire({ ...scope, sessionId });
    const { journal } = lease;
    const transactions = new PartitionTransactions(journal);
    const mutation = await journal.usingSnapshot((snapshot) =>
      transactions.withCollectionReader(snapshot, async (read) => {
        const stored = (
          await read({ collection: "messages", keys: [message.messageUid], includeOwner: true })
        ).get(message.messageUid);
        const record = structuredClone(stored.mutation.value);
        record.message.activityTimeline = [{ eventId: "missing-id" }];
        return {
          collection: "messages",
          key: message.messageUid,
          owner: stored.owner,
          value: record,
        };
      }),
    );
    await commitFixtureTransaction(transactions, {
      epoch: journal.head.epoch,
      expectedGeneration: journal.head.sequence,
      sequence: journal.head.sequence + 1,
      operationId: "invalid-activity",
      input: null,
      mutations: [mutation],
      result: null,
    });
    const headFile = path.join(scope.sessionDir, PARTITION_JOURNAL_HEAD_FILE);
    const sourceBytes = await readFile(headFile);

    const expectedReason = {
      code: ACTIVITY_TIMELINE_ERROR_CODE.FACT_INVALID,
      message: "activity timeline contains a noncanonical fact",
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(
        repository.readSessionDisplaySummary(userId, sessionId, { persistenceContext: context }),
        expectedReason,
      );
      const { sessions } = await runtime.sessionCrudService.getAllSessionSummaries({ userId });
      const listed = sessions.find((entry) => entry.sessionId === sessionId);
      assert.equal(listed.availability, "available");
      assert.equal(listed.messageCount, 1);
      assert.equal(
        sessions.find((entry) => entry.sessionId === healthyId).availability,
        "available",
      );
      const detail = await runtime.sessionCrudService.getSessionDisplayData({ userId, sessionId });
      assert.equal(detail.sessions[0].availability, "unavailable");
      assert.deepEqual(detail.sessions[0].unavailableReason, expectedReason);
      const healthy = await runtime.sessionCrudService.getSessionDisplayData({
        userId,
        sessionId: healthyId,
      });
      assert.equal(healthy.sessions[0].availability, "available");
    }
    assert.deepEqual(await readFile(headFile), sourceBytes);
    await runtime.close();
  });
});
