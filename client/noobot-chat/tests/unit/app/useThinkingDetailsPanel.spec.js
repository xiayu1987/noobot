/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref, nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useThinkingDetailsPanel } from "../../../src/app/composables/useThinkingDetailsPanel.js";
import { __resetThinkingDetailCacheForTests } from "../../../src/modules/chat/model/thinkingDetailCache.js";

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function createPanel(fetchThinkingDetail = vi.fn(), activeSession = ref({ messages: [] })) {
  return useThinkingDetailsPanel({
    activeSession,
    activeSessionId: ref("session-1"),
    fetchThinkingDetail,
    translate: (key) => key,
    thinkingDetailsPanel: "thinking-details",
  });
}

const workflowMessage = { role: "assistant", presentationMessageId: "workflow-presentation", dialogProcessId: "workflow-node", turnScopeId: "workflow-turn", hasThinkingDetails: true, thinkingDetailCount: 1 };
const normalMessage = { role: "assistant", presentationMessageId: "normal-presentation", dialogProcessId: "normal-message", turnScopeId: "normal-turn", hasThinkingDetails: true, thinkingDetailCount: 1 };

function detailFor(message) {
  return { messageItem: { ...message, loaded: true }, allMessages: [message], sessionDocs: [] };
}

describe("useThinkingDetailsPanel request isolation", () => {
  afterEach(() => __resetThinkingDetailCacheForTests());

  it("does not let a late workflow request overwrite a normal message opened afterwards", async () => {
    const workflowRequest = deferred();
    const normalRequest = deferred();
    const workflowFetcher = vi.fn(() => workflowRequest.promise);
    const normalFetcher = vi.fn(() => normalRequest.promise);
    const panel = createPanel();

    const openingWorkflow = panel.openThinkingDetailsPanel({
      messageItem: workflowMessage,
      allMessages: [workflowMessage],
      fetchThinkingDetail: workflowFetcher,
      forceFetch: true,
    });
    const openingNormal = panel.openThinkingDetailsPanel({
      messageItem: normalMessage,
      allMessages: [normalMessage],
      fetchThinkingDetail: normalFetcher,
      forceFetch: true,
    });

    workflowRequest.resolve(detailFor(workflowMessage));
    await openingWorkflow;
    expect(panel.thinkingDetailsMessageItem.value).toBe(null);

    normalRequest.resolve(detailFor(normalMessage));
    await openingNormal;
    expect(panel.thinkingDetailsMessageItem.value.dialogProcessId).toBe("normal-message");
    expect(workflowFetcher).toHaveBeenCalledWith("session-1", {
      dialogProcessId: "workflow-node",
      turnScopeId: "workflow-turn",
    });
    expect(normalFetcher).toHaveBeenCalledWith("session-1", {
      dialogProcessId: "normal-message",
      turnScopeId: "normal-turn",
    });
  });

  it("invalidates an in-flight request when the panel is closed", async () => {
    const request = deferred();
    const fetcher = vi.fn(() => request.promise);
    const panel = createPanel();
    const opening = panel.openThinkingDetailsPanel({
      messageItem: workflowMessage,
      allMessages: [workflowMessage],
      fetchThinkingDetail: fetcher,
      forceFetch: true,
    });

    panel.closeThinkingDetailsPanel();
    request.resolve(detailFor(workflowMessage));
    await opening;
    await nextTick();

    expect(panel.thinkingDetailsVisible.value).toBe(false);
    expect(panel.thinkingDetailsMessageItem.value).toBe(null);
  });

  it("binds the drawer to the active canonical turn instead of a stale click payload", async () => {
    const staleSummary = {
      role: "assistant",
      presentationMessageId: "presentation-1",
      sessionId: "session-1",
      dialogProcessId: "process-1",
      turnScopeId: "turn-1",
      hasThinkingDetails: true,
    };
    const canonicalMessage = {
      ...staleSummary,
      pending: true,
      toolTimeline: [{
        key: "call:one",
        toolCallId: "one",
        status: "running",
        call: { eventId: "call:one", sequence: 1, log: { event: "tool_call", text: "first" } },
      }],
    };
    const activeSession = ref({ messages: [canonicalMessage] });
    const injectedMessage = {
      role: "assistant",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      injectedMessage: true,
      content: "injected guidance",
    };
    const fetcher = vi.fn(async () => ({
      messageItem: canonicalMessage,
      allMessages: [canonicalMessage, injectedMessage],
      sessionDocs: [],
    }));
    const panel = createPanel(fetcher, activeSession);

    await panel.openThinkingDetailsPanel({ messageItem: staleSummary, allMessages: [staleSummary] });

    expect(panel.thinkingDetailsMessageItem.value).toEqual(canonicalMessage);
    expect(panel.thinkingDetailsMessageItem.value.toolTimeline).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(panel.thinkingDetailsAllMessages.value).toContainEqual(injectedMessage);

    const updatedCanonicalMessage = {
      ...canonicalMessage,
      toolTimeline: [{
        ...canonicalMessage.toolTimeline[0],
        status: "completed",
        resultEvent: { eventId: "result:one", sequence: 2, log: { event: "tool_result", text: "done" } },
      }],
    };
    activeSession.value = { messages: [updatedCanonicalMessage] };
    await nextTick();
    await nextTick();

    expect(panel.thinkingDetailsMessageItem.value).toEqual(updatedCanonicalMessage);
    expect(panel.thinkingDetailsMessageItem.value.toolTimeline[0].status).toBe("completed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(panel.thinkingDetailsAllMessages.value).toContainEqual(injectedMessage);
  });

  it("keeps the complete detail response authoritative for a completed turn", async () => {
    const summaryMessage = {
      role: "assistant",
      presentationMessageId: "presentation-complete",
      sessionId: "session-1",
      dialogProcessId: "process-complete",
      turnScopeId: "turn-complete",
      pending: false,
      hasThinkingDetails: true,
      thinkingDetailCount: 20,
      toolTimeline: [{ key: "summary:one", toolCallId: "summary-one", status: "completed" }],
    };
    const completeMessage = {
      ...summaryMessage,
      toolTimeline: Array.from({ length: 13 }, (_, index) => ({
        key: `call:${index + 1}`,
        toolCallId: `tool-${index + 1}`,
        status: "completed",
      })),
      activityTimeline: Array.from({ length: 7 }, (_, index) => ({
        eventId: `activity:${index + 1}`,
        sequence: index + 1,
      })),
    };
    const allMessages = Array.from({ length: 15 }, (_, index) => ({
      role: index % 2 === 0 ? "assistant" : "user",
      content: `message-${index + 1}`,
      turnScopeId: "turn-complete",
    }));
    const fetcher = vi.fn(async () => ({
      messageItem: completeMessage,
      allMessages,
      sessionDocs: [],
    }));
    const activeSession = ref({ messages: [summaryMessage] });
    const panel = createPanel(fetcher, activeSession);

    await panel.openThinkingDetailsPanel({ messageItem: summaryMessage });

    expect(panel.thinkingDetailsMessageItem.value.toolTimeline).toHaveLength(13);
    expect(panel.thinkingDetailsMessageItem.value.activityTimeline).toHaveLength(7);
    expect(panel.thinkingDetailsMessageItem.value.thinkingDetailCount).toBe(20);
    expect(panel.thinkingDetailsAllMessages.value).toHaveLength(15);

    activeSession.value = {
      messages: [{ ...summaryMessage, toolTimeline: [{
        key: "summary:updated",
        toolCallId: "summary-updated",
        status: "completed",
      }] }],
    };
    await nextTick();
    await nextTick();

    expect(panel.thinkingDetailsMessageItem.value.toolTimeline).toHaveLength(13);
    expect(panel.thinkingDetailsMessageItem.value.activityTimeline).toHaveLength(7);
    expect(panel.thinkingDetailsAllMessages.value).toHaveLength(15);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not bind the drawer to a different presentation in the same turn", async () => {
    const canonicalMessage = {
      role: "assistant",
      presentationMessageId: "presentation-canonical",
      sessionId: "session-1",
      dialogProcessId: "process-shared",
      turnScopeId: "turn-shared",
      toolTimeline: [{ key: "call:canonical", toolCallId: "canonical" }],
    };
    const clickedMessage = {
      role: "assistant",
      presentationMessageId: "presentation-clicked",
      sessionId: "session-1",
      dialogProcessId: "process-shared",
      turnScopeId: "turn-shared",
      hasThinkingDetails: true,
    };
    const fetcher = vi.fn(async () => detailFor(clickedMessage));
    const panel = createPanel(fetcher, ref({ messages: [canonicalMessage] }));

    await panel.openThinkingDetailsPanel({ messageItem: clickedMessage });

    expect(panel.thinkingDetailsMessageItem.value.presentationMessageId)
      .toBe("presentation-clicked");
    expect(panel.thinkingDetailsMessageItem.value).not.toBe(canonicalMessage);
  });

  it("refreshes a previously cached empty running detail", async () => {
    const emptyDetail = detailFor(normalMessage);
    const completeDetail = {
      ...detailFor(normalMessage),
      messageItem: {
        ...normalMessage,
        toolTimeline: [{ key: "call:done", toolCallId: "done", status: "completed" }],
      },
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(emptyDetail)
      .mockResolvedValueOnce(completeDetail);
    const panel = createPanel(fetcher);

    await panel.openThinkingDetailsPanel({ messageItem: normalMessage });
    panel.closeThinkingDetailsPanel();
    await panel.openThinkingDetailsPanel({ messageItem: normalMessage });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(panel.thinkingDetailsMessageItem.value.toolTimeline).toHaveLength(1);
  });
});
