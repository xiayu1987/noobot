/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildViewMessage } from "../../../src/modules/chat/model/messageModel.js";
import { ref, nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useThinkingDetailsPanel } from "../../../src/app/composables/useThinkingDetailsPanel.js";
import { __resetThinkingDetailCacheForTests } from "../../../src/modules/chat/model/thinkingDetailCache.js";
import { canonicalActivityFact } from "../modules/chat/helpers/messageEventFixture.js";

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createPanel(fetchThinkingDetail = vi.fn(), activeSession = ref({ messages: [] })) {
  const dependencies = {
    notify: vi.fn(),
    closeAllDrawers: vi.fn(),
    closeMobileSidebar: vi.fn(),
    closeComposerMorePanel: vi.fn(),
    pushPseudoRoute: vi.fn(),
  };
  const panel = useThinkingDetailsPanel({
    activeSession,
    activeSessionId: ref("session-1"),
    fetchThinkingDetail,
    translate: (key) => key,
    thinkingDetailsPanel: "thinking-details",
    ...dependencies,
  });
  return Object.assign(panel, { dependencies });
}

const workflowMessage = buildViewMessage(
  {
    role: "assistant",
    content: "",
    presentationMessageId: "workflow-presentation",
    dialogProcessId: "workflow-node",
    turnScopeId: "workflow-turn",
    hasThinkingDetails: true,
  },
  { sessionId: "session-1" },
);
const normalMessage = buildViewMessage(
  {
    role: "assistant",
    content: "",
    presentationMessageId: "normal-presentation",
    dialogProcessId: "normal-message",
    turnScopeId: "normal-turn",
    hasThinkingDetails: true,
  },
  { sessionId: "session-1" },
);

