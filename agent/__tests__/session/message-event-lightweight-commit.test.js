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
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { PARTITION_JOURNAL_HEAD_FILE } from "@noobot/session-protocol/partition-journal";
import { buildHarness } from "./scoped-session-repositories.fixtures.js";
import { testWallClock, submitTestSessionRequest } from "../helpers/session-services.js";
import { deliveryReceiptOf } from "./turn-lifecycle-session-contract.test-helpers.js";

const ts = "2026-11-01T00:00:00.000Z";

function guardEventQuery(query) {
  const guard = (input) => {
    assert.ok(!["messageContent", "checkpoints"].includes(input.collection));
    return query(input);
  };
  guard.readWindow = (input) => {
    assert.ok(!["messageContent", "checkpoints"].includes(input.collection));
    return query.readWindow(input);
  };
  return guard;
}

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
  const committedEventIds = [];
  for (const count of [1, 8, 32]) {
    let reader = await sessionRepo.requireSessionReader(userId, sessionId, { persistenceContext });
    let revision = (await reader.readCheckpointState("active"))?.checkpointRevision ?? 0;
    while (revision < count) {
      const messages =
        revision === 0
          ? [
              {
                role: "user",
                messageOrigin: "natural",
                messageUid: "m1",
                sessionId,
                parentSessionId: "",
                userMessageId: "m1",
                type: "message",
                content: "x".repeat(4096),
                ts,
                dialogProcessId: "dialog-active",
                turnScopeId: "active",
                attachments: [],
                transferEnvelopes: [],
              },
            ]
          : [];
      await submitTestSessionRequest(
        sessionRepo,
        userId,
        sessionId,
        await reader.prepareRequest({
          operationId: `checkpoint-${revision + 1}`,
          committedAt: ts,
          changes: {
            messages,
            summaryCheckpoints: [
              {
                userId,
                sessionId,
                dialogProcessId: "dialog-active",
                turnScopeId: "active",
                checkpointId: `checkpoint-${revision + 1}`,
                expectedCheckpointRevision: revision,
                persistedMessageUids: ["m1"],
                summarizedMessageUids: ["m1"],
                retainedMessageUids: [],
                messages,
              },
            ],
          },
        }),
        persistenceContext,
      );
      await reader.close();
      reader = await sessionRepo.requireSessionReader(userId, sessionId, { persistenceContext });
      revision += 1;
    }
    const beforeHead = await readFile(`${scope.sessionDir}/${PARTITION_JOURNAL_HEAD_FILE}`, "utf8");
    if (count === 1) {
      for (let chunk = 1; chunk < 16; chunk += 1) {
        await using current = await sessionRepo.requireSessionReader(userId, sessionId, {
          persistenceContext,
        });
        const entry = await current.readMessageEntry({ messageUid: "m1" });
        await submitTestSessionRequest(
          sessionRepo,
          userId,
          sessionId,
          await current.prepareRequest({
            operationId: `body-${chunk}`,
            committedAt: ts,
            changes: {
              messageContentAppends: [
                {
                  messageUid: "m1",
                  dialogProcessId: "dialog-active",
                  turnScopeId: "active",
                  owner: entry.owner,
                  expectedContentReference: entry.contentReference,
                  content: "x".repeat(4096),
                },
              ],
            },
          }),
          persistenceContext,
        );
      }
      await reader.close();
      reader = await sessionRepo.requireSessionReader(userId, sessionId, { persistenceContext });
      const { contentReference } = await reader.readMessageEntry({ messageUid: "m1" });
      const chunks = [];
      let cursor = null;
      do {
        const page = await reader.readContentPage({
          messageUid: "m1",
          dialogProcessId: "dialog-active",
          turnScopeId: "active",
          contentReference,
          cursor,
          limit: 1,
        });
        chunks.push(...page.entries);
        cursor = page.nextCursor;
      } while (cursor !== null);
      assert.equal(chunks.join(""), "x".repeat(65536));
    }
    const get = PartitionTransactions.prototype.withCollectionReader;
    const bodyReads = t.mock.method(
      PartitionTransactions.prototype,
      "withCollectionReader",
      function (snapshot, operation, options) {
        return get.call(this, snapshot, (query) => operation(guardEventQuery(query)), options);
      },
    );
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
      committedEventIds.push(result.envelope.identity.eventId);
    }
    bodyReads.mock.restore();
    assert.equal(manifestReads, 0, "no legacy manifest reads");
    assert.equal(jsonReads.length, 0, "no snapshot or session hydration reads");
    assert.notEqual(
      await readFile(`${scope.sessionDir}/${PARTITION_JOURNAL_HEAD_FILE}`, "utf8"),
      beforeHead,
    );
    await using after = await sessionRepo.requireSessionReader(userId, sessionId, {
      persistenceContext,
    });
    assert.equal(after.generation, reader.generation + 5);
    assert.equal((await after.readDisplaySourceCounts()).messageCount, 1);
    await reader.close();
    const restartedService = new SessionMessageService({ sessionRepo, now: testWallClock });
    const history = {
      userId,
      sessionId,
      persistenceContext,
      consumerId: `test-recovery-${count}`,
    };
    const recoveredEventIds = [];
    let pending;
    do {
      pending = await restartedService.getPendingAuthorityEvents(history);
      assert.equal(pending.found, true);
      assert.ok(pending.events.length > 0);
      recoveredEventIds.push(...pending.events.map(({ eventId }) => eventId));
      assert.deepEqual(recoveredEventIds, committedEventIds.slice(0, recoveredEventIds.length));
      const acknowledged = await restartedService.acknowledgeAuthorityEvents({
        ...history,
        acknowledgements: pending.events.map(({ envelope }) => deliveryReceiptOf(envelope)),
      });
      assert.equal(acknowledged.delivered, pending.events.length);
      assert.equal(acknowledged.drained, !pending.hasMore);
    } while (pending.hasMore);
    assert.deepEqual(recoveredEventIds, committedEventIds);
    assert.deepEqual(await restartedService.getPendingAuthorityEvents(history), {
      found: true,
      events: [],
      hasMore: false,
    });
    samples.sort((a, b) => a - b);
    t.diagnostic(
      `${count} snapshots: message commit median ${samples[2].toFixed(2)}ms, snapshot JSON reads=0`,
    );
  }
});
