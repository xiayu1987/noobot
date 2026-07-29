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

const workflowMessage = { role: "assistant", dialogProcessId: "workflow-node", turnScopeId: "workflow-turn", hasThinkingDetails: true, thinkingDetailCount: 1 };
const normalMessage = { role: "assistant", dialogProcessId: "normal-message", turnScopeId: "normal-turn", hasThinkingDetails: true, thinkingDetailCount: 1 };

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
      sessionId: "session-1",
      dialogProcessId: "process-1",
      turnScopeId: "turn-1",
      hasThinkingDetails: true,
    };
    const canonicalMessage = {
      ...staleSummary,
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
