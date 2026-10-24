/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";
import {
  SNAPSHOT_VERSION,
  composeMessagesFromBlocks,
  hydrateModelContextSnapshot,
  projectSnapshotIncrementalToContinuation,
  serializeContextMessage,
} from "@noobot/context-protocol/policy/snapshot";
import { fingerprintDiagnosticMessages } from "@noobot/shared/message-diagnostics";
import { text } from "@noobot/shared/value";

function isPlainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== "[object Object]") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertModelMessageSnapshot(snapshot) {
  expect(snapshot.version).toBe(SNAPSHOT_VERSION);
  expect(snapshot.sessionId).toBeTruthy();
  expect(snapshot.dialogProcessId).toBeTruthy();
  expect(snapshot.turnScopeId).toBeTruthy();
  for (const name of ["system", "history", "incremental"]) {
    expect(Array.isArray(snapshot.messageBlocks?.[name])).toBe(true);
    for (const block of snapshot.messageBlocks[name]) expect(isPlainObject(block)).toBe(true);
  }
  expect(Array.isArray(snapshot.userMetaBackwrites)).toBe(true);
  const backwriteRelations = new Set();
  for (const backwrite of snapshot.userMetaBackwrites) {
    expect(isPlainObject(backwrite)).toBe(true);
    expect(text(backwrite.userMetaSourceMessageUid)).toBeTruthy();
    expect(text(backwrite.attachmentRef)).toBeTruthy();
    const relation = JSON.stringify([backwrite.userMetaSourceMessageUid, backwrite.attachmentRef]);
    expect(backwriteRelations.has(relation)).toBe(false);
    backwriteRelations.add(relation);
  }
  expect(Date.parse(snapshot.updatedAt)).toBeGreaterThanOrEqual(Date.parse(snapshot.createdAt));
}

function serializedToolCalls(message = {}) {
  return message.type === "ai" && Array.isArray(message.tool_calls) ? message.tool_calls : [];
}

function toolCallId(call = {}) {
  return String(call?.id || "").trim();
}

export function assertSerializedModelMessageSnapshot(snapshot) {
  assertModelMessageSnapshot(snapshot);
  const blocks = snapshot.messageBlocks;
  expect(snapshot.messages).toEqual(composeMessagesFromBlocks(blocks));
  const hydrated = hydrateModelContextSnapshot(snapshot, {
    userId: snapshot.userId,
    sessionId: snapshot.sessionId,
    parentSessionId: snapshot.parentSessionId,
    dialogProcessId: snapshot.dialogProcessId,
    turnScopeId: snapshot.turnScopeId,
  });
  for (const name of ["system", "history", "incremental"]) {
    expect(hydrated.messageBlocks[name].map(serializeContextMessage)).toEqual(blocks[name]);
  }

  const messages = snapshot.messages;
  const declaredToolCallIds = new Set();
  const completedToolCallIds = new Set();
  for (const message of messages) {
    expect(["system", "human", "ai", "tool"]).toContain(message.type);
    expect(Object.hasOwn(message, "content")).toBe(true);
    expect(isPlainObject(message.additional_kwargs)).toBe(true);

    if (message.type === "ai") {
      expect(Array.isArray(message.tool_calls)).toBe(true);
      expect(Array.isArray(message.invalid_tool_calls)).toBe(true);
      for (const call of serializedToolCalls(message)) {
        const callId = toolCallId(call);
        expect(callId).toBeTruthy();
        expect(declaredToolCallIds.has(callId), `duplicate snapshot tool call ${callId}`).toBe(
          false,
        );
        declaredToolCallIds.add(callId);
      }
    }
    if (message.type !== "tool") continue;
    const callId = text(message.tool_call_id);
    expect(callId).toBeTruthy();
    expect(declaredToolCallIds.has(callId), `orphan snapshot tool result ${callId}`).toBe(true);
    expect(completedToolCallIds.has(callId), `duplicate snapshot tool result ${callId}`).toBe(
      false,
    );
    completedToolCallIds.add(callId);
  }
  expect(completedToolCallIds).toEqual(declaredToolCallIds);
  return { declaredToolCallIds, completedToolCallIds };
}

export function assertSnapshotRecoveryInModelInput({ snapshot, continuation, trace }) {
  const previousIdentity = {
    userId: snapshot.userId,
    sessionId: snapshot.sessionId,
    parentSessionId: snapshot.parentSessionId,
    dialogProcessId: snapshot.dialogProcessId,
    turnScopeId: snapshot.turnScopeId,
  };
  expect(text(trace.dialogProcessId)).toBeTruthy();
  expect(text(trace.turnScopeId)).toBe(continuation.identity.turnScopeId);
  const hydrated = hydrateModelContextSnapshot(snapshot, previousIdentity);
  const recoveredBlocks = {
    system: hydrated.messageBlocks.system,
    history: hydrated.messageBlocks.history,
    incremental: projectSnapshotIncrementalToContinuation(hydrated.messageBlocks.incremental, {
      dialogProcessId: text(trace.dialogProcessId),
      turnScopeId: text(trace.turnScopeId),
    }),
  };
  expect(recoveredBlocks.history).toEqual(hydrated.messageBlocks.history);
  const expected = fingerprintDiagnosticMessages(composeMessagesFromBlocks(recoveredBlocks));
  const actual = trace.data?.messages?.fingerprints || [];
  expect(actual.slice(0, expected.fingerprints.length)).toEqual(expected.fingerprints);
  expect(actual.length).toBeGreaterThan(expected.fingerprints.length);
  return { expected, actual };
}
