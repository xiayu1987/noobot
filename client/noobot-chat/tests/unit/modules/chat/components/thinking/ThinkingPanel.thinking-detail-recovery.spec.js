/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mountThinkingPanel } from "./ThinkingPanel.test-helpers.js";
import { loadThinkingDetail } from "../../../../../../src/modules/chat/model/thinkingDetailRequest.js";
import { normalizeThinkingToolLogs } from "../../../../../../src/modules/chat/model/thinkingDetailModel.js";
import ThinkingPanelRealtime from "../../../../../../src/modules/chat/components/thinking/ThinkingPanelRealtime.vue";
import { setTurnThinkingOpenNames } from "../../../../../../src/modules/chat/runtime/engine/turnUiStore.js";
import { API_REQUEST_ERROR_CODE, ApiRequestError } from "@noobot/shared/request-error";
import { compactThinkingTimeline } from "@noobot/event-protocol/tool-timeline";
import {
  completedToolTimelineItem,
  toolResultText,
} from "../../../../helpers/toolTimelineFixture.js";

const detailServiceMock = vi.hoisted(() => ({ getDetail: null }));
vi.mock("../../../../../../src/infrastructure/api/thinking/thinkingDetailService.js", () => ({
  thinkingDetailService: {
    getPage: (...args) => detailServiceMock.getDetail(...args),
  },
}));

async function rejectUnservedDetail() {
  throw new ApiRequestError("thinking detail is not served after the test", {
    code: API_REQUEST_ERROR_CODE.HTTP,
    status: 503,
  });
}

