/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, reactive } from "vue";
const detailServiceMock = vi.hoisted(() => ({ getPage: null }));
vi.mock("../../../../../src/infrastructure/api/thinking/thinkingDetailService.js", () => ({
  thinkingDetailService: {
    getPage: (...args) => detailServiceMock.getPage(...args),
  },
}));
import { useThinkingTimeline } from "../../../../../src/modules/chat/composables/thinkingPanelTimeline.js";
import { canonicalActivityFact } from "../helpers/messageEventFixture.js";
import {
  createUserInterjectionContentFact,
  reduceThinkingDetailContentTimelines,
} from "@noobot/event-protocol/thinking-detail-content";

function interjectionFact(index) {
  return createUserInterjectionContentFact({
    messageUid: `interjection-${index}`,
    message: `interjection ${index}`,
    receivedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    sequence: index,
    sessionId: "session-a",
    dialogProcessId: "process-a",
    turnScopeId: "turn-a",
    presentationMessageId: "presentation-a",
  });
}

function toolMessage(index) {
  return {
    role: "assistant",
    type: "tool_call",
    messageUid: `uid-${index}`,
    presentationMessageId: `message-${index}`,
    sessionId: "session-a",
    turnScopeId: "turn-a",
    dialogProcessId: "process-a",
    content: "",
    toolTimeline: [
      {
        key: `call:call-${index}`,
        toolCallId: `call-${index}`,
        tool: "read_file",
        args: { filePath: `file-${index}.txt` },
        result: {
          ok: true,
          path: { view: "workspace", path: `file-${index}.txt` },
          fileName: `file-${index}.txt`,
        },
        call: { eventId: `call-event-${index}`, sequence: index * 2 + 1 },
        success: true,
        resultEvent: { eventId: `result-event-${index}`, sequence: index * 2 + 2 },
      },
    ],
    activityTimeline: [],
  };
}

