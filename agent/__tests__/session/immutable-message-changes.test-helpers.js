/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { IMMUTABLE_TITLE_INDEX_VERSION } from "@noobot/session-protocol/immutable-storage";
import { IMMUTABLE_CONTEXT_INDEX_VERSION } from "@noobot/session-protocol/immutable-storage-graph";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeMessageEntity } from "../../src/session/entities/message-entity.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import {
  ImmutableSessionChanges,
  prepareImmutableMessages,
} from "../../src/session/session-artifact-session/immutable-message-changes.js";
import { IMMUTABLE_MESSAGE_TAIL_VERSION } from "../../src/session/session-artifact-session/immutable-message-tail-index.js";

const timestamp = "2026-01-01T00:00:00.000Z";

function message(messageUid, overrides = {}) {
  const input = {
    messageUid,
    userMessageId: `user-${messageUid}`,
    sessionId: "session-1",
    parentSessionId: "",
    dialogProcessId: "dialog-1",
    parentDialogProcessId: "",
    turnScopeId: "turn-1",
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content: messageUid,
    attachments: [],
    transferEnvelopes: [],
    ts: timestamp,
    ...overrides,
  };
  for (const key of Object.keys(input)) if (input[key] === undefined) delete input[key];
  return normalizeMessageEntity(input);
}

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-messages-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "session-1",
    allowCreate: true,
  });
  await store.commit({
    expectedGeneration: 0,
    operationId: "initialize",
    changes: [
      { collection: "contextDialogRanges", key: "root", value: { ordinals: [] } },
      {
        collection: "metadata",
        key: "messageTailIndex",
        value: { version: IMMUTABLE_MESSAGE_TAIL_VERSION },
      },
      {
        collection: "metadata",
        key: "titleIndex",
        value: { version: IMMUTABLE_TITLE_INDEX_VERSION, root: null },
      },
      { collection: "metadata", key: "lifecycleIndex", value: { version: 1, root: null } },
      {
        collection: "metadata",
        key: "session",
        value: { sessionId: "session-1", parentSessionId: "", updatedAt: timestamp },
      },
      {
        collection: "metadata",
        key: "facts",
        value: {
          contextIndexVersion: IMMUTABLE_CONTEXT_INDEX_VERSION,
          messageCount: 0,
          messageSequence: 0,
          dialogSequence: 0,
          turnSequence: 0,
          lastDialogOrdinal: 0,
          lastMessageOrdinal: 0,
          lastMessageUid: "",
        },
      },
    ],
  });
  return store;
}

async function append(store, messages, operationId = "append") {
  const snapshot = await store.snapshot();
  return store.transact({
    expectedGeneration: snapshot.generation,
    operationId,
    input: { messages, updatedAt: timestamp },
    prepare: async ({ get, getMany, getMetadata, input }) => {
      const plan = new ImmutableSessionChanges(get, { getMany, getMetadata });
      const turns = await prepareImmutableMessages({ store, plan, ...input });
      return { changes: plan.changes(), result: { turns } };
    },
  });
}

export { timestamp, message, fixture, append };