function detailFor(message) {
  return { messageItem: { ...message, loaded: true } };
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
      fetchThinkingDetail: workflowFetcher,
    });
    const openingNormal = panel.openThinkingDetailsPanel({
      messageItem: normalMessage,
      fetchThinkingDetail: normalFetcher,
    });

    expect(panel.thinkingDetailsVisible.value).toBe(true);
    expect(panel.thinkingDetailsMessageItem.value.dialogProcessId).toBe("normal-message");

    workflowRequest.resolve(detailFor(workflowMessage));
    await openingWorkflow;
    expect(panel.thinkingDetailsMessageItem.value.dialogProcessId).toBe("normal-message");

    normalRequest.resolve(detailFor(normalMessage));
    await openingNormal;
    expect(panel.thinkingDetailsMessageItem.value.dialogProcessId).toBe("normal-message");
    expect(workflowFetcher).toHaveBeenCalledWith({
      sessionId: "session-1",
      dialogProcessId: "workflow-node",
      turnScopeId: "workflow-turn",
    });
    expect(normalFetcher).toHaveBeenCalledWith({
      sessionId: "session-1",
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
      fetchThinkingDetail: fetcher,
    });

    panel.closeThinkingDetailsPanel();
    request.resolve(detailFor(workflowMessage));
    await opening;
    await nextTick();

    expect(panel.thinkingDetailsVisible.value).toBe(false);
    expect(panel.thinkingDetailsMessageItem.value).toBe(null);
  });

  it("closes drawers and pushes the pseudo route when opening the panel", async () => {
    const fetcher = vi.fn(async () => detailFor(normalMessage));
    const panel = createPanel(fetcher);

    await panel.openThinkingDetailsPanel({ messageItem: normalMessage });

    expect(panel.dependencies.closeAllDrawers).toHaveBeenCalledTimes(1);
    expect(panel.dependencies.closeMobileSidebar).toHaveBeenCalledTimes(1);
    expect(panel.dependencies.closeComposerMorePanel).toHaveBeenCalledTimes(1);
    expect(panel.dependencies.pushPseudoRoute).toHaveBeenCalledTimes(1);
  });

  it("does not push a pseudo route when pushRoute is false", async () => {
    const fetcher = vi.fn(async () => detailFor(normalMessage));
    const panel = createPanel(fetcher);

    await panel.openThinkingDetailsPanel({ messageItem: normalMessage, pushRoute: false });

    expect(panel.dependencies.pushPseudoRoute).not.toHaveBeenCalled();
  });

  it("reuses a cached completed detail when the authoritative revision is unchanged", async () => {
    const message = buildViewMessage(
      {
        ...normalMessage,
        sessionId: "session-1",
        thinkingDetailRef: { contentHash: "sha256:detail-seven" },
      },
      { sessionId: "session-1" },
    );
    const activeSession = ref({
      sessionId: "session-1",
      aggregateVersion: 7,
      messages: [message],
    });
    const fetcher = vi.fn(async () => ({
      revision: "sha256:detail-seven",
      messageItem: { ...message, loaded: true },
    }));
    const panel = createPanel(fetcher, activeSession);

    await panel.openThinkingDetailsPanel({ messageItem: message });
    panel.closeThinkingDetailsPanel();
    await panel.openThinkingDetailsPanel({ messageItem: message });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(panel.thinkingDetailsVisible.value).toBe(true);
    expect(panel.thinkingDetailsMessageItem.value.loaded).toBe(true);
  });

  it("does not reuse detail when its authoritative content hash changes", async () => {
    const firstMessage = buildViewMessage(
      {
        ...normalMessage,
        sessionId: "session-1",
        thinkingDetailRef: { contentHash: "sha256:first-detail" },
      },
      { sessionId: "session-1" },
    );
    const secondMessage = buildViewMessage(
      {
        ...firstMessage,
        thinkingDetailRef: { contentHash: "sha256:second-detail" },
      },
      { sessionId: "session-1" },
    );
    const activeSession = ref({
      sessionId: "session-1",
      aggregateVersion: 1,
      messages: [firstMessage],
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        revision: "sha256:first-detail",
        messageItem: { ...firstMessage, detailGeneration: 1 },
      })
      .mockResolvedValueOnce({
        revision: "sha256:second-detail",
        messageItem: { ...secondMessage, detailGeneration: 2 },
      });
    const panel = createPanel(fetcher, activeSession);

    await panel.openThinkingDetailsPanel({ messageItem: firstMessage });
    panel.closeThinkingDetailsPanel();
    activeSession.value = {
      sessionId: "session-1",
      aggregateVersion: 1,
      messages: [secondMessage],
    };
    await panel.openThinkingDetailsPanel({ messageItem: secondMessage });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(panel.thinkingDetailsMessageItem.value.detailGeneration).toBe(2);
  });

  it("binds the drawer to the active canonical turn instead of a stale click payload", async () => {
    const staleSummary = {
      role: "assistant",
      content: "",
      presentationMessageId: "presentation-1",
      sessionId: "session-1",
      dialogProcessId: "process-1",
      turnScopeId: "turn-1",
      hasThinkingDetails: true,
    };
    const canonicalMessage = buildViewMessage(
      {
        ...staleSummary,
        pending: true,
        toolTimeline: [
          {
            key: "call:one",
            toolCallId: "one",
            status: "running",
            call: { eventId: "call:one", sequence: 1, log: { event: "tool_call", text: "first" } },
          },
        ],
      },
      { sessionId: "session-1" },
    );
    const activeSession = ref({ messages: [canonicalMessage] });
    const fetcher = vi.fn();
    const panel = createPanel(fetcher, activeSession);

    await panel.openThinkingDetailsPanel({ messageItem: staleSummary });

    expect(panel.thinkingDetailsMessageItem.value).toEqual(canonicalMessage);
    expect(panel.thinkingDetailsMessageItem.value.toolTimeline).toHaveLength(1);
    expect(fetcher).not.toHaveBeenCalled();

    const updatedCanonicalMessage = buildViewMessage(
      {
        ...canonicalMessage,
        toolTimeline: [
          {
            ...canonicalMessage.toolTimeline[0],
            status: "completed",
            resultEvent: {
              eventId: "result:one",
              sequence: 2,
              log: { event: "tool_result", text: "done" },
            },
          },
        ],
      },
      { sessionId: "session-1" },
    );
    activeSession.value = { messages: [updatedCanonicalMessage] };
    await nextTick();
    await nextTick();

    expect(panel.thinkingDetailsMessageItem.value).toEqual(updatedCanonicalMessage);
    expect(panel.thinkingDetailsMessageItem.value.toolTimeline[0].status).toBe("completed");
    expect(fetcher).not.toHaveBeenCalled();
    const thinkingActivity = canonicalActivityFact({
      eventId: "guidance:two",
      sequence: 3,
      activityKind: "guidance_analysis",
      text: "new realtime guidance",
      sequenceScopeId: "presentation-1",
      presentationMessageId: "presentation-1",
    });
    const nextCanonicalMessage = buildViewMessage(
      {
        ...updatedCanonicalMessage,
        activityTimeline: [thinkingActivity],
      },
      { sessionId: "session-1" },
    );
    activeSession.value = {
      messages: [nextCanonicalMessage],
    };
    await nextTick();
    await nextTick();

    expect(panel.thinkingDetailsMessageItem.value.activityTimeline).toEqual([thinkingActivity]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps the complete detail response authoritative for a completed turn", async () => {
    const summaryMessage = buildViewMessage(
      {
        role: "assistant",
        content: "",
        presentationMessageId: "presentation-complete",
        sessionId: "session-1",
        dialogProcessId: "process-complete",
        turnScopeId: "turn-complete",
        pending: false,
        hasThinkingDetails: true,
        toolTimeline: [{ key: "summary:one", toolCallId: "summary-one", status: "completed" }],
      },
      { sessionId: "session-1" },
    );
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
    const fetcher = vi.fn(async () => ({
      messageItem: completeMessage,
    }));
    const activeSession = ref({ messages: [summaryMessage] });
    const panel = createPanel(fetcher, activeSession);

    await panel.openThinkingDetailsPanel({ messageItem: summaryMessage });

    expect(panel.thinkingDetailsMessageItem.value.toolTimeline).toHaveLength(13);
    expect(panel.thinkingDetailsMessageItem.value.activityTimeline).toHaveLength(7);
    expect(Object.hasOwn(panel.thinkingDetailsMessageItem.value, "thinkingDetailCount")).toBe(
      false,
    );
    expect(panel.thinkingDetailsAllMessages.value).toHaveLength(0);

    activeSession.value = {
      messages: [
        {
          ...summaryMessage,
          toolTimeline: [
            {
              key: "summary:updated",
              toolCallId: "summary-updated",
              status: "completed",
            },
          ],
        },
      ],
    };
    await nextTick();
    await nextTick();

    expect(panel.thinkingDetailsMessageItem.value.toolTimeline).toHaveLength(13);
    expect(panel.thinkingDetailsMessageItem.value.activityTimeline).toHaveLength(7);
    expect(panel.thinkingDetailsAllMessages.value).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not bind the drawer to a different presentation in the same turn", async () => {
    const canonicalMessage = buildViewMessage(
      {
        role: "assistant",
        content: "",
        presentationMessageId: "presentation-canonical",
        sessionId: "session-1",
        dialogProcessId: "process-shared",
        turnScopeId: "turn-shared",
        toolTimeline: [{ key: "call:canonical", toolCallId: "canonical" }],
      },
      { sessionId: "session-1" },
    );
    const clickedMessage = {
      role: "assistant",
      content: "",
      presentationMessageId: "presentation-clicked",
      sessionId: "session-1",
      dialogProcessId: "process-shared",
      turnScopeId: "turn-shared",
      hasThinkingDetails: true,
    };
    const fetcher = vi.fn(async () => detailFor(clickedMessage));
    const panel = createPanel(fetcher, ref({ messages: [canonicalMessage] }));

    await panel.openThinkingDetailsPanel({ messageItem: clickedMessage });

    expect(panel.thinkingDetailsMessageItem.value.presentationMessageId).toBe(
      "presentation-clicked",
    );
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
    const fetcher = vi
      .fn()
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
