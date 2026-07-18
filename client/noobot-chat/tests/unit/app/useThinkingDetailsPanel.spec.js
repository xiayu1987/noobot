/*
 * Copyright (c) 2026 xiayu
 * SPDX-License-Identifier: MIT
 */
import { ref, nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useThinkingDetailsPanel } from "../../../src/app/useThinkingDetailsPanel";

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function createPanel(fetchThinkingDetail = vi.fn()) {
  return useThinkingDetailsPanel({
    activeSession: ref({ messages: [] }),
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
});
