/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  mergeMessagePresentationFacets,
  resolveStatusStepPresentation,
} from "../../../../../src/modules/chat/model/messagePresentation.js";
import {
  buildViewMessage,
  foldConversationMessages,
} from "../../../../../src/modules/chat/model/messageModel.js";

describe("message presentation status steps", () => {
  it("uses an active Turn Runtime ahead of an older child execution projection", () => {
    expect(resolveStatusStepPresentation({
      turnRuntime: { terminal: null },
      runtimeDisplayState: "sending",
      projectedState: "completed",
    })).toEqual({
      displayState: "sending",
      source: "turn-runtime-active",
    });
  });

  it("uses a child execution projection when Runtime has no renderable state", () => {
    expect(resolveStatusStepPresentation({
      turnRuntime: { terminal: null },
      runtimeDisplayState: "send",
      projectedState: "completed",
    })).toEqual({
      displayState: "completed",
      source: "child-execution-projection",
    });
  });

  it("keeps persisted completed out of protocol-terminal presentation", () => {
    expect(resolveStatusStepPresentation({
      persistedState: "completed",
    })).toEqual({ displayState: "", source: "" });
  });

  it("lets an authoritative Runtime terminal win over projections", () => {
    expect(resolveStatusStepPresentation({
      turnRuntime: { terminal: "user_stopped" },
      runtimeDisplayState: "stopping",
      projectedState: "completed",
    })).toEqual({
      displayState: "stopped",
      source: "turn-runtime-terminal",
    });
  });

  it("does not regress a folded terminal projection to an active state", () => {
    expect(mergeMessagePresentationFacets(
      {
        statusTurnScopeId: "workflow-node:child",
        projectedStatusStepState: "completed",
      },
      {
        statusTurnScopeId: "workflow-node:child",
        projectedStatusStepState: "completing",
      },
    )).toEqual({
      statusTurnScopeId: "workflow-node:child",
      projectedStatusStepState: "completed",
    });
  });

  it("refuses to merge presentation state across status Turn identities", () => {
    expect(mergeMessagePresentationFacets(
      {
        statusTurnScopeId: "workflow-node:first",
        projectedStatusStepState: "sending",
      },
      {
        statusTurnScopeId: "workflow-node:second",
        projectedStatusStepState: "completed",
      },
    )).toEqual({
      statusTurnScopeId: "workflow-node:first",
      projectedStatusStepState: "sending",
    });
  });

  it("keeps one status-step presentation across refresh, continuation, and completion", () => {
    const identity = {
      role: "assistant",
      sessionId: "child-session",
      turnScopeId: "workflow-node:child",
      statusTurnScopeId: "workflow-node:child",
    };
    const refreshedRunningMessages = foldConversationMessages([{
      ...identity,
      content: "",
      pending: true,
      projectedStatusStepState: "completing",
    }], buildViewMessage);
    expect(refreshedRunningMessages).toHaveLength(1);
    expect(resolveStatusStepPresentation({
      projectedState: refreshedRunningMessages[0].projectedStatusStepState,
    }).displayState).toBe("completing");

    const continuedMessages = foldConversationMessages([
      { ...identity, content: "partial", projectedStatusStepState: "completing" },
      { ...identity, content: "done", projectedStatusStepState: "completed" },
    ], buildViewMessage);
    expect(continuedMessages).toHaveLength(1);
    expect(continuedMessages[0].content).toContain("partial");
    expect(continuedMessages[0].content).toContain("done");
    expect(resolveStatusStepPresentation({
      projectedState: continuedMessages[0].projectedStatusStepState,
    }).displayState).toBe("completed");

    const lateRunningFragment = foldConversationMessages([
      continuedMessages[0],
      { ...identity, content: "", projectedStatusStepState: "completing" },
    ], buildViewMessage);
    expect(lateRunningFragment).toHaveLength(1);
    expect(lateRunningFragment[0].projectedStatusStepState).toBe("completed");
  });
});
