/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  buildUnifiedSessionDetail,
  projectTurnStatusOntoAssistant,
} from "../../../../../plugin/noobot-plugin-workflow/frontend/components/workflow-message-card/workflowUnifiedSessionDetail.js";

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

describe("workflow child Turn status projection", () => {
  it("projects a running execution onto an existing child assistant", () => {
    const [message] = projectTurnStatusOntoAssistant([childAssistant()], {
      ...childIdentity,
      state: "running",
    });

    expect(message).toMatchObject({
      statusTurnScopeId: childIdentity.turnScopeId,
      projectedStatusStepState: "completing",
    });
  });

  it("normalizes terminal execution state without persisted turnStatuses", () => {
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
          turnStatuses: [],
          messages: [childAssistant()],
        },
        messages: [childAssistant()],
      }),
    });

    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]).toMatchObject({
      statusTurnScopeId: childIdentity.turnScopeId,
      projectedStatusStepState: "completed",
    });
  });

  it("does not project status onto another Session or Turn", () => {
    const otherSession = childAssistant({ id: "other-session", sessionId: "other" });
    const otherTurn = childAssistant({ id: "other-turn", turnScopeId: "workflow-node:other" });
    const result = projectTurnStatusOntoAssistant([otherSession, otherTurn], {
      ...childIdentity,
      state: "completed",
    });

    expect(result).toEqual([otherSession, otherTurn]);
  });

  it("projects status onto the synthesized running assistant", () => {
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

    expect(detail.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(detail.messages[1]).toMatchObject({
      pending: true,
      workflowNodeRunningPlaceholder: true,
      statusTurnScopeId: childIdentity.turnScopeId,
      projectedStatusStepState: "completing",
    });
  });
});
