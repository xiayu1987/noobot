/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildViewMessage } from "../../../src/modules/chat/model/messageModel.js";
import { ref, nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useThinkingDetailsPanel } from "../../../src/app/composables/useThinkingDetailsPanel.js";
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
    releaseThinkingDetail: vi.fn(),
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
    ts: "2026-01-01T00:00:00.000Z",
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
    ts: "2026-01-01T00:00:00.000Z",
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
  it("publishes the selected page reader and clears it on close", async () => {
    const normalFetcher = vi.fn(async () => detailFor(normalMessage));
    const workflowFetcher = vi.fn(async () => detailFor(workflowMessage));
    const workflowReleaser = vi.fn();
    const panel = createPanel(normalFetcher);
    await panel.openThinkingDetailsPanel({
      messageItem: workflowMessage,
      fetchThinkingDetail: workflowFetcher,
      releaseThinkingDetail: workflowReleaser,
    });
    expect(panel.thinkingDetailsFetcher.value).toBe(workflowFetcher);
    expect(panel.thinkingDetailsReleaser.value).toBe(workflowReleaser);
    expect(workflowFetcher).not.toHaveBeenCalled();
    await panel.openThinkingDetailsPanel({ messageItem: normalMessage });
    expect(panel.thinkingDetailsFetcher.value).toBe(normalFetcher);
    expect(panel.thinkingDetailsReleaser.value).toBe(panel.dependencies.releaseThinkingDetail);
    panel.closeThinkingDetailsPanel();
    expect(panel.thinkingDetailsFetcher.value).toBeNull();
    expect(panel.thinkingDetailsReleaser.value).toBeNull();
  });

  it("switches readers without starting a competing drawer request", async () => {
    const workflowRequest = deferred();
    const normalRequest = deferred();
    const workflowFetcher = vi.fn(() => workflowRequest.promise);
    const normalFetcher = vi.fn(() => normalRequest.promise);
    const panel = createPanel();

    const openingWorkflow = panel.openThinkingDetailsPanel({
      messageItem: workflowMessage,
      fetchThinkingDetail: workflowFetcher,
      releaseThinkingDetail: vi.fn(),
    });
    const openingNormal = panel.openThinkingDetailsPanel({
      messageItem: normalMessage,
      fetchThinkingDetail: normalFetcher,
      releaseThinkingDetail: vi.fn(),
    });

    expect(panel.thinkingDetailsVisible.value).toBe(true);
    expect(panel.thinkingDetailsMessageItem.value.dialogProcessId).toBe("normal-message");

    workflowRequest.resolve(detailFor(workflowMessage));
    await openingWorkflow;
    expect(panel.thinkingDetailsMessageItem.value.dialogProcessId).toBe("normal-message");

    normalRequest.resolve(detailFor(normalMessage));
    await openingNormal;
    expect(panel.thinkingDetailsMessageItem.value.dialogProcessId).toBe("normal-message");
    expect(workflowFetcher).not.toHaveBeenCalled();
    expect(normalFetcher).not.toHaveBeenCalled();
  });

  it("clears the selection on close without issuing a drawer request", async () => {
    const request = deferred();
    const fetcher = vi.fn(() => request.promise);
    const panel = createPanel();
    const opening = panel.openThinkingDetailsPanel({
      messageItem: workflowMessage,
      fetchThinkingDetail: fetcher,
      releaseThinkingDetail: vi.fn(),
    });

    panel.closeThinkingDetailsPanel();
    request.resolve(detailFor(workflowMessage));
    await opening;
    await nextTick();

    expect(panel.thinkingDetailsVisible.value).toBe(false);
    expect(panel.thinkingDetailsMessageItem.value).toBe(null);
    expect(fetcher).not.toHaveBeenCalled();
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

  it("reopens without retaining the previous response or its snapshot", async () => {
    const activeSession = ref({ sessionId: "session-1", messages: [normalMessage] });
    const refresh = deferred();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        revision: "turn-journal:normal-turn:100",
        messageItem: { ...normalMessage, loaded: true, detailGeneration: 1 },
      })
      .mockReturnValueOnce(refresh.promise);
    const panel = createPanel(fetcher, activeSession);

    await panel.openThinkingDetailsPanel({ messageItem: normalMessage });
    panel.closeThinkingDetailsPanel();
    const reopening = panel.openThinkingDetailsPanel({ messageItem: normalMessage });

    expect(panel.thinkingDetailsVisible.value).toBe(true);
    expect(panel.thinkingDetailsMessageItem.value.detailGeneration).toBeUndefined();

    refresh.resolve({
      revision: "turn-journal:normal-turn:200",
      messageItem: { ...normalMessage, loaded: true, detailGeneration: 2 },
    });
    await reopening;

    expect(fetcher).not.toHaveBeenCalled();
    expect(panel.thinkingDetailsMessageItem.value.detailGeneration).toBeUndefined();
  });

  it("does not show the cached detail of another Turn lookup key", async () => {
    const activeSession = ref({
      sessionId: "session-1",
      messages: [normalMessage, workflowMessage],
    });
    const workflowRequest = deferred();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        revision: "turn-journal:normal-turn:100",
        messageItem: { ...normalMessage, loaded: true, detailGeneration: 1 },
      })
      .mockReturnValueOnce(workflowRequest.promise);
    const panel = createPanel(fetcher, activeSession);

    await panel.openThinkingDetailsPanel({ messageItem: normalMessage });
    panel.closeThinkingDetailsPanel();
    const openingWorkflow = panel.openThinkingDetailsPanel({ messageItem: workflowMessage });

    expect(panel.thinkingDetailsMessageItem.value.dialogProcessId).toBe("workflow-node");
    expect(panel.thinkingDetailsMessageItem.value.detailGeneration).toBeUndefined();

    workflowRequest.resolve({
      revision: "turn-journal:workflow-turn:50",
      messageItem: { ...workflowMessage, loaded: true, detailGeneration: 7 },
    });
    await openingWorkflow;

    expect(fetcher).not.toHaveBeenCalled();
    expect(panel.thinkingDetailsMessageItem.value.detailGeneration).toBeUndefined();
  });

  it("binds the drawer to the active canonical turn instead of a stale click payload", async () => {
    const staleSummary = {
      role: "assistant",
      ts: "2026-01-01T00:00:00.000Z",
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

  it("synchronizes local summaries while leaving detail ownership to the page reader", async () => {
    const summaryMessage = buildViewMessage(
      {
        role: "assistant",
        ts: "2026-01-01T00:00:00.000Z",
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

    expect(panel.thinkingDetailsMessageItem.value).toEqual(summaryMessage);
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

    expect(panel.thinkingDetailsMessageItem.value.toolTimeline[0].key).toBe("summary:updated");
    expect(panel.thinkingDetailsAllMessages.value).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not bind the drawer to a different presentation in the same turn", async () => {
    const canonicalMessage = buildViewMessage(
      {
        role: "assistant",
        ts: "2026-01-01T00:00:00.000Z",
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

  it("reopens with the local summary and delegates refresh to the page reader", async () => {
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

    expect(fetcher).not.toHaveBeenCalled();
    expect(panel.thinkingDetailsMessageItem.value).toEqual(normalMessage);
  });
});
