/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { MIGRATION_UNMAPPABLE_CODE } from "@noobot/shared/migration";
import {
  V3_MESSAGE_IDENTITY_KEY,
  migrateModelContextSnapshot,
} from "../src/policy/snapshot-migration.js";
import { SNAPSHOT_VERSION, hydrateModelContextSnapshot } from "../src/policy/snapshot.js";

const identity = {
  userId: "user-a",
  sessionId: "session-a",
  parentSessionId: "",
  dialogProcessId: "dialog-a",
  turnScopeId: "client-turn:a",
};

function v3Message({ type, id, metadata = {}, raw = {}, lcExtra = {}, extra = {} }) {
  const additional = { [V3_MESSAGE_IDENTITY_KEY]: id, ...metadata };
  return {
    type,
    content: `${type} content`,
    additional_kwargs: additional,
    ...extra,
    raw,
    lc_kwargs: {
      content: `${type} content`,
      additional_kwargs: additional,
      response_metadata: {},
      [V3_MESSAGE_IDENTITY_KEY]: id,
      ...extra,
      ...lcExtra,
    },
    summarized: false,
  };
}

function v3Snapshot(blocks) {
  const messageBlocks = { system: [], history: [], incremental: [], ...blocks };
  return {
    version: 3,
    ...identity,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    messageBlocks,
    messages: [...messageBlocks.system, ...messageBlocks.history, ...messageBlocks.incremental],
    userMetaBackwrites: [],
    turnProgress: { taskCheckLoopCount: 1 },
  };
}

function rejection(reason) {
  return (error) => error.code === MIGRATION_UNMAPPABLE_CODE && error.details.reason === reason;
}

test("v3 snapshot migrates to the current protocol shape", () => {
  const system = v3Message({
    type: "system",
    id: "am_shared",
    raw: {
      messageUid: "am_shared",
      role: "system",
      promptInjectionId: "p",
      messageBlockPolicy: "x",
    },
  });
  const user = v3Message({
    type: "human",
    id: "sm_user",
    metadata: { injectedMessageType: "noobot.user_interjection", injectedMessage: true },
    raw: { dialogProcessId: "dialog-a", turnScopeId: "client-turn:a", purpose: "chat" },
  });
  const tool = v3Message({
    type: "tool",
    id: "sm_tool",
    extra: { tool_call_id: "call-1" },
    lcExtra: { contextPolicy: { semanticClass: "flow_control" } },
  });
  const snapshot = v3Snapshot({ system: [system, { ...system }], incremental: [user, tool] });

  const { document, fromVersion, toVersion, migrated } = migrateModelContextSnapshot(snapshot);

  assert.deepEqual(
    { fromVersion, toVersion, migrated },
    { fromVersion: 3, toVersion: SNAPSHOT_VERSION, migrated: true },
  );
  const [firstSystem, secondSystem] = document.messageBlocks.system;
  assert.match(firstSystem.additional_kwargs.messageUid, /^sm_/);
  assert.equal(secondSystem.additional_kwargs.messageUid, firstSystem.additional_kwargs.messageUid);
  assert.deepEqual(document.messageBlocks.incremental[0].additional_kwargs, {
    messageUid: "sm_user",
    injectedMessageType: "noobot.user_interjection",
    injectedMessage: true,
    dialogProcessId: "dialog-a",
    turnScopeId: "client-turn:a",
  });
  assert.deepEqual(document.messageBlocks.incremental[1], {
    type: "tool",
    content: "tool content",
    additional_kwargs: { messageUid: "sm_tool", contextPolicy: { semanticClass: "flow_control" } },
    tool_call_id: "call-1",
  });
  assert.deepEqual(document.messages, [
    ...document.messageBlocks.system,
    ...document.messageBlocks.incremental,
  ]);
  assert.doesNotThrow(() => hydrateModelContextSnapshot(document, identity));
});

test("v4 snapshots are returned unchanged", () => {
  const document = { version: SNAPSHOT_VERSION, ...identity, messageBlocks: {}, messages: [] };
  const result = migrateModelContextSnapshot(document);
  assert.equal(result.migrated, false);
  assert.equal(result.document, document);
});

test("v2 snapshots are unmappable", () => {
  assert.throws(
    () => migrateModelContextSnapshot({ ...v3Snapshot({}), version: 2 }),
    rejection("unsupported_version"),
  );
});

test("raw metadata conflicting with additional_kwargs is unmappable", () => {
  const message = v3Message({
    type: "human",
    id: "sm_user",
    metadata: { turnScopeId: "client-turn:a" },
    raw: { turnScopeId: "client-turn:b" },
  });
  assert.throws(
    () => migrateModelContextSnapshot(v3Snapshot({ incremental: [message] })),
    rejection("metadata_conflict"),
  );
});

test("unknown raw, message and lc_kwargs keys are unmappable", () => {
  const unknownRaw = v3Message({ type: "human", id: "sm_a", raw: { surprise: 1 } });
  assert.throws(
    () => migrateModelContextSnapshot(v3Snapshot({ incremental: [unknownRaw] })),
    rejection("raw_unknown_key"),
  );
  const unknownTop = { ...v3Message({ type: "human", id: "sm_a" }), surprise: 1 };
  assert.throws(
    () => migrateModelContextSnapshot(v3Snapshot({ incremental: [unknownTop] })),
    rejection("message_unknown_key"),
  );
  const unknownLc = v3Message({ type: "human", id: "sm_a", lcExtra: { surprise: 1 } });
  assert.throws(
    () => migrateModelContextSnapshot(v3Snapshot({ incremental: [unknownLc] })),
    rejection("lc_kwargs_unknown_key"),
  );
});

test("lc_kwargs mirrors that diverge from the original are unmappable", () => {
  const message = v3Message({ type: "human", id: "sm_a" });
  message.lc_kwargs.content = "edited";
  assert.throws(
    () => migrateModelContextSnapshot(v3Snapshot({ incremental: [message] })),
    rejection("lc_kwargs_mirror_mismatch"),
  );
});

test("summarized true moves into metadata", () => {
  const message = { ...v3Message({ type: "human", id: "sm_a" }), summarized: true };
  const { document } = migrateModelContextSnapshot(v3Snapshot({ history: [message] }));
  assert.equal(document.messageBlocks.history[0].additional_kwargs.summarized, true);
});
