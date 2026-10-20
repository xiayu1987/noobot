/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { selectTurnPresentations } from "../../../../../../src/modules/chat/runtime/engine/turnPresentation.js";
import {
  confirmTurnRuntimeDeletion,
  createTurnRuntimeRegistryState,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";

function workflow({
  workflowRunId = "workflow-a",
  sessionId = "session-a",
  turnScopeId = "turn-a",
  presentationMessageId = "assistant-presentation-a",
  dialogProcessId = "dialog-a",
} = {}) {
  return {
    workflowRunId,
    sessionId,
    turnScopeId,
    presentationMessageId,
    dialogProcessId,
    semanticText: "WORKFLOW_DSL/1",
    workflowPayload: {
      workflowRunId,
      semantic: {
        nodes: [{ id: "semantic-node-a", name: "Node A", type: "action" }],
        flowtos: [{ from: "start", to: "semantic-node-a" }],
      },
      interaction: { semanticTextPreview: "WORKFLOW_DSL/1" },
      nodeSessions: [{ nodeExecutionId: "node-a", sessionId: "node-session-a", status: "ready" }],
      runMeta: { sessionId, dialogProcessId },
      execution: { started: false },
    },
    nodes: {
      nodeA: {
        nodeExecutionId: "node-a",
        sessionId: "node-session-a",
        status: "ready",
      },
    },
  };
}

function liveRegistry(item = workflow()) {
  return { workflows: { [item.workflowRunId]: item } };
}

function persistedWorkflow(overrides = {}) {
  return {
    messageId: "persisted-workflow-a",
    sessionId: "session-a",
    role: "assistant",
    type: "workflow",
    turnScopeId: "turn-a",
    presentationMessageId: "assistant-presentation-a",
    content: "WORKFLOW_DSL/1 persisted",
    pluginMeta: {
      source: "workflow-plugin",
      kind: "workflow",
      phase: "running",
      payload: { workflowRunId: "workflow-a" },
    },
    ...overrides,
  };
}

describe("selectTurnPresentations", () => {
  it("materializes one normal assistant shell when only the user and live workflow exist", () => {
    const user = {
      messageId: "user-a",
      sessionId: "session-a",
      role: "user",
      turnScopeId: "turn-a",
      content: "run",
    };
    const result = selectTurnPresentations({
      activeSession: { sessionId: "session-a", messages: [user] },
      workflowRegistry: liveRegistry(),
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(user);
    expect(result[1]).toMatchObject({
      messageId: "assistant-presentation-a",
      presentationMessageId: "assistant-presentation-a",
      role: "assistant",
      type: "workflow",
      turnScopeId: "turn-a",
      __workflowLiveProjection: true,
      pluginMeta: {
        payload: {
          semantic: {
            nodes: [{ id: "semantic-node-a", name: "Node A", type: "action" }],
            flowtos: [{ from: "start", to: "semantic-node-a" }],
          },
        },
      },
    });
  });

  it("projects live workflow content onto the existing assistant shell", () => {
    const shell = {
      messageId: "assistant-shell-a",
      presentationMessageId: "assistant-presentation-a",
      sessionId: "session-a",
      role: "assistant",
      type: "message",
      turnScopeId: "turn-a",
      pending: true,
      ts: 123,
      content: "",
    };
    const result = selectTurnPresentations({
      activeSession: { sessionId: "session-a", messages: [shell] },
      workflowRegistry: liveRegistry(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      messageId: "assistant-shell-a",
      ts: 123,
      pending: true,
      type: "workflow",
      __workflowLiveProjection: true,
    });
  });

  it("never lets a planning projection overwrite authoritative canonical content", () => {
    const canonical = {
      messageId: "assistant-presentation-a",
      presentationMessageId: "assistant-presentation-a",
      sessionId: "session-a",
      role: "assistant",
      type: "message",
      turnScopeId: "turn-a",
      content: "WORKFLOW_DSL/1\n\n插件拼接的附件结果",
      attachments: [{ name: "workflow-result.txt" }],
    };
    const result = selectTurnPresentations({
      activeSession: { sessionId: "session-a", messages: [canonical] },
      workflowRegistry: liveRegistry(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      messageId: "assistant-presentation-a",
      type: "workflow",
      content: "WORKFLOW_DSL/1\n\n插件拼接的附件结果",
      attachments: [{ name: "workflow-result.txt" }],
      pluginMeta: { phase: "planning" },
    });
  });

  it("keeps the persisted workflow shell as the sole completed-content source", () => {
    const persisted = persistedWorkflow({ content: "final workflow content" });
    const result = selectTurnPresentations({
      activeSession: { sessionId: "session-a", messages: [persisted] },
      workflowRegistry: liveRegistry(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      messageId: persisted.messageId,
      content: "final workflow content",
      presentationMessageId: "assistant-presentation-a",
    });
    expect(result[0].pluginMeta.payload.nodeResults).toBeUndefined();
  });

  it("coalesces a placeholder and persisted workflow into one stable Turn shell", () => {
    const placeholder = {
      messageId: "assistant-shell-a",
      sessionId: "session-a",
      role: "assistant",
      type: "message",
      turnScopeId: "turn-a",
      ts: 123,
      content: "",
    };
    const result = selectTurnPresentations({
      activeSession: { sessionId: "session-a", messages: [placeholder, persistedWorkflow()] },
      workflowRegistry: liveRegistry(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      messageId: "assistant-shell-a",
      ts: 123,
      type: "workflow",
      content: "WORKFLOW_DSL/1 persisted",
    });
    expect(result[0].__workflowLiveProjection).toBeUndefined();
  });

  it("coalesces an empty canonical assistant and terminal status into one presentation", () => {
    const canonicalAssistant = {
      messageId: "assistant-canonical-a",
      sessionId: "session-a",
      role: "assistant",
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-a",
      content: "",
      toolTimeline: [{ key: "tool-a" }],
      activityTimeline: [{ eventId: "activity-a" }],
    };
    const result = selectTurnPresentations({
      activeSession: { sessionId: "session-a", messages: [canonicalAssistant] },
      turnRuntimeRegistry: {
        sessions: {
          "session-a": {
            turns: {
              "turn-a": {
                turnScopeId: "turn-a",
                dialogProcessId: "dialog-a",
                terminal: "user_stopped",
                finishedAt: "2026-07-31T10:00:00.000Z",
              },
            },
          },
        },
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      messageId: "assistant-canonical-a",
      turnStatus: expect.objectContaining({ status: "user_stopped" }),
      turnStatusPlaceholder: true,
      toolTimeline: [{ key: "tool-a" }],
      activityTimeline: [{ eventId: "activity-a" }],
    });
  });

  it("derives terminal presentation from the authoritative runtime when detail status has not arrived", () => {
    const user = {
      messageId: "user-runtime-stop",
      sessionId: "session-runtime-stop",
      role: "user",
      turnScopeId: "turn-runtime-stop",
      content: "stop",
    };
    const assistant = {
      messageId: "assistant-runtime-stop",
      sessionId: "session-runtime-stop",
      role: "assistant",
      turnScopeId: "turn-runtime-stop",
      content: "",
    };
    const result = selectTurnPresentations({
      activeSession: { sessionId: "session-runtime-stop", messages: [user, assistant] },
      turnRuntimeRegistry: {
        sessions: {
          "session-runtime-stop": {
            turns: {
              "turn-runtime-stop": {
                turnScopeId: "turn-runtime-stop",
                terminal: "user_stopped",
                finishedAt: "2026-07-31T10:00:00.000Z",
              },
            },
          },
        },
      },
    });

    expect(result[1]).toMatchObject({
      messageId: "assistant-runtime-stop",
      turnStatus: expect.objectContaining({ status: "user_stopped" }),
      turnStatusPlaceholder: true,
    });
  });

  it.each([
    { terminal: "error", failure: { message: "provider down" }, detail: true },
    { terminal: "error", failure: null, detail: false },
    { terminal: "user_stopped", failure: { message: "provider down" }, detail: false },
  ])("shows failure detail only for $terminal with message ($detail)", (testCase) => {
    const sessionId = "session-failure-detail";
    const turnScopeId = "turn-failure-detail";
    const result = selectTurnPresentations({
      activeSession: {
        sessionId,
        messages: [
          { messageId: "user-failure-detail", sessionId, role: "user", turnScopeId, content: "go" },
        ],
      },
      turnRuntimeRegistry: {
        sessions: {
          [sessionId]: {
            turns: {
              [turnScopeId]: {
                turnScopeId,
                terminal: testCase.terminal,
                failure: testCase.failure,
                finishedAt: "2026-07-31T10:00:00.000Z",
              },
            },
          },
        },
      },
    });
    const presentation = result.find((message) => message.turnStatusPlaceholder === true);
    expect(presentation).toMatchObject({
      turnStatus: expect.objectContaining({ status: testCase.terminal }),
    });
    expect(presentation.content.split("\n")).toHaveLength(testCase.detail ? 2 : 1);
    expect(presentation.content.includes("provider down")).toBe(testCase.detail);
  });

  it("keeps partial assistant content and terminal reason in one presentation", () => {
    const canonicalAssistant = {
      messageId: "assistant-partial-a",
      sessionId: "session-a",
      role: "assistant",
      turnScopeId: "turn-a",
      content: "partial answer",
    };
    const result = selectTurnPresentations({
      activeSession: { sessionId: "session-a", messages: [canonicalAssistant] },
      turnRuntimeRegistry: {
        sessions: {
          "session-a": {
            turns: {
              "turn-a": {
                turnScopeId: "turn-a",
                dialogProcessId: "dialog-a",
                terminal: "error",
                failure: { message: "model_failed" },
                finishedAt: "2026-07-31T10:00:00.000Z",
              },
            },
          },
        },
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      messageId: "assistant-partial-a",
      content: expect.stringMatching(/^partial answer\n\n.+model_failed/s),
      turnStatus: expect.objectContaining({ status: "error" }),
    });
  });

  it("does not coalesce terminal status across Turn boundaries", () => {
    const result = selectTurnPresentations({
      activeSession: {
        sessionId: "session-a",
        messages: [
          { messageId: "assistant-a", role: "assistant", turnScopeId: "turn-a", content: "" },
          {
            messageId: "turn-status-placeholder:turn-b",
            role: "assistant",
            turnScopeId: "turn-b",
            content: "本轮已由用户停止",
            turnStatusPlaceholder: true,
          },
        ],
      },
    });

    expect(result).toHaveLength(2);
  });

  it("does not render ordinary or workflow assistant projections for replaced Turns", () => {
    const turnRuntimeRegistry = createTurnRuntimeRegistryState();
    confirmTurnRuntimeDeletion(turnRuntimeRegistry, ["turn-old", "turn-tail"], {
      sessionId: "session-a",
    });
    const result = selectTurnPresentations({
      activeSession: {
        sessionId: "session-a",
        messages: [
          {
            messageId: "user-old",
            sessionId: "session-a",
            role: "user",
            turnScopeId: "turn-old",
            content: "old",
          },
          {
            messageId: "assistant-old",
            sessionId: "session-a",
            role: "assistant",
            turnScopeId: "turn-old",
            content: "old answer",
          },
          {
            messageId: "assistant-tail",
            sessionId: "session-a",
            role: "assistant",
            turnScopeId: "turn-tail",
            content: "tail answer",
          },
          {
            messageId: "user-new",
            sessionId: "session-a",
            role: "user",
            turnScopeId: "turn-new",
            content: "edited",
          },
        ],
      },
      workflowRegistry: liveRegistry(workflow({ turnScopeId: "turn-tail" })),
      turnRuntimeRegistry,
    });

    expect(result).toEqual([
      expect.objectContaining({ messageId: "user-new", turnScopeId: "turn-new" }),
    ]);
  });

  it("rejects multiple canonical assistant presentations for one Turn", () => {
    expect(() =>
      selectTurnPresentations({
        activeSession: {
          sessionId: "session-a",
          messages: [
            {
              messageId: "assistant-source-a",
              presentationMessageId: "assistant-presentation-a",
              sessionId: "session-a",
              role: "assistant",
              chatPresentation: true,
              turnScopeId: "turn-a",
              content: "first",
            },
            {
              messageId: "assistant-source-b",
              presentationMessageId: "assistant-presentation-a",
              sessionId: "session-a",
              role: "assistant",
              chatPresentation: true,
              turnScopeId: "turn-a",
              content: "second",
            },
          ],
        },
      }),
    ).toThrow(
      "[turn-presentation] multiple canonical assistant presentations for session-a::turn-a",
    );
  });

  it("never projects across Session or Turn ownership boundaries", () => {
    const result = selectTurnPresentations({
      activeSession: {
        sessionId: "session-a",
        messages: [
          { sessionId: "session-a", role: "assistant", turnScopeId: "turn-a", content: "" },
        ],
      },
      workflowRegistry: {
        workflows: {
          otherSession: workflow({ workflowRunId: "other-session", sessionId: "session-b" }),
          otherTurn: workflow({ workflowRunId: "other-turn", turnScopeId: "turn-b" }),
        },
      },
    });

    expect(result).toHaveLength(2);
    expect(result[0].type).toBeUndefined();
    expect(result[0].__workflowLiveProjection).toBeUndefined();
    expect(result[1]).toMatchObject({
      sessionId: "session-a",
      turnScopeId: "turn-b",
      __workflowLiveProjection: true,
    });
  });

  it("keeps workflow projection within the declared Session and Turn ownership", () => {
    const result = selectTurnPresentations({
      activeSession: {
        sessionId: "session-a",
        messages: [
          {
            sessionId: "session-a",
            role: "assistant",
            turnScopeId: "turn-a",
            content: "",
          },
        ],
      },
      workflowRegistry: liveRegistry(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sessionId: "session-a",
      turnScopeId: "turn-a",
      __workflowLiveProjection: true,
    });
  });

  it("does not resurrect a deleted workflow Turn from the live registry", () => {
    const turnRuntimeRegistry = createTurnRuntimeRegistryState();
    confirmTurnRuntimeDeletion(turnRuntimeRegistry, "turn-a", { sessionId: "session-a" });

    expect(
      selectTurnPresentations({
        activeSession: { sessionId: "session-a", messages: [] },
        workflowRegistry: liveRegistry(),
        turnRuntimeRegistry,
      }),
    ).toEqual([]);
  });

  it("does not suppress a workflow owned by another Session or Turn", () => {
    const turnRuntimeRegistry = createTurnRuntimeRegistryState();
    confirmTurnRuntimeDeletion(turnRuntimeRegistry, "turn-b", { sessionId: "session-a" });
    confirmTurnRuntimeDeletion(turnRuntimeRegistry, "turn-a", { sessionId: "session-b" });

    expect(
      selectTurnPresentations({
        activeSession: { sessionId: "session-a", messages: [] },
        workflowRegistry: liveRegistry(),
        turnRuntimeRegistry,
      }),
    ).toHaveLength(1);
  });
});
