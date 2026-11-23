/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { commitSessionChanges } from "../helpers/commit-immutable-session-fixture.js";
import { readImmutableContextSource } from "../../src/session/session-artifact-session/immutable-context-reader.js";

const ts = "2026-01-01T00:00:00.000Z";

const invalid = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };

function message(id) {
  return {
    messageUid: `m-${id}`,
    userMessageId: `u-${id}`,
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: `d-${id}`,
    parentDialogProcessId: "",
    turnScopeId: `t-${id}`,
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content: id,
    attachments: [],
    ts,
  };
}

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-context-tail-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const messages = [message("keep"), message("current")];
  await initializeImmutableSession({
    sessionDir,
    operationId: "initialize",
    session: {
      sessionId: "s1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 0,
      messages,
      dialogOrder: messages.map((item, index) => ({
        dialogProcessId: item.dialogProcessId,
        turnScopeId: item.turnScopeId,
        userMessageUid: item.messageUid,
        dialogOrdinal: index + 1,
      })),
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      createdAt: ts,
      updatedAt: ts,
    },
  });
  return new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
}

async function commit(store, operationId, changes) {
  return commitSessionChanges({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: (await store.snapshot()).generation,
    operationId,
    committedAt: ts,
    changes,
  });
}

function read(store, snapshot, options = {}) {
  return readImmutableContextSource({ store, snapshot, scope: {}, historyLimit: 1, ...options });
}

async function corrupt(store, changes) {
  await store.commit({
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "corrupt",
    changes,
  });
  return store.snapshot();
}

function assistantMessage(id, fields = {}) {
  const record = {
    ...message(id),
    role: "assistant",
    modelMessageId: `model-${id}`,
    presentationMessageId: `presentation-${id}`,
    ...fields,
  };
  delete record.userMessageId;
  delete record.messageOrigin;
  return record;
}

export { invalid, message, fixture, commit, read, corrupt, assistantMessage };
