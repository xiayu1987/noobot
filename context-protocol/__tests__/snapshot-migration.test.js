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
import { CONTEXT_INTERNAL_MESSAGE_TYPE } from "../src/message/internal-types.js";

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

function v4Snapshot({ system = [], history = [], incremental = [], userMetaBackwrites = [] }) {
  const messageBlocks = { system, history, incremental };
  return {
    version: 4,
    ...identity,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    messageBlocks,
    messages: [...system, ...history, ...incremental],
    userMetaBackwrites,
    turnProgress: {},
  };
}

test("v4 snapshot splits joined identities into projection shapes", () => {
  const systemContext = {
    type: "system",
    content: "ctx",
    additional_kwargs: {
      messageUid: "sm_ctx",
      noobotInternalMessageType: CONTEXT_INTERNAL_MESSAGE_TYPE.SYSTEM_CONTEXT,
    },
  };
  const user = { type: "human", content: "hi", additional_kwargs: { messageUid: "sm_user" } };
  const interjection = {
    type: "human",
    content: "cmd",
    additional_kwargs: { messageUid: "user-interjection:command:8d825804" },
  };
  const userMeta = {
    type: "human",
    content: "meta",
    additional_kwargs: { messageUid: "sm_user::user_meta" },
  };
  const terminal = {
    type: "human",
    content: "terminal",
    additional_kwargs: { messageUid: "client-turn:a::terminal_status" },
  };
  const snapshot = v4Snapshot({
    system: [systemContext],
    history: [user, interjection, userMeta],
    incremental: [terminal],
    userMetaBackwrites: [
      {
        backwriteId: "sm_user::user_meta::backwrite::attachment:a",
        userMetaMessageUid: "sm_user::user_meta",
        attachmentRef: "attachment:a",
        result: { sourceAttachmentRef: "attachment:a" },
        status: "pending",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ],
  });

  const { document, fromVersion, toVersion } = migrateModelContextSnapshot(snapshot);

  assert.deepEqual({ fromVersion, toVersion }, { fromVersion: 4, toVersion: SNAPSHOT_VERSION });
  const [migratedContext] = document.messageBlocks.system;
  assert.equal("messageUid" in migratedContext.additional_kwargs, false);
  assert.match(migratedContext.additional_kwargs.contextMessageId, /^cm_/);
  const [migratedUser, migratedInterjection, migratedMeta] = document.messageBlocks.history;
  assert.deepEqual(migratedUser, user);
  assert.equal(
    migratedInterjection.additional_kwargs.messageUid,
    "user-interjection:command:8d825804",
  );
  assert.deepEqual(migratedMeta.additional_kwargs, {
    projectionType: "user_meta",
    sourceMessageUid: "sm_user",
  });
  assert.deepEqual(document.messageBlocks.incremental[0].additional_kwargs, {
    projectionType: "terminal_status",
    sourceTurnScopeId: "client-turn:a",
  });
  assert.deepEqual(document.userMetaBackwrites, [
    {
      attachmentRef: "attachment:a",
      result: { sourceAttachmentRef: "attachment:a" },
      status: "pending",
      createdAt: "2026-10-01T00:00:00.000Z",
      userMetaSourceMessageUid: "sm_user",
    },
  ]);
  assert.doesNotThrow(() => hydrateModelContextSnapshot(document, identity));
});

test("v4 unknown joined suffix is unmappable", () => {
  const message = {
    type: "human",
    content: "x",
    additional_kwargs: { messageUid: "sm_a::surprise" },
  };
  assert.throws(
    () => migrateModelContextSnapshot(v4Snapshot({ history: [message] })),
    rejection("joined_identity_unknown"),
  );
});

test("v4 backwrite targeting a non user_meta message is unmappable", () => {
  const snapshot = v4Snapshot({
    userMetaBackwrites: [
      { userMetaMessageUid: "sm_user", attachmentRef: "attachment:a", result: {} },
    ],
  });
  assert.throws(
    () => migrateModelContextSnapshot(snapshot),
    rejection("backwrite_target_not_user_meta"),
  );
});

test("current version snapshots are returned unchanged", () => {
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