describe("thinking panel round timeline reactivity", () => {
  let scope = null;

  it("releases an injected snapshot using its original reader and user", async () => {
    const messageItem = { ...toolMessage(0), pending: false };
    const cursor = { after: 1, scope: "original-snapshot" };
    const fetchThinkingDetail = vi.fn(async () => ({
      messageItem,
      page: { generation: 7, messageCount: 2, after: 0, count: 1, nextCursor: cursor },
    }));
    const releaseThinkingDetail = vi.fn(async () => ({ released: true }));
    const props = reactive({
      userId: "original-user",
      messageItem,
      allMessages: [],
      fetchThinkingDetail,
      releaseThinkingDetail,
    });
    scope = effectScope();
    const timeline = scope.run(() =>
      useThinkingTimeline(props, () => ({ running: false }), {
        shouldLoadThinkingDetail: () => false,
      }),
    );
    await timeline.detailPagination.restart();
    props.userId = "new-user";
    props.fetchThinkingDetail = vi.fn();
    props.releaseThinkingDetail = vi.fn();
    await timeline.detailPagination.invalidate();
    expect(fetchThinkingDetail).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "original-user" }),
    );
    expect(releaseThinkingDetail).toHaveBeenCalledTimes(1);
    expect(releaseThinkingDetail).toHaveBeenCalledWith({
      userId: "original-user",
      sessionId: messageItem.sessionId,
      dialogProcessId: messageItem.dialogProcessId,
      turnScopeId: messageItem.turnScopeId,
      cursor,
    });
    expect(props.releaseThinkingDetail).not.toHaveBeenCalled();
  });

  it("uses the supplied scoped reader for the first page and snapshot continuation", async () => {
    const messageItem = { ...toolMessage(0), pending: false };
    const cursor = { scope: "plugin-snapshot", after: 1 };
    const page = { generation: 7, messageCount: 2, after: 0, count: 1, nextCursor: cursor };
    const fetchThinkingDetail = vi
      .fn()
      .mockResolvedValueOnce({ messageItem, page })
      .mockResolvedValueOnce({
        messageItem,
        page: { ...page, after: 1, nextCursor: null },
      });
    detailServiceMock.getPage = vi.fn(() => {
      throw new Error("wrong authority");
    });
    const props = reactive({
      messageItem,
      allMessages: [],
      fetchThinkingDetail,
      releaseThinkingDetail: vi.fn(async () => ({ released: true })),
    });
    scope = effectScope();
    const timeline = scope.run(() =>
      useThinkingTimeline(props, () => ({ running: false }), {
        shouldLoadThinkingDetail: () => false,
      }),
    );
    await timeline.detailPagination.restart();
    await timeline.detailPagination.next();
    expect(fetchThinkingDetail).toHaveBeenCalledTimes(2);
    expect(fetchThinkingDetail.mock.calls[0][0]).toMatchObject({
      sessionId: messageItem.sessionId,
      cursor: null,
      snapshot: null,
    });
    expect(fetchThinkingDetail.mock.calls[1][0]).toMatchObject({
      sessionId: messageItem.sessionId,
      cursor,
      snapshot: page,
    });
    expect(detailServiceMock.getPage).not.toHaveBeenCalled();
    expect(timeline.detailPagination.error.value).toBeNull();
  });

  it.each(["user", "reader"])(
    "rejects stale in-flight results after a %s switch",
    async (change) => {
      let finishOld;
      const oldRequest = new Promise((resolve) => {
        finishOld = resolve;
      });
      const messageItem = { ...toolMessage(0), pending: false };
      const page = { generation: 7, messageCount: 1, after: 0, count: 1, nextCursor: null };
      const oldReader = vi.fn(() => oldRequest);
      const newReader = vi.fn(async () => ({
        messageItem: { ...messageItem, source: "new" },
        page,
      }));
      detailServiceMock.getPage = vi.fn(({ userId }) =>
        userId === "old-user" ? oldRequest : newReader(),
      );
      const props = reactive({
        messageItem,
        allMessages: [],
        userId: "old-user",
        fetchThinkingDetail: change === "reader" ? oldReader : undefined,
        releaseThinkingDetail: vi.fn(async () => ({ released: true })),
      });
      scope = effectScope();
      const timeline = scope.run(() => useThinkingTimeline(props, () => ({ running: false })));
      if (change === "reader") props.fetchThinkingDetail = newReader;
      else props.userId = "new-user";
      await nextTick();
      await Promise.resolve();
      await nextTick();
      expect(newReader).toHaveBeenCalledTimes(1);
      expect(timeline.loadedThinkingDetail.value.messageItem.source).toBe("new");
      finishOld({ messageItem: { ...messageItem, source: "old" }, page });
      await nextTick();
      await Promise.resolve();
      expect(timeline.loadedThinkingDetail.value.messageItem.source).toBe("new");
      expect(timeline.detailPagination.error.value).toBeNull();
    },
  );

  afterEach(() => {
    scope?.stop();
    scope = null;
    detailServiceMock.getPage = null;
  });

  function mountRound() {
    const live = {
      role: "assistant",
      messageUid: "uid-live",
      presentationMessageId: "message-live",
      sessionId: "session-a",
      turnScopeId: "turn-a",
      dialogProcessId: "process-a",
      content: "",
      pending: true,
      toolTimeline: [],
      activityTimeline: [],
    };
    const allMessages = reactive([toolMessage(0), toolMessage(1), live]);
    const props = reactive({ messageItem: allMessages[2], allMessages, variant: "panel" });
    scope = effectScope();
    const timeline = scope.run(() => useThinkingTimeline(props, () => ({ running: true })));
    return { props, allMessages, live: allMessages[2], timeline };
  }

  it("keeps the round projection stable while only answer content streams", async () => {
    const { live, timeline } = mountRound();
    const before = timeline.currentExecutionLogs.value;
    expect(before.map((log) => log.toolCallId)).toEqual(["call-0", "call-0", "call-1", "call-1"]);

    live.content += "streamed answer";
    await nextTick();

    expect(timeline.currentExecutionLogs.value).toBe(before);
  });

  it("keeps the round tool projection stable while only analysis activity streams", async () => {
    const { live, timeline } = mountRound();
    const before = timeline.currentExecutionLogs.value;

    for (let index = 1; index <= 3; index += 1) {
      live.activityTimeline = [
        canonicalActivityFact({
          eventId: "activity-live",
          activityId: "activity-live",
          eventType: "model_analysis_delta",
          activityKind: "main_model_analysis",
          text: "a".repeat(index),
          sequence: 100 + index,
        }),
      ];
      await nextTick();
      expect(timeline.currentExecutionLogs.value).toBe(before);
    }
  });

  it("keeps completed round projections when another turn replaces the session list", async () => {
    const { props, allMessages, timeline } = mountRound();
    const before = timeline.currentExecutionLogs.value;
    const nextTurn = { ...toolMessage(2), turnScopeId: "turn-b" };
    props.allMessages = [...allMessages, nextTurn];
    await nextTick();
    expect(timeline.currentExecutionLogs.value).toBe(before);
    allMessages[1].toolTimeline[0].result.fileName = "changed.txt";
    await nextTick();
    expect(timeline.currentExecutionLogs.value).not.toBe(before);
    expect(timeline.currentExecutionLogs.value.at(-1).detailValue.fileName).toBe("changed.txt");
  });

  it("counts execution events without serializing tool results", () => {
    const { allMessages, live, timeline } = mountRound();
    const serialize = vi.fn(() => ({ ok: true }));
    allMessages[0].toolTimeline[0].result.toJSON = serialize;
    expect(timeline.getExecutionLogCount(live)).toBe(4);
    expect(serialize).not.toHaveBeenCalled();
  });

  it("reprojects the round when a sibling tool timeline changes", async () => {
    const { allMessages, timeline } = mountRound();
    const before = timeline.currentExecutionLogs.value;

    allMessages[1].toolTimeline[0].result = {
      ok: true,
      path: { view: "workspace", path: "updated.txt" },
      fileName: "updated.txt",
    };
    await nextTick();

    const after = timeline.currentExecutionLogs.value;
    expect(after).not.toBe(before);
    expect(after.at(-1).detailValue).not.toEqual(before.at(-1).detailValue);
  });

  it("merges a loaded thinking detail snapshot with later realtime interjections", async () => {
    const settled = {
      role: "assistant",
      messageUid: "uid-settled",
      presentationMessageId: "message-settled",
      sessionId: "session-a",
      turnScopeId: "turn-a",
      dialogProcessId: "process-a",
      content: "",
      pending: false,
      toolTimeline: [],
      activityTimeline: [],
    };
    const allMessages = reactive([settled]);
    detailServiceMock.getPage = async () => ({
      exists: true,
      revision: "revision-1",
      messageItem: { ...settled, thinkingContentTimeline: [interjectionFact(1)] },
      page: { generation: 3, messageCount: 1, after: 0, count: 1, nextCursor: null },
    });
    const props = reactive({
      messageItem: allMessages[0],
      allMessages,
      userId: "user-a",
    });
    scope = effectScope();
    const timeline = scope.run(() => useThinkingTimeline(props, () => ({ running: true })));
    const texts = () => timeline.thinkingContentItems.value.map((item) => item.text);
    const live = allMessages[0];

    live.thinkingContentTimeline = reduceThinkingDetailContentTimelines([], [interjectionFact(1)]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
    expect(timeline.loadedThinkingDetail.value).toBeTruthy();

    for (const index of [2, 3]) {
      live.thinkingContentTimeline = reduceThinkingDetailContentTimelines(
        live.thinkingContentTimeline,
        [interjectionFact(index)],
      );
      await nextTick();
    }

    expect(texts()).toEqual(["interjection 1", "interjection 2", "interjection 3"]);
  });
});
