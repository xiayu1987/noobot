/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import {
  createTestSessionServices,
  provisionTestSession,
  withTreeContext,
  submitTestSessionRequest,
} from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { normalizeMessageEntity } from "../../src/session/entities/message-entity.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  PARTITION_MESSAGE_COLLECTIONS,
  partitionMessageEntryKey,
} from "@noobot/session-protocol/partition-session-messages";
import { createSessionTurnLifecycleSnapshot } from "../../src/session/session-turn-read-model.js";

test("session metadata and current turn identity never materialize historical message bodies", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-settings-"));
  const runtime = createTestSessionServices({ workspaceRoot });
  try {
    await initializeUserWorkspace(workspaceRoot, "u1");
    await provisionTestSession(runtime, {
      userId: "u1",
      sessionId: "A",
      caller: SESSION_CALLER.USER,
    });
    const repo = runtime.repositories.sessionRepository;
    const context = withTreeContext(runtime, { userId: "u1", sessionId: "A" });
    const session = await repo.requireById("u1", "A", context);
    session.messages = ["title", "old", "last"].map((id) => ({
      messageUid: `message-${id}`,
      userMessageId: `user-${id}`,
      ts: "2026-11-12T00:00:00.000Z",
      sessionId: "A",
      role: "user",
      messageOrigin: "natural",
      content: id,
      dialogProcessId: `dialog-${id}`,
      turnScopeId: `turn-${id}`,
      attachments: [],
      transferEnvelopes: [],
    }));
    await using initial = await repo.requireSessionReader("u1", "A", context);
    await submitTestSessionRequest(
      repo,
      "u1",
      "A",
      await initial.prepareRequest({
        operationId: "seed-messages",
        committedAt: "2026-11-12T00:00:00.000Z",
        changes: { messages: session.messages.map(normalizeMessageEntity) },
      }),
      context.persistenceContext,
    );
    await using beforeReader = await repo.requireSessionReader("u1", "A", context);
    const before = await beforeReader.readMetadata();
    const messageEntries = (reader) =>
      Promise.all(
        session.messages.map(({ messageUid }) => reader.readMessageEntry({ messageUid })),
      );
    const beforeMessages = await messageEntries(beforeReader);
    const snapshotOptions = {
      commandId: "query-lifecycle",
      knownSequence: 0,
      terminalLimit: 10,
      recovery: "none",
      generatedAt: "2026-11-12T00:00:00.000Z",
    };
    const expectedSnapshot = createSessionTurnLifecycleSnapshot({
      ...snapshotOptions,
      session,
      messageTurnScopeIds: session.messages.map((message) => message.turnScopeId),
    });
    const content = PARTITION_MESSAGE_COLLECTIONS.content;
    const oldContentKey = partitionMessageEntryKey(content, "message-old", 1);
    const withCollectionReader = PartitionTransactions.prototype.withCollectionReader;
    t.mock.method(
      PartitionTransactions.prototype,
      "withCollectionReader",
      function (snapshot, operation, options) {
        return withCollectionReader.call(
          this,
          snapshot,
          (read) =>
            operation(
              Object.assign((query) => {
                if (query.collection === content && query.keys.includes(oldContentKey)) {
                  throw new Error("unrelated historical message body read is forbidden");
                }
                return read(query);
              }, read),
            ),
          options,
        );
      },
    );
    await assert.rejects(
      beforeReader.readMessageContentPage({
        messageUid: "message-old",
        byteOffset: 0,
        maxBytes: 64,
        expectedContentReference: null,
      }),
      /unrelated historical message body read is forbidden/,
    );
    t.mock.method(repo, "requireById", () => {
      throw new Error("full session read is forbidden");
    });
    assert.equal(repo.save, undefined, "full session writes have no runtime entry point");
    t.mock.method(repo, "findById", () => {
      throw new Error("full session read is forbidden");
    });
    const source = await repo.findTurnLifecycleSource("u1", "A", {
      ...context,
      terminalLimit: snapshotOptions.terminalLimit,
    });
    assert.deepEqual(source.messageTurnScopeIds, [], "messages alone are not lifecycle candidates");
    assert.equal(Object.hasOwn(source, "messages"), false);
    assert.deepEqual(
      createSessionTurnLifecycleSnapshot({
        ...snapshotOptions,
        session: source,
        messageTurnScopeIds: source.messageTurnScopeIds,
      }),
      expectedSnapshot,
    );
    const snapshot = await runtime.sessionMessageService.getTurnLifecycleSnapshot({
      ...context,
      ...snapshotOptions,
      resolveRecovery: async () => "none",
    });
    assert.equal(snapshot.found, true);
    assert.equal(snapshot.snapshot.sessionId, "A");
    const terminal = await runtime.sessionCrudService.resolveTurnTerminalState({
      ...context,
      turnScopeId: "turn-last",
      commandId: "query-terminal",
    });
    assert.equal(terminal.reason, "turn_not_found");
    assert.equal(terminal.aggregateVersion, before.aggregateVersion);
    const identity = await runtime.sessionMessageService.assertReusedUserTurnIdentity({
      ...context,
      turnScopeId: "turn-last",
      dialogProcessId: "dialog-last",
      attachments: [],
    });
    assert.equal(identity.asserted, true);
    assert.equal(identity.userMessage.messageUid, "message-last");
    await assert.rejects(
      runtime.sessionMessageService.assertReusedUserTurnIdentity({
        ...context,
        turnScopeId: "turn-last",
        dialogProcessId: "wrong-dialog",
      }),
      /dialogProcessId does not match Session authority/,
    );
    await runtime.sessionCrudService.setSessionModelAlias({ ...context, modelAlias: "test-model" });
    await runtime.sessionCrudService.renameSession({ ...context, title: "新名称" });
    await runtime.sessionCrudService.setRootSessionSelectedConnectorIds({
      ...context,
      selectedConnectorIds: ["connector-one"],
    });
    await using afterReader = await repo.requireSessionReader("u1", "A", context);
    const after = await afterReader.readMetadata();
    assert.deepEqual(await messageEntries(afterReader), beforeMessages);
    assert.equal(after.aggregateVersion, before.aggregateVersion);
    assert.equal(after.modelAlias, "test-model");
    assert.equal(after.customTitle, "新名称");
    assert.deepEqual(after.selectedConnectorIds, ["connector-one"]);
    const artifact = await runtime.sessionMessageService.getPluginArtifact({
      ...context,
      pluginId: "test-plugin",
      artifactType: "test",
      artifactId: "missing",
    });
    assert.deepEqual(artifact, { found: false, artifact: null, revision: 0 });
    const summary = await repo.readSessionsSummary("u1");
    assert.equal(summary.sessions.find((item) => item.sessionId === "A").title, "新名称");
    const rebuilt = await repo.readSessionsSummary("u1");
    const entry = rebuilt.sessions.find((item) => item.sessionId === "A");
    assert.equal(entry.availability, "available");
    assert.equal(entry.title, "新名称");
    assert.equal(entry.messageCount, 3);
    assert.equal(entry.lastMessage.messageUid, "message-last");
  } finally {
    t.mock.restoreAll();
    await runtime.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
