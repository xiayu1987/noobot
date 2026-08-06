/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mountThinkingPanel } from "./ThinkingPanel.test-helpers.js";
import {
  __resetThinkingDetailCacheForTests,
  getCachedThinkingDetail,
  loadThinkingDetail,
  resolveThinkingDetailIdentity,
} from "../../../../../../src/modules/chat/model/thinkingDetailCache.js";
import { normalizeThinkingToolLogs } from "../../../../../../src/modules/chat/model/thinkingDetailModel.js";
import ThinkingPanelRealtime from "../../../../../../src/modules/chat/components/thinking/ThinkingPanelRealtime.vue";
import { setTurnThinkingOpenNames } from "../../../../../../src/modules/chat/runtime/engine/turnUiStore.js";

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
    allMessages: [messageItem],
    sessionDocs: [],
  };
}

function persistedToolTimeline(text, id = "call-1") {
  return [{
    key: `call:${id}`, toolCallId: id, tool: text, result: text, status: "completed",
    resultEvent: {
      eventId: `result:${id}`, sequence: 1, sequenceScopeId: "message-1",
      sequenceDomain: "message-event", authority: "authoritative",
    },
  }];
}

describe("ThinkingPanel thinking-detail recovery", () => {
  afterEach(() => {
    __resetThinkingDetailCacheForTests();
    vi.restoreAllMocks();
  });

  it("loads summary-only thinking details on expansion and reuses the cache across message replacement", async () => {
    const getDetail = vi.fn(async (params) => {
      expect(params).toEqual({
        userId: "user-1",
        sessionId: "session-restore",
        turnScopeId: "client-turn:restore",
        dialogProcessId: "",
      });
      return thinkingDetailPayload({
        role: "assistant",
        sessionId: "session-restore",
        turnScopeId: "client-turn:restore",
        toolTimeline: persistedToolTimeline("persisted-tool"),
      });
    });

    const wrapper = mountThinkingPanel({
      role: "assistant",
      sessionId: "session-restore",
      turnScopeId: "client-turn:restore",
      hasThinkingDetails: true,
      thinkingDetailCount: 1,
    }, {
      userId: "user-1",
      thinkingDetailService: { getDetail },
      runtime: { running: false, terminal: true, startedAt: "2026-07-21T10:00:00.000Z", finishedAt: "2026-07-21T10:00:01.000Z" },
    });

    await flushAsync();
    expect(getDetail).not.toHaveBeenCalled();
    setTurnThinkingOpenNames(wrapper.props("messageItem"), ["thinking-panel"]);
    await flushAsync();
    expect(getDetail).toHaveBeenCalledTimes(1);
    const identity = resolveThinkingDetailIdentity({
      role: "assistant",
      sessionId: "session-restore",
      turnScopeId: "client-turn:restore",
    }, "session-restore");
    const cached = getCachedThinkingDetail(identity);
    expect(cached).toBeTruthy();
    expect(cached?.messageItem?.toolTimeline).toHaveLength(1);
    expect(normalizeThinkingToolLogs({
      messageItem: cached.messageItem,
      allMessages: cached.allMessages,
      sessionDocs: cached.sessionDocs,
      variant: "panel",
      toolResultFallback: "tool_result",
    }).map((item) => item.text || item.detailText)).toContain("persisted-tool");
    expect(cached.messageItem.toolTimeline).toHaveLength(1);

    await wrapper.setProps({
      messageItem: {
        role: "assistant",
        sessionId: "session-restore",
        turnScopeId: "client-turn:restore",
        hasThinkingDetails: true,
        thinkingDetailCount: 1,
      },
    });
    await flushAsync();

    expect(getDetail).toHaveBeenCalledTimes(1);
    expect(getCachedThinkingDetail(identity)?.messageItem?.toolTimeline).toHaveLength(1);
  });

  it("loads a summary-only canonical detail in details mode", async () => {
    const getDetail = vi.fn(async () => thinkingDetailPayload({
      role: "assistant",
      sessionId: "session-details",
      turnScopeId: "client-turn:details",
      toolTimeline: persistedToolTimeline("details-tool", "call-details"),
    }));

    const wrapper = mountThinkingPanel({
      role: "assistant",
      sessionId: "session-details",
      turnScopeId: "client-turn:details",
      hasThinkingDetails: true,
      thinkingDetailCount: 1,
    }, {
      variant: "details",
      userId: "user-1",
      thinkingDetailService: { getDetail },
    });
    await flushAsync();

    expect(getDetail).toHaveBeenCalledTimes(1);
    expect(wrapper.findAll(".execution-log-line").map((item) => item.text()))
      .toContain("返回：details-tool · 已完成");
  });

  it("refreshes an empty cached detail in details mode", async () => {
    const messageItem = {
      role: "assistant",
      sessionId: "session-cached-details",
      turnScopeId: "client-turn:cached-details",
      hasThinkingDetails: true,
      thinkingDetailCount: 1,
    };
    await loadThinkingDetail({
      sessionId: messageItem.sessionId,
      messageItem,
      fetchThinkingDetail: async () => thinkingDetailPayload(messageItem),
    });
    const getDetail = vi.fn(async () => thinkingDetailPayload({
      ...messageItem,
      toolTimeline: persistedToolTimeline("fresh-details-tool", "call-fresh-details"),
    }));

    const wrapper = mountThinkingPanel(messageItem, {
      variant: "details",
      userId: "user-1",
      thinkingDetailService: { getDetail },
    });
    await flushAsync();

    expect(getDetail).toHaveBeenCalledTimes(1);
    expect(wrapper.findAll(".execution-log-line").map((item) => item.text()))
      .toContain("返回：fresh-details-tool · 已完成");
  });

  it("does not fetch canonical details while a message is pending or local logs exist", async () => {
    const getDetail = vi.fn(async () => thinkingDetailPayload({ role: "assistant" }));

    mountThinkingPanel({
      role: "assistant",
      sessionId: "session-running",
      turnScopeId: "client-turn:running",
      pending: true,
      hasThinkingDetails: true,
      thinkingDetailCount: 1,
    }, {
      userId: "user-1",
      thinkingDetailService: { getDetail },
      runtime: { running: true, terminal: false, startedAt: "2026-07-21T10:00:00.000Z", finishedAt: "" },
    });
    await flushAsync();

    mountThinkingPanel({
      role: "assistant",
      sessionId: "session-local",
      turnScopeId: "client-turn:local",
      hasThinkingDetails: true,
      thinkingDetailCount: 1,
      toolTimeline: persistedToolTimeline("live-tool", "call-live"),
    }, {
      userId: "user-1",
      thinkingDetailService: { getDetail },
      runtime: { running: false, terminal: true, startedAt: "2026-07-21T10:00:00.000Z", finishedAt: "2026-07-21T10:00:01.000Z" },
    });
    await flushAsync();

    expect(getDetail).not.toHaveBeenCalled();
  });

  it("does not infer missing summary detail flags or prefetch a collapsed stale runtime", async () => {
    const getDetail = vi.fn(async () => thinkingDetailPayload({
      role: "assistant",
      sessionId: "session-stale",
      turnScopeId: "client-turn:stale",
      toolTimeline: persistedToolTimeline("restored-after-refresh", "call-stale"),
    }));

    const wrapper = mountThinkingPanel({
      role: "assistant",
      sessionId: "session-stale",
      turnScopeId: "client-turn:stale",
      pending: false,
    }, {
      userId: "user-1",
      thinkingDetailService: { getDetail },
      runtime: { running: false, terminal: true, startedAt: "2026-07-21T10:00:00.000Z", finishedAt: "2026-07-21T10:00:01.000Z" },
    });
    await flushAsync();

    expect(getDetail).not.toHaveBeenCalled();
    expect(wrapper.vm.loadedThinkingDetail).toBeNull();
    expect(wrapper.vm.hasThinking).toBe(false);
    expect(wrapper.findComponent(ThinkingPanelRealtime).exists()).toBe(false);
  });

  it("rotates an unsequenced tool error out of the latest ten execution logs", async () => {
    const toolTimeline = [
      {
        key: "call:failed",
        toolCallId: "failed",
        tool: "missing-file",
        result: "missing file",
        resultEvent: {
          sequence: 2,
        },
      },
      ...Array.from({ length: 10 }, (_, index) => ({
        key: `call:success-${index + 1}`,
        toolCallId: `success-${index + 1}`,
        tool: `success-${index + 1}`,
        result: `success-${index + 1}`,
        resultEvent: {
          sequence: index + 3,
        },
      })),
    ];
    const wrapper = mountThinkingPanel({
      role: "assistant",
      sessionId: "session-window",
      turnScopeId: "client-turn:window",
      toolTimeline,
    }, {
      runtime: { running: true, terminal: false, startedAt: "2026-07-25T00:00:00.000Z", finishedAt: "" },
    });

    await nextTick();

    expect(wrapper.vm.currentExecutionLogs).toHaveLength(10);
    expect(wrapper.vm.currentExecutionLogs.map((item) => item.text)).toEqual(
      Array.from({ length: 10 }, (_, index) => `返回：success-${index + 1} · 已完成`),
    );
    expect(wrapper.vm.currentExecutionLogs.some((item) => item.text.includes("missing file"))).toBe(false);
  });
});
