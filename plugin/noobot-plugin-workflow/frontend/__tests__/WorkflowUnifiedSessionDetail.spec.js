/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { resolveMessageViewKey } from "@noobot/event-protocol/message-event";
import {
  buildUnifiedSessionDetail,
  createRunningAssistantPlaceholderViewModel,
  mergeUnifiedSessionDetail,
  projectSessionMetadata,
} from "../runtime/workflowUnifiedSessionDetail.js";

const childIdentity = {
  sessionId: "child-session",
  turnScopeId: "workflow-node:node-a",
  dialogProcessId: "child-dialog",
};

function runtimeNodeSessions(status) {
  return {
    value: [
      {
        nodeExecutionId: "node-a",
        nodeSessionId: childIdentity.sessionId,
        turnScopeId: childIdentity.turnScopeId,
        dialogProcessId: childIdentity.dialogProcessId,
        activeChildExecutionId: "execution-a",
        attemptExecutionIds: [],
        status,
      },
    ],
  };
}

function childAssistant(overrides = {}) {
  return {
    presentationMessageId: "assistant-a",
    role: "assistant",
    content: "done",
    ...childIdentity,
    ...overrides,
  };
}

describe("workflow child unified session detail", () => {
  it.each([undefined, null, {}, ["execution-a", "execution-a"], [" execution-a"]])(
    "rejects invalid attempt references %j before selecting any session or execution",
    (attemptExecutionIds) => {
      const nodes = runtimeNodeSessions("running");
      nodes.value[0].attemptExecutionIds = attemptExecutionIds;
      const unexpectedSelection = () => {
        throw new Error("unexpected selector call");
      };
      expect(() =>
        buildUnifiedSessionDetail({
          nodeItem: { nodeExecutionId: "node-a" },
          runtimeNodeSessions: nodes,
          selectExecutionDetail: unexpectedSelection,
          selectSessionMessages: unexpectedSelection,
        }),
      ).toThrow(/invalid_attempt_execution_ids/);
    },
  );

  it("preserves partial updates and rejects damaged content before plugin merging", () => {
    const base = Object.freeze({
      sessionId: childIdentity.sessionId,
      messages: Object.freeze([Object.freeze(childAssistant())]),
    });
    const update = Object.freeze({ sessionId: childIdentity.sessionId, title: "updated" });
    expect(mergeUnifiedSessionDetail(base, update)).toMatchObject({
      title: "updated",
      messages: base.messages,
    });
    expect(update).not.toHaveProperty("messages");
    for (const damaged of [null, [], { messages: null }, { messages: [null] }]) {
      expect(() => mergeUnifiedSessionDetail(base, damaged)).toThrow(/content projection/);
      expect(() => mergeUnifiedSessionDetail(damaged, update)).toThrow(/content projection/);
    }
  });

  it("requires loaded session metadata and does not mutate its source", () => {
    const document = Object.freeze({
      sessionId: childIdentity.sessionId,
      messages: Object.freeze([]),
      title: "child",
      turnTimings: Object.freeze([]),
    });
    expect(projectSessionMetadata(document)).toEqual({ title: "child" });
    expect(document.messages).toEqual([]);
    expect(() => projectSessionMetadata({ sessionId: childIdentity.sessionId })).toThrow(
      /messages must be an array/,
    );
  });

  it("keeps an unloaded session distinct from a loaded empty session", () => {
    const options = {
      nodeItem: { nodeExecutionId: "node-a" },
      runtimeNodeSessions: runtimeNodeSessions("running"),
      selectExecutionDetail: () => null,
    };
    expect(buildUnifiedSessionDetail({ ...options, selectSessionMessages: () => null })).toBeNull();
    const document = { sessionId: childIdentity.sessionId, messages: [] };
    expect(
      buildUnifiedSessionDetail({ ...options, selectSessionMessages: () => document }),
    ).toMatchObject({ sessionId: childIdentity.sessionId, messages: [] });
  });

  it.each([undefined, {}, { sessionId: childIdentity.sessionId, messages: null }])(
    "rejects a malformed session selector result: %j",
    (document) => {
      expect(() =>
        buildUnifiedSessionDetail({
          nodeItem: { nodeExecutionId: "node-a" },
          runtimeNodeSessions: runtimeNodeSessions("running"),
          selectExecutionDetail: () => null,
          selectSessionMessages: () => document,
        }),
      ).toThrow(TypeError);
    },
  );

  it("does not recover execution identity from runtime node state", () => {
    const selectSessionMessages = () => {
      throw new Error("must not fall back");
    };
    expect(() =>
      buildUnifiedSessionDetail({
        nodeItem: { nodeExecutionId: "node-a" },
        runtimeNodeSessions: runtimeNodeSessions("running"),
        selectExecutionDetail: () => ({
          execution: {},
          session: {},
          children: [],
          descendants: [],
        }),
        selectSessionMessages,
      }),
    ).toThrow(/identity is invalid/);
  });

  it("rejects a message that conflicts with the projection session owner", () => {
    const user = {
      messageUid: "user-conflicting-identity",
      role: "user",
      ...childIdentity,
      sessionId: "other-session",
      dialogProcessId: "other-dialog",
      metadata: { sessionId: "legacy-session", dialogProcessId: "legacy-dialog" },
    };
    expect(() =>
      createRunningAssistantPlaceholderViewModel([user], { ...childIdentity, running: true }),
    ).toThrow(/belongs to another session/);
  });

  it.each([
    { dialogProcessId: childIdentity.dialogProcessId },
    { metadata: childIdentity },
    { pluginMeta: childIdentity },
    { turnScopeId: ` ${childIdentity.turnScopeId} ` },
  ])("does not recover a missing or invalid turn scope from another field: %j", (identity) => {
    const user = { messageUid: "user-old-identity", role: "user", ...identity };
    expect(
      createRunningAssistantPlaceholderViewModel([user], { ...childIdentity, running: true }),
    ).toBeNull();
  });

  it("ignores assistants from another turn even when dialog identity matches", () => {
    const user = { messageUid: "user-current", role: "user", ...childIdentity };
    const assistant = childAssistant({ turnScopeId: undefined, metadata: childIdentity });
    expect(
      createRunningAssistantPlaceholderViewModel([user, assistant], {
        ...childIdentity,
        running: true,
      }),
    ).toMatchObject(childIdentity);
  });

  it("does not fill a missing child dialog from metadata or the graph route", () => {
    const user = {
      messageUid: "user-without-dialog",
      role: "user",
      sessionId: childIdentity.sessionId,
      turnScopeId: childIdentity.turnScopeId,
      metadata: childIdentity,
    };
    const placeholder = createRunningAssistantPlaceholderViewModel([user], {
      ...childIdentity,
      running: true,
    });
    expect(placeholder.sessionId).toBe(childIdentity.sessionId);
    expect(placeholder.dialogProcessId).toBeUndefined();
  });

  it("uses the projection owner for snapshot messages without a sessionId field", () => {
    const { sessionId: _sessionId, ...snapshotIdentity } = childIdentity;
    const user = {
      messageUid: "snapshot-user",
      role: "user",
      ...snapshotIdentity,
      metadata: { sessionId: "legacy-session" },
    };
    expect(
      createRunningAssistantPlaceholderViewModel([user], { ...childIdentity, running: true }),
    ).toMatchObject(childIdentity);
    expect(user).not.toHaveProperty("sessionId");
  });

  it("selects isolated session messages only by their canonical turn scope", () => {
    const current = childAssistant({ metadata: { turnScopeId: "other-turn" } });
    const messages = [
      current,
      childAssistant({ turnScopeId: undefined, metadata: childIdentity }),
      childAssistant({ turnScopeId: undefined, pluginMeta: childIdentity }),
      childAssistant({ turnScopeId: ` ${childIdentity.turnScopeId} ` }),
      childAssistant({ turnScopeId: "other-turn", metadata: childIdentity }),
    ];
    const detail = buildUnifiedSessionDetail({
      nodeItem: { nodeExecutionId: "node-a" },
      runtimeNodeSessions: runtimeNodeSessions("succeeded"),
      selectExecutionDetail: () => null,
      selectSessionMessages: () => ({ sessionId: childIdentity.sessionId, messages }),
    });
    expect(detail.messages).toEqual([current]);
    expect(detail.messages[0]).toBe(current);
    expect(messages).toHaveLength(5);
  });

  it("keeps node execution status out of canonical child messages", () => {
    const detail = buildUnifiedSessionDetail({
      nodeItem: { nodeExecutionId: "node-a" },
      runtimeNodeSessions: runtimeNodeSessions("succeeded"),
      selectExecutionDetail: () => ({
        children: [],
        descendants: [],
        execution: {
          executionId: "execution-a",
          ...childIdentity,
          state: "completed",
        },
        session: {
          sessionId: childIdentity.sessionId,
          messages: [childAssistant()],
        },
      }),
    });

    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]).toEqual(childAssistant());
    expect(detail.messages[0]).not.toHaveProperty("projectedStatusStepState");
    expect(detail.messages[0]).not.toHaveProperty("statusTurnScopeId");
  });

  it("keeps the running placeholder outside canonical messages", () => {
    const user = { messageUid: "user-a", role: "user", content: "run", ...childIdentity };
    const detail = buildUnifiedSessionDetail({
      nodeItem: { nodeExecutionId: "node-a" },
      runtimeNodeSessions: runtimeNodeSessions("running"),
      selectExecutionDetail: () => ({
        children: [],
        descendants: [],
        execution: {
          executionId: "execution-a",
          ...childIdentity,
          state: "processing",
        },
        session: { sessionId: childIdentity.sessionId, messages: [user] },
      }),
    });

    expect(detail.messages).toEqual([user]);
    expect(detail.runningPlaceholderViewModel).toMatchObject({
      viewKey: `workflow-node-running:${childIdentity.sessionId}:${childIdentity.turnScopeId}`,
      sessionId: childIdentity.sessionId,
      turnScopeId: childIdentity.turnScopeId,
      dialogProcessId: childIdentity.dialogProcessId,
    });
    expect(detail.runningPlaceholderViewModel).not.toHaveProperty("role");
    expect(detail.runningPlaceholderViewModel).not.toHaveProperty("content");
  });

  it("merges a terminal canonical assistant without retaining a view placeholder as a message", () => {
    const user = { messageUid: "user-a", role: "user", content: "run", ...childIdentity };
    const finalAssistant = {
      presentationMessageId: "assistant-final",
      role: "assistant",
      content: "done once",
      ...childIdentity,
    };

    const detail = mergeUnifiedSessionDetail(
      { messages: [user], runningPlaceholderViewModel: { viewKey: "view-only" } },
      { messages: [finalAssistant] },
    );

    expect(detail.messages).toEqual([user, finalAssistant]);
    expect(detail.messages.every((message) => Boolean(resolveMessageViewKey(message)))).toBe(true);
  });

  it("keeps assistants with different stable message identities separate", () => {
    const liveAssistant = {
      presentationMessageId: "assistant-live-tool-stream",
      role: "assistant",
      content: "done once",
      ...childIdentity,
      toolTimeline: [{ key: "call:call-1", toolCallId: "call-1", status: "running" }],
    };
    const finalAssistant = {
      presentationMessageId: "assistant-terminal",
      role: "assistant",
      content: "done once",
      ...childIdentity,
    };

    const detail = mergeUnifiedSessionDetail(
      { messages: [liveAssistant] },
      { messages: [finalAssistant] },
    );

    expect(detail.messages).toEqual([liveAssistant, finalAssistant]);
  });
});
