/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createSessionServices } from "../../src/session/index.js";
import {
  canonicalMessages,
  withTempWorkspace,
} from "./session-repository-boundary.summaries.fixtures.js";

function canonicalTransferEnvelope(sessionId) {
  return {
    protocol: "noobot.semantic-transfer",
    version: 2,
    transferId: "transfer:multimodal-parse-1",
    messageId: "message-1",
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
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });
    const repository = runtime.repositories.sessionRepository;
    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId });
    await runtime.sessionCrudService.ensureSession(userId, sessionId, "");

    const session = await repository.findById(userId, sessionId, "");
    session.messages = canonicalMessages(
      [
        {
          role: "assistant",
          content: "parsed",
          transferEnvelopes: [canonicalTransferEnvelope(sessionId)],
        },
      ],
      "canonical_display",
    );
    await repository.save(userId, session, "");

    const scope = await repository.resolveSessionScope(userId, sessionId, "");
    const summaryFile = path.join(scope.sessionDir, "session-summary.json");
    const staleSummary = JSON.parse(await readFile(summaryFile, "utf8"));
    staleSummary.messages[0].transferEnvelopes[0].intent.reason = "multimodal_parse_tool";
    await writeFile(summaryFile, JSON.stringify(staleSummary), "utf8");

    const findById = repository.findById.bind(repository);
    let canonicalReads = 0;
    repository.findById = async (...args) => {
      canonicalReads += 1;
      return findById(...args);
    };
    const detail = await runtime.sessionCrudService.getSessionDisplayData({ userId, sessionId });
    assert.equal(canonicalReads, 1);
    assert.equal(
      detail.sessions[0].messages[0].transferEnvelopes[0].intent.reason,
      "multimodal_parse_artifact",
    );

    repository.findById = async () => {
      throw new Error("canonical Session should not be materialized on a cache hit");
    };
    const cachedDetail = await runtime.sessionCrudService.getSessionDisplayData({
      userId,
      sessionId,
    });
    assert.equal(
      cachedDetail.sessions[0].messages[0].transferEnvelopes[0].intent.reason,
      "multimodal_parse_artifact",
    );
    const maintenance = await runtime.sessionCrudService.maintainSessionDisplaySummaries({
      userId,
    });
    assert.deepEqual(maintenance.migratedSessionIds, []);
    assert.deepEqual(maintenance.rebuiltSessionIds, []);
  });
});

test("failed Session repair projects an unavailable list item", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "unavailable-display-source";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });
    const repository = runtime.repositories.sessionRepository;
    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId });
    await runtime.sessionCrudService.ensureSession(userId, sessionId, "");

    const scope = await repository.resolveSessionScope(userId, sessionId, "");
    await writeFile(scope.sessionFile, "{invalid-json", "utf8");
    await assert.rejects(repository.readSessionDisplaySummary(userId, sessionId, ""));

    const summaries = await runtime.sessionCrudService.getAllSessionSummaries({ userId });
    const unavailable = summaries.find((item) => item.sessionId === sessionId);
    assert.equal(unavailable.availability, "unavailable");
    assert.ok(unavailable.unavailableReason.code);
  });
});
