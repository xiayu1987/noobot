/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { projectContextSource } from "@noobot/context-protocol/assembly/source";
import { readContextMessageField } from "@noobot/context-protocol/message/codec";
import { turnRecord } from "../helpers/turn-record.js";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { readImmutableContextSource } from "../../src/session/session-artifact-session/immutable-context-reader.js";
import { readImmutableTurnPage } from "../../src/session/session-artifact-session/immutable-message-reader.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { collectValueRecords, forbidRecordReads } from "./helpers/immutable-record-reads.js";

const ts = "2026-07-30T00:00:00.000Z";
function message(uid, overrides = {}) {
  return {
    messageUid: uid,
    userMessageId: uid,
    sessionId: "deferred",
    parentSessionId: "",
    dialogProcessId: "dialog",
    parentDialogProcessId: "",
    turnScopeId: "turn",
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content: `${uid}:` + "中文🙂".repeat(10000),
    attachments: [],
    ts,
    ...overrides,
  };
}

for (const state of ["completed", "stop_completed", "processing_failed"]) {
  test(`context ${state} only opens protocol-selected bodies and pins the source snapshot`, async (t) => {
    const sessionDir = await mkdtemp(path.join(tmpdir(), "context-deferred-"));
    t.after(() => rm(sessionDir, { recursive: true, force: true }));
    const assistant = message("discarded", {
      role: "assistant",
      modelMessageId: "discarded-model",
      presentationMessageId: "message-turn",
      chatPresentation: false,
      summarized: true,
    });
    delete assistant.messageOrigin;
    delete assistant.userMessageId;
    const injection = (uid) => {
      const value = message(uid, {
        injectedMessage: true,
        injectedBy: "fixture",
        injectedMessageType: "summary",
        summarized: true,
      });
      delete value.messageOrigin;
      return value;
    };
    const messages = [
      message("user", { summarized: state !== "completed" }),
      injection("old-injection"),
      assistant,
      injection("latest-injection"),
    ];
    const turnLifecycle = {
      ...createEmptyTurnLifecycle(),
      sequence: 1,
      turns: { turn: turnRecord({ turnScopeId: "turn", dialogProcessId: "dialog", state }) },
    };
    await initializeImmutableSession({
      sessionDir,
      operationId: "initialize",
      session: {
        sessionId: "deferred",
        parentSessionId: "",
        caller: SESSION_CALLER.USER,
        aggregateVersion: 0,
        messages,
        dialogOrder: [
          {
            dialogProcessId: "dialog",
            dialogOrdinal: 1,
            turnScopeId: "turn",
            userMessageUid: "user",
          },
        ],
        turnTimings: [],
        sessionArtifactEvents: [],
        turnLifecycle,
        createdAt: ts,
        updatedAt: ts,
      },
    });
    const store = await ImmutableSessionStore.open({ sessionDir });
    const snapshot = await store.snapshot();
    const page = await readImmutableTurnPage({ store, snapshot, turnScopeId: "turn" });
    const options = { scope: {}, historyLimit: 1 };
    const expected = projectContextSource({
      ...options,
      source: { messages: page.records.map(({ message }) => message), turnLifecycle },
    });
    const selected = new Set(
      expected.messages.map((value) => readContextMessageField(value, "messageUid")),
    );
    const forbidden = new Set();
    const required = new Set();
    await store.objects.withSnapshot(snapshot, async () => {
      for (const value of messages) {
        const metadata = await store.getManyMetadata(snapshot, "messages", [value.messageUid]);
        for (const part of metadata.get(value.messageUid).parts)
          await collectValueRecords(
            store,
            part.reference,
            selected.has(value.messageUid) ? required : forbidden,
          );
      }
    });
    for (const reference of required) forbidden.delete(reference);
    assert.ok(forbidden.size > 0);
    await store.commit({
      expectedGeneration: snapshot.generation,
      operationId: "remove-current-message",
      changes: [{ collection: "messages", key: "user", remove: true }],
    });
    setFsAdapter(await forbidRecordReads(store, forbidden));
    try {
      const cold = await ImmutableSessionStore.open({ sessionDir });
      const source = await readImmutableContextSource({ store: cold, snapshot, ...options });
      assert.deepEqual(projectContextSource({ source, ...options }), expected);
      assert.deepEqual(
        new Set(source.messages.map(({ messageUid }) => messageUid)),
        new Set([...selected].filter(Boolean)),
      );
    } finally {
      resetFsAdapter();
    }
  });
}
