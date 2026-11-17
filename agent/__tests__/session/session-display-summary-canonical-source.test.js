/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_VERSION } from "@noobot/semantic-transfer-protocol";
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
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
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { ACTIVITY_TIMELINE_ERROR_CODE } from "@noobot/event-protocol/activity-timeline";
import { IMMUTABLE_READER_RETENTION } from "@noobot/session-protocol/immutable-storage";

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
      throw new Error("display must read the immutable authority directly");
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
    assert.deepEqual(
      await readdir(path.join(scope.sessionDir, IMMUTABLE_READER_RETENTION.directory)),
      [],
    );
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
    await writeFile(path.join(scope.sessionDir, "head.json"), "{invalid-json", "utf8");
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
    const store = await ImmutableSessionStore.open({ sessionDir: scope.sessionDir });
    const snapshot = await store.snapshot();

    await store.transact({
      expectedGeneration: snapshot.generation,
      operationId: "invalid-activity",
      input: { messageUid: message.messageUid, turnScopeId: message.turnScopeId },
      prepare: async ({ get, input }) => {
        const record = await get("messages", input.messageUid);
        record.message.activityTimeline = [{ eventId: "missing-id" }];
        const reference = await store.putCollectionValue("messages", input.messageUid, record);
        const turn = await get("turns", input.turnScopeId);
        turn.messagesRoot = await store.index.set(turn.messagesRoot, input.messageUid, reference);
        return {
          changes: [
            { collection: "messages", key: input.messageUid, reference },
            { collection: "turns", key: input.turnScopeId, value: turn },
          ],
        };
      },
    });
    const headFile = path.join(scope.sessionDir, "head.json");
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
      assert.deepEqual(
        await readdir(path.join(scope.sessionDir, IMMUTABLE_READER_RETENTION.directory)),
        [],
      );
    }
    assert.deepEqual(await readFile(headFile), sourceBytes);
  });
});
