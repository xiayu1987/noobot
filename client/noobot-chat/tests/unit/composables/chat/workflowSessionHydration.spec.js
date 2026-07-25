/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  hydrateWorkflowRegistryFromSessionDetail,
  isWorkflowThinkingPlaceholder,
  workflowPlanningEventFromMessage,
} from "../../../../src/composables/chat/workflowSessionHydration";

function workflowMessage() {
  return {
    role: "assistant",
    type: "workflow",
    content: "WORKFLOW_DSL/1\nNODE id=a type=action name=\"A\"",
    turnScopeId: "turn-a",
    dialogProcessId: "dialog-a",
    pluginMeta: { payload: {
      workflowRunId: "workflow-a",
      planningDialog: { sessionId: "session-a", dialogProcessId: "dialog-a" },
      nodeSessions: [{ nodeExecutionId: "node-a", status: "running" }],
    } },
  };
}

describe("workflow session hydration", () => {
  it("rebuilds planning state after a refresh cleared the live registry", () => {
    const upsert = vi.fn();
    expect(hydrateWorkflowRegistryFromSessionDetail({
      detail: { sessionId: "session-a" },
      mainSessionDoc: { messages: [workflowMessage()] },
      upsertWorkflowPlanningEvent: upsert,
    })).toBe(1);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      workflowRunId: "workflow-a",
      turnScopeId: "turn-a",
      nodeSessions: [expect.objectContaining({ nodeExecutionId: "node-a" })],
    }));
  });

  it("supports persisted execution node runs when refresh happens during execution", () => {
    const message = workflowMessage();
    message.pluginMeta.payload.nodeSessions = undefined;
    message.pluginMeta.payload.execution = {
      instanceId: "workflow-a",
      nodeAgentRuns: [{ nodeExecutionId: "node-a", status: "running" }],
    };
    expect(workflowPlanningEventFromMessage(message, "session-a")?.nodeSessions).toHaveLength(1);
  });

  it("hides only the empty assistant placeholder owned by the restored workflow", () => {
    const registry = { workflows: {
      "workflow-a": { workflowRunId: "workflow-a", turnScopeId: "turn-a", dialogProcessId: "dialog-a" },
    } };
    const placeholder = { role: "assistant", type: "message", content: "", turnScopeId: "turn-a" };
    const persistedMessages = [workflowMessage()];
    expect(isWorkflowThinkingPlaceholder(placeholder, registry, persistedMessages)).toBe(true);
    expect(isWorkflowThinkingPlaceholder({ ...placeholder, content: "real answer" }, registry, persistedMessages)).toBe(false);
    expect(isWorkflowThinkingPlaceholder({ ...placeholder, turnScopeId: "other-turn" }, registry, persistedMessages)).toBe(false);
  });

  it("keeps the live thinking surface until a persisted workflow entity replaces it", () => {
    const registry = { workflows: {
      "workflow-a": { workflowRunId: "workflow-a", turnScopeId: "turn-a", dialogProcessId: "dialog-a" },
    } };
    const placeholder = { role: "assistant", type: "message", content: "", turnScopeId: "turn-a" };
    expect(isWorkflowThinkingPlaceholder(placeholder, registry, [])).toBe(false);
  });
});