async function flushAsync() {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

function thinkingDetailPayload(messageItem) {
  return {
    ok: true,
    exists: true,
    messageItem,
    page: { generation: 3, messageCount: 1, after: 0, count: 1, nextCursor: null },
  };
}

function readFilePath(name) {
  return `docs/${name}.md`;
}

function displayText(name) {
  return `read_file · ${readFilePath(name)}`;
}

function readFileResult(name) {
  return toolResultText({
    ok: true,
    path: { view: "workspace", path: readFilePath(name) },
    fileName: `${name}.md`,
  });
}

function persistedToolTimeline(name, id = "call-1") {
  return [
    completedToolTimelineItem({
      toolCallId: id,
      tool: "read_file",
      args: { filePath: readFilePath(name) },
      result: readFileResult(name),
      success: true,
      resultEvent: {
        eventId: `result:${id}`,
        sequence: 1,
        sequenceScopeId: "message-1",
        sequenceDomain: "message-event",
        authority: "authoritative",
      },
    }),
  ];
}

describe("ThinkingPanel thinking-detail recovery", () => {
  afterEach(() => {
    detailServiceMock.getDetail = rejectUnservedDetail;
    vi.restoreAllMocks();
  });

  it("keeps the restored event count and window when a detail page has only some calls", async () => {
    const toolTimeline = Array.from({ length: 6 }, (_, index) => {
      const [item] = persistedToolTimeline(`file-${index}`, `call-${index}`);
      const sequence = index * 2 + 1;
      return {
        ...item,
        call: { ...item.resultEvent, eventId: `call-${index}`, sequence },
        resultEvent: { ...item.resultEvent, sequence: sequence + 1 },
      };
    });
    const messageItem = {
      role: "assistant",
      sessionId: "session-restored-window",
      turnScopeId: "client-turn:restored-window",
      dialogProcessId: "dp-restored-window",
      hasThinkingDetails: true,
      toolTimeline: compactThinkingTimeline(toolTimeline),
    };
    detailServiceMock.getDetail = async () =>
      thinkingDetailPayload({ ...messageItem, toolTimeline: toolTimeline.slice(0, 2) });
    const wrapper = mountThinkingPanel(messageItem, { userId: "user-1" });
    const realtime = wrapper.getComponent(ThinkingPanelRealtime);
    expect(realtime.props("executionLogCount")).toBe(12);
    expect(realtime.props("executionLogs")).toHaveLength(10);
    expect(realtime.props("thinkingDetailLabel")).toMatch(/\(12\)/);

    setTurnThinkingOpenNames(messageItem, ["thinking-panel"]);
    await flushAsync();
    expect(realtime.props("executionLogCount")).toBe(12);
    expect(realtime.props("executionLogs")).toHaveLength(10);
    expect(realtime.props("executionLogs")[0].detailText).toContain("docs/file-1.md");
    expect(realtime.props("executionLogs").at(-1).eventId).toBe("result:call-5");
    expect(realtime.props("thinkingDetailLabel")).toMatch(/\(12\)/);
  });

  it("retains only the mounted panel page across same-turn message replacement", async () => {
    const getDetail = vi.fn(async (params) => {
      expect(params).toEqual({
        userId: "user-1",
        sessionId: "session-restore",
        turnScopeId: "client-turn:restore",
        dialogProcessId: "dp-restore",
        cursor: null,
        snapshot: null,
      });
      return thinkingDetailPayload({
        role: "assistant",
        sessionId: "session-restore",
        turnScopeId: "client-turn:restore",
        dialogProcessId: "dp-restore",
        toolTimeline: persistedToolTimeline("persisted-tool"),
      });
    });

    detailServiceMock.getDetail = getDetail;
    const wrapper = mountThinkingPanel(
      {
        role: "assistant",
        sessionId: "session-restore",
        turnScopeId: "client-turn:restore",
        dialogProcessId: "dp-restore",
        hasThinkingDetails: true,
      },
      {
        userId: "user-1",
        runtime: {
          running: false,
          terminal: true,
          startedAt: "2026-07-21T10:00:00.000Z",
          finishedAt: "2026-07-21T10:00:01.000Z",
        },
      },
    );

    await flushAsync();
    expect(getDetail).not.toHaveBeenCalled();
    setTurnThinkingOpenNames(wrapper.props("messageItem"), ["thinking-panel"]);
    await flushAsync();
    expect(getDetail).toHaveBeenCalledTimes(1);
    const cached = wrapper.vm.loadedThinkingDetail;
    expect(cached).toBeTruthy();
    expect(cached?.messageItem?.toolTimeline).toHaveLength(1);
    expect(
      normalizeThinkingToolLogs({
        messageItem: cached.messageItem,
        variant: "panel",
      }).map((item) => item.text),
    ).toContain(displayText("persisted-tool"));
    expect(cached.messageItem.toolTimeline).toHaveLength(1);

    await wrapper.setProps({
      messageItem: {
        role: "assistant",
        sessionId: "session-restore",
        turnScopeId: "client-turn:restore",
        dialogProcessId: "dp-restore",
        hasThinkingDetails: true,
      },
    });
    await flushAsync();

    expect(getDetail).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.loadedThinkingDetail?.messageItem?.toolTimeline).toHaveLength(1);
  });

  it("does not let an older detail page replace the latest interjection from the message", async () => {
    const interjection = (sequence) => ({
      contentId: `message:user-interjection-${sequence}`,
      contentKind: "user_interjection",
      sourceMessageUid: `user-interjection-${sequence}`,
      text: `accepted interjection ${sequence}`,
      sequence,
    });
    const messageItem = {
      role: "assistant",
      sessionId: "session-interjection-detail",
      turnScopeId: "client-turn:interjection-detail",
      dialogProcessId: "dp-interjection-detail",
      hasThinkingDetails: true,
      toolTimeline: persistedToolTimeline("local-tool", "call-local"),
      thinkingContentTimeline: [interjection(5)],
    };
    const getDetail = vi.fn(async () =>
      thinkingDetailPayload({
        ...messageItem,
        thinkingContentTimeline: [interjection(2)],
      }),
    );
    detailServiceMock.getDetail = getDetail;
    const wrapper = mountThinkingPanel(messageItem, {
      userId: "user-1",
      runtime: { running: false, terminal: true },
    });

    setTurnThinkingOpenNames(wrapper.props("messageItem"), ["thinking-panel"]);
    await flushAsync();

    expect(getDetail).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-thinking-block="user-interjection"]').text()).toContain(
      "accepted interjection 5",
    );
    expect(wrapper.vm.loadedThinkingDetail.messageItem.thinkingContentTimeline).toEqual([
      interjection(2),
    ]);
  });

  it("reports missing detail without an implicit retry", async () => {
    const getDetail = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiRequestError("thinking detail not found", {
          code: API_REQUEST_ERROR_CODE.NOT_FOUND,
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        thinkingDetailPayload({
          role: "assistant",
          sessionId: "session-eventual-detail",
          turnScopeId: "client-turn:eventual-detail",
          dialogProcessId: "dp-eventual-detail",
          thinkingContentTimeline: [
            {
              contentId: "message:eventual-interjection",
              contentKind: "user_interjection",
              sourceMessageUid: "eventual-interjection",
              text: "persisted after terminal lifecycle",
              sequence: 1,
            },
          ],
        }),
      );

    await expect(
      loadThinkingDetail({
        sessionId: "session-eventual-detail",
        fetchThinkingDetail: getDetail,
        messageItem: {
          sessionId: "session-eventual-detail",
          turnScopeId: "client-turn:eventual-detail",
          dialogProcessId: "dp-eventual-detail",
        },
      }),
    ).rejects.toMatchObject({ code: API_REQUEST_ERROR_CODE.NOT_FOUND });

    expect(getDetail).toHaveBeenCalledTimes(1);
  });

  it("renders live pending tool details without requesting a persisted page", async () => {
    detailServiceMock.getDetail = vi.fn();
    const messageItem = {
      role: "assistant",
      sessionId: "session-pending-detail",
      turnScopeId: "client-turn:pending-detail",
      dialogProcessId: "dp-pending-detail",
      pending: true,
      toolTimeline: persistedToolTimeline("pending-detail", "call-pending-detail"),
    };
    const wrapper = mountThinkingPanel(messageItem, {
      variant: "details",
      userId: "user-1",
      runtime: { running: true, terminal: false },
    });
    await flushAsync();

    expect(detailServiceMock.getDetail).not.toHaveBeenCalled();
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(1);
    const line = wrapper.get(".execution-log-line");
    expect(line.attributes("data-expandable")).toBe("true");
    await line.trigger("click");
    expect(line.get(".execution-log-detail").text()).toContain("pending-detail.md");
  });

  it("renders drawer tool rows only from the loaded detail page", async () => {
    const toolTimeline = persistedToolTimeline("delayed-detail", "call-delayed-detail");
    const messageItem = {
      role: "assistant",
      sessionId: "session-delayed-detail",
      turnScopeId: "client-turn:delayed-detail",
      dialogProcessId: "dp-delayed-detail",
      hasThinkingDetails: true,
      toolTimeline: compactThinkingTimeline(toolTimeline),
    };
    const { promise, resolve } = Promise.withResolvers();
    detailServiceMock.getDetail = vi.fn(() => promise);
    const wrapper = mountThinkingPanel(messageItem, {
      variant: "details",
      userId: "user-1",
    });
    await flushAsync();

    expect(detailServiceMock.getDetail).toHaveBeenCalledTimes(1);
    expect(wrapper.findAll(".execution-log-line")).toHaveLength(0);

    resolve(thinkingDetailPayload({ ...messageItem, toolTimeline }));
    await flushAsync();
    const line = wrapper.get(".execution-log-line");
    expect(line.attributes("data-expandable")).toBe("true");
    await line.trigger("click");
    expect(line.get(".execution-log-detail").text()).toContain("delayed-detail.md");
  });

  it("loads a summary-only canonical detail in details mode", async () => {
    const getDetail = vi.fn(async () =>
      thinkingDetailPayload({
        role: "assistant",
        sessionId: "session-details",
        turnScopeId: "client-turn:details",
        dialogProcessId: "dp-details",
        toolTimeline: persistedToolTimeline("details-tool", "call-details"),
      }),
    );

    detailServiceMock.getDetail = getDetail;
    const wrapper = mountThinkingPanel(
      {
        role: "assistant",
        sessionId: "session-details",
        turnScopeId: "client-turn:details",
        dialogProcessId: "dp-details",
        hasThinkingDetails: true,
      },
      {
        variant: "details",
        userId: "user-1",
      },
    );
    await flushAsync();

    expect(getDetail).toHaveBeenCalledTimes(1);
    expect(
      wrapper
        .findAll(".execution-log-line")
        .map((item) => [item.text(), item.attributes("data-status-key")]),
    ).toContainEqual(["read_file", "message.executionStatusCompleted"]);
  });

  it("opens a fresh page and explicitly restarts it in details mode", async () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-cached-details",
      turnScopeId: "client-turn:cached-details",
      dialogProcessId: "dp-cached-details",
      hasThinkingDetails: true,
    };
    await loadThinkingDetail({
      sessionId: messageItem.sessionId,
      messageItem,
      fetchThinkingDetail: async () => thinkingDetailPayload(messageItem),
    });
    const getDetail = vi.fn(async () =>
      thinkingDetailPayload({
        ...messageItem,
        toolTimeline: persistedToolTimeline("fresh-details-tool", "call-fresh-details"),
      }),
    );

    detailServiceMock.getDetail = getDetail;
    const wrapper = mountThinkingPanel(messageItem, {
      variant: "details",
      userId: "user-1",
    });
    await flushAsync();

    expect(getDetail).toHaveBeenCalledTimes(1);
    wrapper.findComponent({ name: "ThinkingPanelDetails" }).vm.$emit("restart-pages");
    await flushAsync();
    expect(getDetail).toHaveBeenCalledTimes(2);
    expect(
      wrapper
        .findAll(".execution-log-line")
        .map((item) => [item.text(), item.attributes("data-status-key")]),
    ).toContainEqual(["read_file", "message.executionStatusCompleted"]);
  });

  it("does not fetch canonical details while a message is pending or local logs exist", async () => {
    const getDetail = vi.fn(async () => thinkingDetailPayload({ role: "assistant" }));

    detailServiceMock.getDetail = getDetail;
    mountThinkingPanel(
      {
        role: "assistant",
        sessionId: "session-running",
        turnScopeId: "client-turn:running",
        dialogProcessId: "dp-running",
        pending: true,
        hasThinkingDetails: true,
      },
      {
        userId: "user-1",
        runtime: {
          running: true,
          terminal: false,
          startedAt: "2026-07-21T10:00:00.000Z",
          finishedAt: "",
        },
      },
    );
    await flushAsync();

    mountThinkingPanel(
      {
        role: "assistant",
        sessionId: "session-local",
        turnScopeId: "client-turn:local",
        dialogProcessId: "dp-local",
        hasThinkingDetails: true,
        toolTimeline: persistedToolTimeline("live-tool", "call-live"),
      },
      {
        userId: "user-1",
        runtime: {
          running: false,
          terminal: true,
          startedAt: "2026-07-21T10:00:00.000Z",
          finishedAt: "2026-07-21T10:00:01.000Z",
        },
      },
    );
    await flushAsync();

    expect(getDetail).not.toHaveBeenCalled();
  });

  it("does not infer missing summary detail flags or prefetch a collapsed stale runtime", async () => {
    const getDetail = vi.fn(async () =>
      thinkingDetailPayload({
        role: "assistant",
        sessionId: "session-stale",
        turnScopeId: "client-turn:stale",
        dialogProcessId: "dp-stale",
        toolTimeline: persistedToolTimeline("restored-after-refresh", "call-stale"),
      }),
    );

    detailServiceMock.getDetail = getDetail;
    const wrapper = mountThinkingPanel(
      {
        role: "assistant",
        sessionId: "session-stale",
        turnScopeId: "client-turn:stale",
        dialogProcessId: "dp-stale",
        pending: false,
      },
      {
        userId: "user-1",
        runtime: {
          running: false,
          terminal: true,
          startedAt: "2026-07-21T10:00:00.000Z",
          finishedAt: "2026-07-21T10:00:01.000Z",
        },
      },
    );
    await flushAsync();

    expect(getDetail).not.toHaveBeenCalled();
    expect(wrapper.vm.loadedThinkingDetail).toBeNull();
    expect(wrapper.vm.hasThinking).toBe(true);
    expect(wrapper.findComponent(ThinkingPanelRealtime).exists()).toBe(true);
  });

  it("rotates an unsequenced tool error out of the latest ten execution logs", async () => {
    const toolTimeline = [
      completedToolTimelineItem({
        toolCallId: "failed",
        tool: "read_file",
        args: { filePath: readFilePath("missing") },
        result: toolResultText({ ok: false, error: "missing file", code: "FILE_NOT_FOUND" }),
        success: false,
        resultEvent: { sequence: 2 },
      }),
      ...Array.from({ length: 10 }, (_, index) =>
        completedToolTimelineItem({
          toolCallId: `success-${index + 1}`,
          tool: "read_file",
          args: { filePath: readFilePath(`success-${index + 1}`) },
          result: readFileResult(`success-${index + 1}`),
          success: true,
          resultEvent: { sequence: index + 3 },
        }),
      ),
    ];
    const wrapper = mountThinkingPanel(
      {
        role: "assistant",
        sessionId: "session-window",
        turnScopeId: "client-turn:window",
        toolTimeline,
      },
      {
        runtime: {
          running: true,
          terminal: false,
          startedAt: "2026-07-25T00:00:00.000Z",
          finishedAt: "",
        },
      },
    );

    await nextTick();

    expect(wrapper.vm.currentExecutionLogs).toHaveLength(10);
    expect(
      wrapper.vm.currentExecutionLogs.map((item) => [item.toolCallId, item.statusKey]),
    ).toEqual(
      Array.from({ length: 10 }, (_, index) => [
        `success-${index + 1}`,
        "message.executionStatusCompleted",
      ]),
    );
    expect(wrapper.vm.currentExecutionLogs.some((item) => item.toolCallId === "failed")).toBe(
      false,
    );
  });
});
