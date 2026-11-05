/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SessionMessageService } from "../../src/session/services/session-message-service.js";
import { createToolRiskAssessment } from "../../src/tools/execution/tool-risk.js";
import { readAuthorityOutbox } from "../../src/session/authority-outbox-store/outbox-journal.js";
import { buildHarness } from "./scoped-session-repositories.fixtures.js";
import { writeSessionArtifact } from "./session-artifact-store-v2.test-helpers.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";
import { testWallClock } from "../helpers/session-services.js";

const ts = "2026-11-01T00:00:00.000Z";

test("message event commit has constant snapshot IO and preserves durable starts before projection", async (t) => {
  const harness = buildHarness();
  const { sessionRepo, storageService } = await harness.setup();
  t.after(() => harness.cleanup());
  const userId = "alice";
  const sessionId = "event-performance";
  const persistenceContext = sessionRepo.treePersistenceContext(userId, sessionId);
  await sessionRepo.ensureSession({
    userId,
    sessionId,
    parentSessionId: "",
    caller: "user",
    persistenceContext,
  });
  const scope = await sessionRepo.requireSessionScope(userId, sessionId, persistenceContext);
  const service = new SessionMessageService({ sessionRepo, now: testWallClock });
  let jsonReads = [];
  const readJson = storageService.readJson.bind(storageService);
  storageService.readJson = async (file) => {
    jsonReads.push(file);
    return readJson(file);
  };
  let manifestReads = 0;
  const readOptionalJson = storageService.readOptionalJson.bind(storageService);
  storageService.readOptionalJson = async (file) => {
    if (file === scope.sessionFile) manifestReads += 1;
    return readOptionalJson(file);
  };
  sessionRepo.requireById = async () => {
    throw new Error("message commit must not hydrate the session");
  };
  for (const count of [1, 8, 32]) {
    await writeSessionArtifact({
      sessionDir: scope.sessionDir,
      sessionPayload: {
        ...createTestSessionRequiredFields(),
        sessionId,
        aggregateVersion: 0,
        messages: [
          {
            role: "user",
            messageUid: "m1",
            content: "x".repeat(65536),
            ts,
            dialogProcessId: "dialog-active",
            turnScopeId: "active",
          },
        ],
        turnSummaryCheckpoints: {
          active: {
            dialogProcessId: "dialog-active",
            turnScopeId: "active",
            checkpointRevision: count,
            receipts: Array.from({ length: count }, (_, i) => ({
              checkpointId: `checkpoint-${i + 1}`,
              checkpointRevision: i + 1,
              requestHash: "sha256:fixture",
              persistedMessageUids: ["m1"],
              summarizedMessageUids: ["m1"],
              retainedMessageUids: [],
              markedCount: 1,
              committedAt: ts,
            })),
          },
        },
      },
    });
    const beforeManifest = await readFile(scope.sessionFile, "utf8");
    jsonReads = [];
    manifestReads = 0;
    const samples = [];
    for (let i = 0; i < 5; i += 1) {
      const call = { id: `call-${count}-${i}`, name: "read_file", args: {} };
      const risk = createToolRiskAssessment(call);
      const started = performance.now();
      const result = await service.commitMessageEvent({
        userId,
        sessionId,
        persistenceContext,
        turnScopeId: "active",
        executionId: "run",
        commandId: "command",
        correlationId: "active",
        producer: { type: "agent", id: "runtime" },
        payload: {
          eventType: "tool_call_start",
          tool: call.name,
          toolCallId: call.id,
          args: {},
          riskLevel: "low",
          securityAssessment: risk.current,
          presentationMessageId: "pm_active",
          dialogProcessId: "dialog-active",
          parentSessionId: "",
        },
      });
      samples.push(performance.now() - started);
      assert.equal(result.committed, true);
    }
    assert.equal(manifestReads, 5, "one raw manifest read per commit");
    assert.equal(jsonReads.length, 0, "no snapshot or session hydration reads");
    assert.equal(
      await readFile(scope.sessionFile, "utf8"),
      beforeManifest,
      "event durability does not require projection writes",
    );
    const restartedService = new SessionMessageService({ sessionRepo, now: testWallClock });
    const pending = await restartedService.getPendingAuthorityEvents({
      userId,
      sessionId,
      persistenceContext,
      consumerId: "test-recovery",
    });
    assert.ok(
      pending.events.some((item) => item.envelope.payload.toolCallId === `call-${count}-0`),
    );
    assert.equal(
      (await readAuthorityOutbox(scope.sessionDir)).length,
      count === 1 ? 5 : count === 8 ? 10 : 15,
    );
    samples.sort((a, b) => a - b);
    t.diagnostic(
      `${count} snapshots: message commit median ${samples[2].toFixed(2)}ms, snapshot JSON reads=0`,
    );
  }
});
