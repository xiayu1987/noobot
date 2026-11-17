/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, rename } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  createEmptyTurnLifecycle,
  SESSION_ARTIFACT_SCHEMA_VERSION,
} from "@noobot/session-protocol";
import { createTaskSummaryReceipt } from "@noobot/context-protocol/task/summary";
import { initializeImmutableSession } from "../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../src/session/session-artifact-session/immutable-session-store.js";
import {
  migrateImmutablePhaseSummaries,
  upgradeSessionPhaseSummaries,
} from "../src/workspace-lifecycle/session-phase-summary-upgrade.js";
import { upgradeModelContextSnapshots } from "../src/workspace-lifecycle/model-context-snapshot-upgrade.js";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { TEST_STORAGE_SERVICE } from "./helpers/storage-service.js";
import { TEST_SCOPED_SESSION_ROOTS } from "./helpers/scoped-session-roots.js";
import { readImmutableTurnPage } from "../src/session/session-artifact-session/immutable-message-reader.js";
import { setFsAdapter, resetFsAdapter } from "../src/shared/storage/fs-adapter.js";

const body =
  "NOOBOT_TASK_SUMMARY/1\n[STATE]\nCONTINUE\n[ABSTRACT]\nprogress\n[DETAILS]\ncomplete original body\n[NEXT_ACTION]\ncontinue";
const ts = "2026-01-01T00:00:00.000Z";
async function fixture(t) {
  const workspaceBase = await mkdtemp(path.join(tmpdir(), "phase-summary-upgrade-"));
  t.after(() => rm(workspaceBase, { recursive: true, force: true }));
  const sessionDir = path.join(workspaceBase, WORKSPACE_LAYOUT.SESSION_DIR, "s1");
  const base = {
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "d1",
    parentDialogProcessId: "",
    turnScopeId: "t1",
    ts,
    attachments: [],
    transferEnvelopes: [],
  };
  const messages = [
    {
      ...base,
      messageUid: "user",
      userMessageId: "u1",
      role: "user",
      messageOrigin: "natural",
      type: "message",
      content: "work",
    },
    {
      ...base,
      messageUid: "call",
      modelMessageId: "mm1",
      presentationMessageId: "p1",
      role: "assistant",
      type: "tool_call",
      chatPresentation: false,
      content: "",
      tool_calls: [
        {
          id: "summary",
          type: "function",
          function: { name: "task_summary", arguments: JSON.stringify({ summaryContent: body }) },
        },
      ],
    },
    {
      ...base,
      messageUid: "result",
      presentationMessageId: "p1",
      role: "tool",
      type: "tool_result",
      toolName: "task_summary",
      tool_call_id: "summary",
      content: JSON.stringify({
        ok: true,
        toolName: "task_summary",
        protocolVersion: 1,
        summary: createTaskSummaryReceipt(body),
      }),
    },
  ];
  await initializeImmutableSession({
    sessionDir,
    operationId: "initialize",
    session: {
      sessionId: "s1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 0,
      schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION - 1,
      messages,
      dialogOrder: [
        { dialogProcessId: "d1", dialogOrdinal: 1, turnScopeId: "t1", userMessageUid: "user" },
      ],
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      createdAt: ts,
      updatedAt: ts,
    },
  });
  return { workspaceBase, sessionDir, store: await ImmutableSessionStore.open({ sessionDir }) };
}

test("phase summary upgrade atomically converts both indexes, preserves UID and is idempotent", async (t) => {
  const { sessionDir, store } = await fixture(t);
  const previous = await store.snapshot();
  await migrateImmutablePhaseSummaries({ sessionDir });
  const current = await store.snapshot();
  const result = (await store.get(current, "messages", "result")).message;
  assert.equal(result.role, "user");
  assert.equal(result.type, "message");
  assert.equal(result.content, body);
  assert.equal(result.messageUid, "result");
  assert.equal(result.injectedMessageType, "noobot.phase_summary_result");
  assert.equal((await store.get(previous, "messages", "result")).message.role, "tool");
  assert.equal(
    (await store.get(current, "metadata", "session")).schemaVersion,
    SESSION_ARTIFACT_SCHEMA_VERSION,
  );
  const page = await readImmutableTurnPage({ store, snapshot: current, turnScopeId: "t1" });
  assert.deepEqual(
    page.records.find((record) => record.message.messageUid === "result").message,
    result,
  );
  assert.equal(
    Object.hasOwn((await store.get(current, "messages", "call")).message, "tool_calls"),
    false,
  );
  assert.deepEqual([...(await Array.fromAsync(store.entries(current, "toolPairs")))], []);
  await migrateImmutablePhaseSummaries({ sessionDir });
  assert.deepEqual(await store.snapshot(), current);
});

test("phase summary publication failure leaves old generation intact and permits retry", async (t) => {
  const { sessionDir, store } = await fixture(t);
  const previous = await store.snapshot();
  setFsAdapter({
    rename: async (source, target) => {
      if (target === store.headPath)
        throw Object.assign(new Error("injected publication failure"), { code: "EIO" });
      return rename(source, target);
    },
  });
  try {
    await assert.rejects(migrateImmutablePhaseSummaries({ sessionDir }), {
      code: "SESSION_COMMIT_UNCERTAIN",
    });
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await store.snapshot(), previous);
  assert.equal((await store.get(previous, "messages", "result")).message.role, "tool");
  await migrateImmutablePhaseSummaries({ sessionDir });
  assert.equal(
    (await store.get(await store.snapshot(), "messages", "result")).message.content,
    body,
  );
});

test("workspace upgrade restores receipts after session migration, including already current snapshots", async (t) => {
  const { workspaceBase, sessionDir, store } = await fixture(t);
  const directory = path.join(sessionDir, "model-message-snapshots");
  await mkdir(directory, { recursive: true });
  const message = {
    type: "human",
    content: "receipt only",
    additional_kwargs: {
      projectionType: "phase_summary",
      sourceMessageUid: "result",
      noobotInternalMessageType: "phase_summary_memory",
      dialogProcessId: "d1",
      turnScopeId: "t1",
    },
  };
  const snapshot = {
    version: 6,
    userId: "admin",
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "d1",
    turnScopeId: "t1",
    messageBlocks: { system: [], history: [message], incremental: [] },
    messages: [message],
  };
  const file = path.join(directory, "summary.json");
  await writeFile(file, JSON.stringify(snapshot));
  const options = {
    base: workspaceBase,
    backupBase: path.join(workspaceBase, "backup"),
    scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
    storageService: TEST_STORAGE_SERVICE,
  };
  const structural = await upgradeModelContextSnapshots(options);
  assert.deepEqual(structural.quarantined, []);
  assert.equal(structural.migrated.length, 1);
  assert.equal(JSON.parse(await readFile(file, "utf8")).messages[0].content, "receipt only");
  assert.equal(
    (await store.get(await store.snapshot(), "messages", "result")).message.role,
    "tool",
  );
  const result = await upgradeSessionPhaseSummaries(options);
  assert.deepEqual(result.snapshots.quarantined, []);
  assert.equal(result.snapshots.migrated.length, 1);
  const restored = JSON.parse(await readFile(file, "utf8"));
  assert.equal(restored.messages[0].content, body);
  assert.equal(restored.messages[0].additional_kwargs.messageUid, "result");
  assert.equal(restored.messages[0].additional_kwargs.turnScopeId, "t1");
  const again = await upgradeSessionPhaseSummaries(options);
  assert.deepEqual(again.snapshots, { migrated: [], quarantined: [] });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), restored);
});
