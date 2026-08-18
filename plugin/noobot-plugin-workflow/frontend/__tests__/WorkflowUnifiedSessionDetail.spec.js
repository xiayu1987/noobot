/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  buildUnifiedSessionDetail,
  mergeUnifiedSessionDetail,
} from "../runtime/workflowUnifiedSessionDetail.js";

const childIdentity = {
  sessionId: "child-session",
  turnScopeId: "workflow-node:node-a",
  dialogProcessId: "child-dialog",
};

function childAssistant(overrides = {}) {
  return {
    id: "assistant-a",
    role: "assistant",
    content: "done",
    ...childIdentity,
    ...overrides,
  };
}

describe("workflow child unified session detail", () => {
  it("keeps node execution status out of canonical child messages", () => {
    const detail = buildUnifiedSessionDetail({
      nodeItem: {
        ...childIdentity,
        childExecutionId: "execution-a",
        status: "succeeded",
      },
      selectExecutionDetail: () => ({
        execution: {
          executionId: "execution-a",
          ...childIdentity,
          state: "succeeded",
        },
        session: {
          sessionId: childIdentity.sessionId,
          messages: [childAssistant()],
        },
        messages: [childAssistant()],
      }),
    });

    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]).toEqual(childAssistant());
    expect(detail.messages[0]).not.toHaveProperty("projectedStatusStepState");
    expect(detail.messages[0]).not.toHaveProperty("statusTurnScopeId");
  });

  it("keeps the running placeholder outside canonical messages", () => {
    const user = { id: "user-a", role: "user", content: "run", ...childIdentity };
    const detail = buildUnifiedSessionDetail({
      nodeItem: {
        ...childIdentity,
        childExecutionId: "execution-a",
        status: "running",
      },
      selectExecutionDetail: () => ({
        execution: {
          executionId: "execution-a",
          ...childIdentity,
          state: "running",
        },
        session: { sessionId: childIdentity.sessionId, messages: [user] },
        messages: [user],
      }),
    });

    expect(detail.messages).toEqual([user]);
    expect(detail.rawMessages).toEqual([user]);
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
    const user = { id: "user-a", role: "user", content: "run", ...childIdentity };
    const finalAssistant = {
      id: "assistant-final",
      role: "assistant",
      content: "done once",
      ...childIdentity,
    };

    const detail = mergeUnifiedSessionDetail(
      { state: "running", messages: [user], runningPlaceholderViewModel: { viewKey: "view-only" } },
      { state: "succeeded", messages: [finalAssistant] },
    );

    expect(detail.messages).toEqual([user, finalAssistant]);
    expect(detail.messages.every((message) => Boolean(message.id))).toBe(true);
  });

  it("keeps assistants with different stable message identities separate", () => {
    const liveAssistant = {
      id: "assistant-live-tool-stream",
      role: "assistant",
      content: "done once",
      ...childIdentity,
      rawEvents: [{ type: "tool_call_start" }],
    };
    const finalAssistant = {
      id: "assistant-terminal",
      role: "assistant",
      content: "done once",
      ...childIdentity,
    };

    const detail = mergeUnifiedSessionDetail(
      { state: "running", messages: [liveAssistant], rawMessages: [liveAssistant] },
      { state: "succeeded", messages: [finalAssistant], rawMessages: [finalAssistant] },
    );

    expect(detail.messages).toEqual([liveAssistant, finalAssistant]);
    expect(detail.rawMessages).toEqual([liveAssistant, finalAssistant]);
  });
});
