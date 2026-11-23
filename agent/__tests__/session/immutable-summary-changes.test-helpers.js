/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { commitSessionChanges } from "../helpers/commit-immutable-session-fixture.js";

export const ts = "2026-01-01T00:00:00.000Z";

export function message(uid, overrides = {}) {
  return {
    messageUid: uid,
    userMessageId: uid,
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "d1",
    parentDialogProcessId: "",
    turnScopeId: "t1",
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content: uid,
    attachments: [],
    transferEnvelopes: [],
    ts,
    ...overrides,
  };
}

export function toolMessages() {
  const call = message("call", {
    role: "assistant",
    type: "tool_call",
    modelMessageId: "model-call",
    presentationMessageId: "p1",
    chatPresentation: false,
    tool_calls: [
      { id: "read-1", type: "function", function: { name: "read_file", arguments: "{}" } },
    ],
  });
  delete call.userMessageId;
  delete call.messageOrigin;
  const result = message("result", {
    role: "tool",
    type: "tool_result",
    presentationMessageId: "p1",
    tool_call_id: "read-1",
    toolName: "read_file",
  });
  delete result.userMessageId;
  delete result.messageOrigin;
  return [call, result];
}

export function checkpoint(overrides = {}) {
  return {
    userId: "admin",
    sessionId: "s1",
    dialogProcessId: "d1",
    turnScopeId: "t1",
    checkpointId: "cp1",
    expectedCheckpointRevision: 0,
    persistedMessageUids: ["m1"],
    summarizedMessageUids: ["m1"],
    retainedMessageUids: [],
    messages: [],
    ...overrides,
  };
}

export async function fixture(t, messages = [message("m1")]) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-summary-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  await initializeImmutableSession({
    sessionDir,
    operationId: "initialize",
    session: {
      sessionId: "s1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 0,
      messages,
      dialogOrder: messages.length
        ? [{ dialogProcessId: "d1", dialogOrdinal: 1, turnScopeId: "t1", userMessageUid: "m1" }]
        : [],
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      createdAt: ts,
      updatedAt: ts,
    },
  });
  return new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
}

export async function commit(store, changes, operationId = "checkpoint") {
  return commitSessionChanges({
    sessionDir: store.sessionDir,
    sessionId: "s1",
    expectedGeneration: (await store.snapshot()).generation,
    operationId,
    changes,
    committedAt: ts,
  });
}
