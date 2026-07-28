/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { selectTurnPresentations } from "../../../../src/modules/chat/runtime/engine/turnPresentation.js";
import {
  confirmTurnRuntimeDeletion,
  createTurnRuntimeRegistryState,
} from "../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";

function workflow({
  workflowRunId = "workflow-a",
  sessionId = "session-a",
  turnScopeId = "turn-a",
  dialogProcessId = "dialog-a",
} = {}) {
  return {
    workflowRunId,
    sessionId,
    turnScopeId,
    dialogProcessId,
    semanticText: "WORKFLOW_DSL/1",
    nodes: { nodeA: { nodeExecutionId: "node-a", status: "ready" } },
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
    const user = { id: "user-a", sessionId: "session-a", role: "user", turnScopeId: "turn-a", content: "run" };
    const result = selectTurnPresentations({
      activeSession: { id: "session-a", messages: [user] },
      workflowRegistry: liveRegistry(),
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(user);
    expect(result[1]).toMatchObject({
      role: "assistant",
      type: "workflow",
      turnScopeId: "turn-a",
      __workflowLiveProjection: true,
    });
  });

  it("projects live workflow content onto the existing assistant shell", () => {
    const shell = {
      id: "assistant-shell-a",
      sessionId: "session-a",
      role: "assistant",
      type: "message",
      turnScopeId: "turn-a",
      pending: true,
      ts: 123,
      content: "",
    };
    const result = selectTurnPresentations({
      activeSession: { id: "session-a", messages: [shell] },
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

  it("lets the persisted workflow synchronously replace the live projection", () => {
    const persisted = persistedWorkflow();
    const result = selectTurnPresentations({
      activeSession: { id: "session-a", messages: [persisted] },
      workflowRegistry: liveRegistry(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(persisted);
    expect(result[0].__workflowLiveProjection).toBeUndefined();
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
      activeSession: { id: "session-a", messages: [placeholder, persistedWorkflow()] },
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

  it("never projects across Session or Turn ownership boundaries", () => {
    const result = selectTurnPresentations({
      activeSession: {
        id: "session-a",
        messages: [{ sessionId: "session-a", role: "assistant", turnScopeId: "turn-a", content: "" }],
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

  it("canonicalizes the optimistic and backend Session ids without weakening Turn ownership", () => {
    const result = selectTurnPresentations({
      activeSession: {
        id: "local-session-a",
        backendSessionId: "session-a",
        messages: [{
          sessionId: "local-session-a",
          role: "assistant",
          turnScopeId: "turn-a",
          content: "",
        }],
      },
      workflowRegistry: liveRegistry(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sessionId: "local-session-a",
      turnScopeId: "turn-a",
      __workflowLiveProjection: true,
    });
  });

  it("does not resurrect a deleted workflow Turn from the live registry", () => {
    const turnRuntimeRegistry = createTurnRuntimeRegistryState();
    confirmTurnRuntimeDeletion(turnRuntimeRegistry, "turn-a", { sessionId: "session-a" });

    expect(selectTurnPresentations({
      activeSession: { id: "session-a", messages: [] },
      workflowRegistry: liveRegistry(),
      turnRuntimeRegistry,
    })).toEqual([]);
  });

  it("does not suppress a workflow owned by another Session or Turn", () => {
    const turnRuntimeRegistry = createTurnRuntimeRegistryState();
    confirmTurnRuntimeDeletion(turnRuntimeRegistry, "turn-b", { sessionId: "session-a" });
    confirmTurnRuntimeDeletion(turnRuntimeRegistry, "turn-a", { sessionId: "session-b" });

    expect(selectTurnPresentations({
      activeSession: { id: "session-a", messages: [] },
      workflowRegistry: liveRegistry(),
      turnRuntimeRegistry,
    })).toHaveLength(1);
  });
});
