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
      planningDialog: { sessionId, dialogProcessId },
      execution: { workflowRunId, instanceId: workflowRunId, started: false },
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
    id: "persisted-workflow-a",
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
      id: "user-a",
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
      id: "assistant-presentation-a",
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
      id: "assistant-shell-a",
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
      id: "assistant-shell-a",
      ts: 123,
      pending: true,
      type: "workflow",
      __workflowLiveProjection: true,
    });
  });

  it("never lets a planning projection overwrite authoritative canonical content", () => {
    const canonical = {
      id: "assistant-shell-a",
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
      id: "assistant-shell-a",
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
      id: persisted.id,
      content: "final workflow content",
      presentationMessageId: "assistant-presentation-a",
    });
    expect(result[0].pluginMeta.payload.nodeResults).toBeUndefined();
  });

  it("coalesces a placeholder and persisted workflow into one stable Turn shell", () => {
    const placeholder = {
      id: "assistant-shell-a",
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
      id: "assistant-shell-a",
      ts: 123,
      type: "workflow",
      content: "WORKFLOW_DSL/1 persisted",
    });
    expect(result[0].__workflowLiveProjection).toBeUndefined();
  });

  it("coalesces an empty canonical assistant and terminal status into one presentation", () => {
    const canonicalAssistant = {
      id: "assistant-canonical-a",
      messageId: "assistant-canonical-a",
      sessionId: "session-a",
      role: "assistant",
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-a",
      content: "",
      toolTimeline: [{ key: "tool-a" }],
      activityTimeline: [{ eventId: "activity-a" }],
    };
    const terminalPresentation = {
      id: "turn-status-placeholder:turn-a",
      sessionId: "session-a",
      role: "assistant",
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-a",
      content: "本轮已由用户停止\n原因：user_stop",
      status: "user_stopped",
      turnStatusPlaceholder: true,
    };
    const result = selectTurnPresentations({
      activeSession: {
        sessionId: "session-a",
        messages: [terminalPresentation, canonicalAssistant],
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "assistant-canonical-a",
      messageId: "assistant-canonical-a",
      content: "本轮已由用户停止\n原因：user_stop",
      status: "user_stopped",
      turnStatusPlaceholder: true,
      toolTimeline: [{ key: "tool-a" }],
      activityTimeline: [{ eventId: "activity-a" }],
      __turnStatusPresentation: true,
      __turnStatusPlaceholderId: "turn-status-placeholder:turn-a",
    });
  });

  it("derives one terminal presentation from turnStatuses without mutating canonical messages", () => {
    const canonicalAssistant = {
      id: "assistant-status-a",
      messageId: "assistant-status-a",
      sessionId: "session-a",
      role: "assistant",
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-a",
      content: "",
      toolTimeline: [{ key: "tool-a" }],
    };
    const sourceMessages = [
      {
        id: "user-status-a",
        sessionId: "session-a",
        role: "user",
        turnScopeId: "turn-a",
        content: "stop",
      },
      canonicalAssistant,
    ];
    const result = selectTurnPresentations({
      activeSession: {
        sessionId: "session-a",
        messages: sourceMessages,
        turnStatuses: [
          {
            turnScopeId: "turn-a",
            dialogProcessId: "dialog-a",
            status: "user_stopped",
            reason: "user_stop",
            description: "用户停止了本轮生成",
          },
        ],
      },
    });

    expect(sourceMessages).toHaveLength(2);
    expect(sourceMessages[1]).toBe(canonicalAssistant);
    expect(canonicalAssistant).not.toHaveProperty("turnStatusPlaceholder");
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      id: "assistant-status-a",
      messageId: "assistant-status-a",
      content: "本轮已由用户停止\n用户停止了本轮生成\n原因：user_stop",
      turnStatusPlaceholder: true,
      toolTimeline: [{ key: "tool-a" }],
    });
  });

  it("derives terminal presentation from the authoritative runtime when detail status has not arrived", () => {
    const user = {
      id: "user-runtime-stop",
      sessionId: "session-runtime-stop",
      role: "user",
      turnScopeId: "turn-runtime-stop",
      content: "stop",
    };
    const assistant = {
      id: "assistant-runtime-stop",
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
      id: "assistant-runtime-stop",
      status: "user_stopped",
      turnStatusPlaceholder: true,
    });
  });

  it("anchors an orphaned terminal Turn before the next authoritative Turn", () => {
    const result = selectTurnPresentations({
      activeSession: {
        sessionId: "session-a",
        messages: [
          {
            id: "user-next",
            sessionId: "session-a",
            role: "user",
            turnScopeId: "turn-next",
            content: "next",
          },
          {
            id: "assistant-next",
            sessionId: "session-a",
            role: "assistant",
            turnScopeId: "turn-next",
            content: "answer",
          },
        ],
        turnStatuses: [
          {
            turnScopeId: "turn-failed",
            dialogProcessId: "dialog-failed",
            status: "error",
            reason: "run_error",
            description: "failed Turn",
          },
        ],
      },
      turnRuntimeRegistry: {
        sessions: {
          "session-a": {
            turns: {
              "turn-failed": { turnScopeId: "turn-failed", sequence: 24 },
              "turn-next": { turnScopeId: "turn-next", sequence: 29 },
            },
          },
        },
      },
    });

    expect(result.map((message) => message.turnScopeId)).toEqual([
      "turn-failed",
      "turn-next",
      "turn-next",
    ]);
    expect(result[0]).toMatchObject({
      turnStatusPlaceholder: true,
      status: "error",
    });
  });

  it("keeps partial assistant content and terminal reason in one presentation", () => {
    const canonicalAssistant = {
      id: "assistant-partial-a",
      sessionId: "session-a",
      role: "assistant",
      turnScopeId: "turn-a",
      content: "partial answer",
    };
    const terminalPresentation = {
      id: "turn-status-placeholder:turn-a",
      sessionId: "session-a",
      role: "assistant",
      turnScopeId: "turn-a",
      content: "本轮异常停止\n原因：model_failed",
      status: "error",
      turnStatusPlaceholder: true,
    };
    const result = selectTurnPresentations({
      activeSession: {
        sessionId: "session-a",
        messages: [canonicalAssistant, terminalPresentation],
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "assistant-partial-a",
      content: "partial answer\n\n本轮异常停止\n原因：model_failed",
      status: "error",
      __turnStatusPresentation: true,
    });
  });

  it("does not coalesce terminal status across Turn boundaries", () => {
    const result = selectTurnPresentations({
      activeSession: {
        sessionId: "session-a",
        messages: [
          { id: "assistant-a", role: "assistant", turnScopeId: "turn-a", content: "" },
          {
            id: "turn-status-placeholder:turn-b",
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
            id: "user-old",
            sessionId: "session-a",
            role: "user",
            turnScopeId: "turn-old",
            content: "old",
          },
          {
            id: "assistant-old",
            sessionId: "session-a",
            role: "assistant",
            turnScopeId: "turn-old",
            content: "old answer",
          },
          {
            id: "assistant-tail",
            sessionId: "session-a",
            role: "assistant",
            turnScopeId: "turn-tail",
            content: "tail answer",
          },
          {
            id: "user-new",
            sessionId: "session-a",
            role: "user",
            turnScopeId: "turn-new",
            content: "edited",
          },
        ],
        turnStatuses: [{ sessionId: "session-a", turnScopeId: "turn-old", status: "user_stopped" }],
      },
      workflowRegistry: liveRegistry(workflow({ turnScopeId: "turn-tail" })),
      turnRuntimeRegistry,
    });

    expect(result).toEqual([expect.objectContaining({ id: "user-new", turnScopeId: "turn-new" })]);
  });

  it("rejects multiple canonical assistant presentations for one Turn", () => {
    expect(() =>
      selectTurnPresentations({
        activeSession: {
          sessionId: "session-a",
          messages: [
            {
              id: "assistant-source-a",
              messageId: "assistant-source-a",
              presentationMessageId: "assistant-presentation-a",
              sessionId: "session-a",
              role: "assistant",
              chatPresentation: true,
              turnScopeId: "turn-a",
              content: "first",
            },
            {
              id: "assistant-source-b",
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
