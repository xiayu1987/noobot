/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { normalizeWorkflowRuntimeEvent } from "@noobot/shared/workflow-runtime-event-protocol";
import { useChatStore } from "../../../../src/modules/chat/stores/useChatStore.js";
import { hydrateWorkflowRegistryFromSessionDetail } from "../../../../../../plugin/noobot-plugin-workflow/frontend/runtime/sessionHydration.js";

function runtimeEvents() {
  const identity = {
    workflowRunId: "run-1",
    nodeExecutionId: "node-1",
    commandId: "command-1",
    sessionId: "child-1",
    parentSessionId: "root-1",
    dialogProcessId: "node-dialog-1",
    turnScopeId: "workflow-node:node-1",
  };
  return [
    {
      event: "workflow_planning_message_prepared",
      transportSequence: 700,
      data: {
        sessionId: "root-1",
        dialogProcessId: "root-dialog-1",
        turnScopeId: "root-turn-1",
        workflowRunId: "run-1",
        semanticText: "WORKFLOW_DSL/1",
        createdAt: "2026-07-26T00:00:00.000Z",
        nodeSessions: [{ ...identity, sessionId: "", status: "ready", revision: 1, sequence: 1 }],
      },
    },
    {
      event: "workflow_node_state_committed",
      transportSequence: 3,
      data: {
        ...identity,
        status: "running",
        revision: 2,
        sequence: 2,
        eventId: "node-running",
        updatedAt: "2026-07-26T00:00:01.000Z",
      },
    },
    {
      event: "workflow_message_event",
      transportSequence: 9999,
      data: {
        envelopeKind: "noobot.message_event",
        envelopeVersion: 1,
        eventId: "message-content",
        eventType: "main_model_content",
        messageId: "assistant-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        dialogProcessId: "node-dialog-1",
        turnScopeId: "workflow-node:node-1",
        workflowRunId: "run-1",
        nodeExecutionId: "node-1",
        sequence: 50,
        revision: 1,
        timestamp: "2026-07-26T00:00:02.000Z",
        text: "child result",
      },
    },
    {
      event: "workflow_node_state_committed",
      transportSequence: 4,
      data: {
        ...identity,
        status: "succeeded",
        revision: 3,
        sequence: 3,
        eventId: "node-succeeded",
        updatedAt: "2026-07-26T00:00:03.000Z",
      },
    },
  ];
}

function newStore() {
  setActivePinia(createPinia());
  return useChatStore();
}

describe("workflow runtime live/replay homomorphism", () => {
  it("reduces persisted canonical events to the same registries as live events", () => {
    const events = runtimeEvents();
    const liveStore = newStore();
    events.forEach((event) => liveStore.applyWorkflowRuntimeEvent(event, { source: "live" }));

    const replayStore = newStore();
    const replayEvents = events.map((event) => ({
      ...normalizeWorkflowRuntimeEvent(event, { source: "session-detail-replay" }),
      transportSequence: Number(event.transportSequence) + 100000,
    }));
    hydrateWorkflowRegistryFromSessionDetail({
      detail: { sessionId: "root-1", workflowRuntimeEvents: replayEvents },
      mainSessionDoc: { sessionId: "root-1", messages: [] },
      applyWorkflowRuntimeEvent: replayStore.applyWorkflowRuntimeEvent,
    });

    expect(replayStore.workflowNodeStateRegistry).toEqual(liveStore.workflowNodeStateRegistry);
    expect(replayStore.subSessionMessageRegistry).toEqual(liveStore.subSessionMessageRegistry);
    const child = replayStore.selectSubSessionMessages("child-1");
    expect(child.sequenceByDomain).toMatchObject({
      "workflow-node-state": 3,
      "message-event": 50,
    });
    expect(child.sequenceByScopeKey).toMatchObject({
      "message-event:assistant-1": 50,
    });
  });

  it("rejects sequence values explicitly labeled with another domain", () => {
    const store = newStore();
    const result = store.applyWorkflowRuntimeEvent({
      event: "workflow_node_state_committed",
      data: {
        workflowRunId: "run-1",
        nodeExecutionId: "node-1",
        revision: 1,
        sequence: 900,
        sequenceDomain: "transport",
      },
    }, { source: "replay" });

    expect(result).toMatchObject({ applied: false, reason: "sequence_domain_mismatch" });
    expect(store.workflowNodeStateRegistry).toBeNull();
  });
});
