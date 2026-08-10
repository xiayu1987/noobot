/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { normalizeWorkflowRuntimeEvent } from "@noobot/event-protocol/workflow-runtime-event";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";
import { hydrateWorkflowRegistryFromSessionDetail } from "../../../../../../../plugin/noobot-plugin-workflow/frontend/runtime/sessionHydration.js";

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
        envelopeVersion: 2,
        eventId: "message-content",
        eventType: "authoritative_final_content",
        messageId: "assistant-1",
        presentationMessageId: "assistant-1",
        sequenceDomain: "message-event",
        sequenceScopeId: "assistant-1",
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

function messageEvent({ sequence = 1, eventId = `message-${sequence}`, text = "live result" } = {}) {
  return {
    event: "workflow_message_event",
    data: {
      envelopeKind: "noobot.message_event",
      envelopeVersion: 2,
      eventId,
      eventType: "authoritative_final_content",
      messageId: "assistant-1",
      presentationMessageId: "assistant-1",
      sequenceDomain: "message-event",
      sequenceScopeId: "assistant-1",
      sessionId: "child-1",
      parentSessionId: "root-1",
      dialogProcessId: "node-dialog-1",
      turnScopeId: "workflow-node:node-1",
      workflowRunId: "run-1",
      nodeExecutionId: "node-1",
      sequence,
      revision: sequence,
      timestamp: `2026-07-26T00:00:0${sequence}.000Z`,
      text,
    },
  };
}

function snapshotEvent({ version = 1, status = "running", content = "snapshot result" } = {}) {
  return {
    event: "workflow_session_snapshot_loaded",
    data: {
      sessionId: "child-1",
      parentSessionId: "root-1",
      workflowRunId: "run-1",
      nodeExecutionId: "node-1",
      aggregateVersion: version,
      status,
      messages: [{ id: "assistant-1", messageId: "assistant-1", role: "assistant", content }],
    },
  };
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

  it("keeps the authoritative realtime message when a snapshot arrives before or after it", () => {
    const snapshotFirst = newStore();
    snapshotFirst.applyWorkflowRuntimeEvent(snapshotEvent(), { source: "snapshot" });
    snapshotFirst.applyWorkflowRuntimeEvent(messageEvent(), { source: "live" });

    const realtimeFirst = newStore();
    realtimeFirst.applyWorkflowRuntimeEvent(messageEvent(), { source: "live" });
    realtimeFirst.applyWorkflowRuntimeEvent(snapshotEvent(), { source: "snapshot" });

    expect(snapshotFirst.selectSubSessionMessages("child-1").messages).toEqual(
      realtimeFirst.selectSubSessionMessages("child-1").messages,
    );
    expect(realtimeFirst.selectSubSessionMessages("child-1").messages[0]).toMatchObject({
      messageId: "assistant-1",
      content: "live result",
      sequenceDomain: "message-event",
    });
  });

  it("reduces multiple child model messages into one presentation entity", () => {
    const store = newStore();
    const applyMessageEvent = (overrides = {}) => store.applyWorkflowRuntimeEvent({
      event: "workflow_message_event",
      data: {
        envelopeKind: "noobot.message_event",
        envelopeVersion: 2,
        sessionId: "child-1",
        parentSessionId: "root-1",
        dialogProcessId: "node-dialog-1",
        turnScopeId: "workflow-node:node-1",
        workflowRunId: "run-1",
        nodeExecutionId: "node-1",
        presentationMessageId: "presentation-1",
        sequenceDomain: "message-event",
        timestamp: "2026-07-26T00:00:01.000Z",
        ...overrides,
      },
    }, { source: "live" });

    applyMessageEvent({
      eventId: "tool-1-start", eventType: "tool_call_start",
      messageId: "model-tool-1", sequenceScopeId: "model-tool-1", sequence: 1,
      tool: "read_file", toolCallId: "call-1", args: { path: "a.txt" },
    });
    applyMessageEvent({
      eventId: "tool-1-end", eventType: "tool_call_end",
      messageId: "model-tool-1", sequenceScopeId: "model-tool-1", sequence: 2,
      tool: "read_file", toolCallId: "call-1", result: "a",
    });
    applyMessageEvent({
      eventId: "tool-2-start", eventType: "tool_call_start",
      messageId: "model-tool-2", sequenceScopeId: "model-tool-2", sequence: 1,
      tool: "search", toolCallId: "call-2", args: { query: "a" },
    });
    applyMessageEvent({
      eventId: "final", eventType: "authoritative_final_content",
      messageId: "model-final", sequenceScopeId: "model-final", sequence: 1,
      text: "one final answer",
    });

    const child = store.selectSubSessionMessages("child-1");
    expect(child.messages).toHaveLength(1);
    expect(child.messages[0]).toMatchObject({
      id: "presentation-1",
      messageId: "presentation-1",
      presentationMessageId: "presentation-1",
      content: "one final answer",
    });
    expect(child.messages[0].toolTimeline).toHaveLength(2);
  });

  it("rejects stale and duplicate snapshots by the session snapshot version lane", () => {
    const store = newStore();
    expect(store.applyWorkflowRuntimeEvent(snapshotEvent({ version: 2 }), { source: "snapshot" }).applied).toBe(true);
    expect(store.applyWorkflowRuntimeEvent(snapshotEvent({ version: 2, content: "conflict" }), { source: "snapshot" }))
      .toMatchObject({ applied: false, reason: "duplicate_snapshot_version" });
    expect(store.applyWorkflowRuntimeEvent(snapshotEvent({ version: 1, content: "stale" }), { source: "snapshot" }))
      .toMatchObject({ applied: false, reason: "stale_snapshot" });
    expect(store.selectSubSessionMessages("child-1")).toMatchObject({
      sequenceByDomain: { "workflow-session-snapshot": 2 },
      messages: [{ content: "snapshot result" }],
    });
  });

  it("does not let a reconnect snapshot overwrite a live terminal lifecycle", () => {
    const store = newStore();
    store.applyWorkflowRuntimeEvent({
      event: "workflow_node_state_committed",
      data: {
        workflowRunId: "run-1",
        nodeExecutionId: "node-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        turnScopeId: "workflow-node:node-1",
        status: "failed",
        eventId: "node-failed",
        revision: 3,
        sequence: 3,
      },
    }, { source: "live" });

    store.applyWorkflowRuntimeEvent(snapshotEvent({ version: 9, status: "running" }), { source: "snapshot" });
    expect(store.selectWorkflowNodeState("child-1", "workflow-node:node-1")?.status).toBe("failed");
    expect(store.selectSubSessionMessages("child-1")?.workflowNodeState?.status).toBe("failed");
    expect(store.selectSubSessionMessages("child-1")?.status).toBe("");
  });
});
