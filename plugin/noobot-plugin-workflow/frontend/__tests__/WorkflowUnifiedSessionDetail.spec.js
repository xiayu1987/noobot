/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { resolveMessageViewKey } from "@noobot/event-protocol/message-event";
import {
  buildUnifiedSessionDetail,
  mergeUnifiedSessionDetail,
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
  it("keeps node execution status out of canonical child messages", () => {
    const detail = buildUnifiedSessionDetail({
      nodeItem: { nodeExecutionId: "node-a" },
      runtimeNodeSessions: runtimeNodeSessions("succeeded"),
      selectExecutionDetail: () => ({
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
      viewKey: `workflow-node-running:${childIdentity.turnScopeId}`,
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
      rawEvents: [{ type: "tool_call_start" }],
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
