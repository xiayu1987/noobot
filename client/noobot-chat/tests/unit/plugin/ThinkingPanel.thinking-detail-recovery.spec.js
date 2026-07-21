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
  resolveThinkingDetailIdentity,
} from "../../../src/shared/message/thinkingDetailCache";
import { normalizeThinkingToolLogs } from "../../../src/composables/infra/thinkingDetailModel";
import ThinkingPanelRealtime from "../../../src/shared/message/ThinkingPanelRealtime.vue";

async function flushAsync() {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  };
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

describe("ThinkingPanel thinking-detail recovery", () => {
  afterEach(() => {
    __resetThinkingDetailCacheForTests();
    vi.restoreAllMocks();
  });

  it("loads summary-only thinking details by turnScopeId and reuses the cache across message replacement", async () => {
    const authFetch = vi.fn(async (url) => {
      expect(String(url)).toContain("turnScopeId=client-turn%3Arestore");
      expect(String(url)).not.toContain("dialogProcessId=");
      return jsonResponse(thinkingDetailPayload({
        role: "assistant",
        sessionId: "session-restore",
        turnScopeId: "client-turn:restore",
        completedToolLogs: [
          { event: "tool_result", type: "tool_result", toolCallId: "call-1", text: "persisted-tool" },
        ],
      }));
    });

    const wrapper = mountThinkingPanel({
      role: "assistant",
      sessionId: "session-restore",
      turnScopeId: "client-turn:restore",
      hasThinkingDetails: true,
      thinkingDetailCount: 1,
    }, {
      userId: "user-1",
      authFetch,
      runtime: { running: false, terminal: true, startedAt: "2026-07-21T10:00:00.000Z", finishedAt: "2026-07-21T10:00:01.000Z" },
    });

    await flushAsync();
    expect(authFetch).toHaveBeenCalledTimes(1);
    const identity = resolveThinkingDetailIdentity({
      role: "assistant",
      sessionId: "session-restore",
      turnScopeId: "client-turn:restore",
    }, "session-restore");
    const cached = getCachedThinkingDetail(identity);
    expect(cached).toBeTruthy();
    expect(cached?.messageItem?.completedToolLogs?.[0]?.text).toBe("persisted-tool");
    expect(normalizeThinkingToolLogs({
      messageItem: cached.messageItem,
      allMessages: cached.allMessages,
      sessionDocs: cached.sessionDocs,
      variant: "panel",
      toolResultFallback: "tool_result",
    }).map((item) => item.text || item.detailText)).toContain("persisted-tool");
    expect(cached.messageItem.completedToolLogs).toHaveLength(1);

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

    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(getCachedThinkingDetail(identity)?.messageItem?.completedToolLogs?.[0]?.text)
      .toBe("persisted-tool");
  });

  it("does not fetch canonical details while a message is pending or local logs exist", async () => {
    const authFetch = vi.fn(async () => jsonResponse(thinkingDetailPayload({ role: "assistant" })));

    mountThinkingPanel({
      role: "assistant",
      sessionId: "session-running",
      turnScopeId: "client-turn:running",
      pending: true,
      hasThinkingDetails: true,
      thinkingDetailCount: 1,
    }, {
      userId: "user-1",
      authFetch,
      runtime: { running: true, terminal: false, startedAt: "2026-07-21T10:00:00.000Z", finishedAt: "" },
    });
    await flushAsync();

    mountThinkingPanel({
      role: "assistant",
      sessionId: "session-local",
      turnScopeId: "client-turn:local",
      hasThinkingDetails: true,
      thinkingDetailCount: 1,
      realtimeLogs: [{ event: "tool_result", type: "tool_result", text: "live-tool" }],
    }, {
      userId: "user-1",
      authFetch,
      runtime: { running: false, terminal: true, startedAt: "2026-07-21T10:00:00.000Z", finishedAt: "2026-07-21T10:00:01.000Z" },
    });
    await flushAsync();

    expect(authFetch).not.toHaveBeenCalled();
  });

  it("recovers scoped details when refresh omitted summary flags and runtime is stale", async () => {
    const authFetch = vi.fn(async () => jsonResponse(thinkingDetailPayload({
      role: "assistant",
      sessionId: "session-stale",
      turnScopeId: "client-turn:stale",
      completedToolLogs: [
        { event: "tool_result", type: "tool_result", toolCallId: "call-stale", text: "restored-after-refresh" },
      ],
    })));

    const wrapper = mountThinkingPanel({
      role: "assistant",
      sessionId: "session-stale",
      turnScopeId: "client-turn:stale",
      pending: false,
    }, {
      userId: "user-1",
      authFetch,
      runtime: { running: false, terminal: true, startedAt: "2026-07-21T10:00:00.000Z", finishedAt: "2026-07-21T10:00:01.000Z" },
    });
    await flushAsync();

    expect(authFetch).toHaveBeenCalledTimes(1);
    const staleIdentity = resolveThinkingDetailIdentity({
      role: "assistant",
      sessionId: "session-stale",
      turnScopeId: "client-turn:stale",
    }, "session-stale");
    const staleCached = getCachedThinkingDetail(staleIdentity);
    expect(staleCached?.messageItem?.completedToolLogs).toHaveLength(1);
    expect(normalizeThinkingToolLogs({
      messageItem: staleCached.messageItem,
      allMessages: staleCached.allMessages,
      sessionDocs: staleCached.sessionDocs,
      variant: "panel",
    })).toHaveLength(1);
    expect(wrapper.vm.currentExecutionLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "restored-after-refresh" }),
    ]));
    expect(wrapper.vm.loadedThinkingDetail?.messageItem?.completedToolLogs).toHaveLength(1);
    expect(wrapper.vm.hasThinking).toBe(true);
    // Accessing the lazy computed above observes the settled detail; flush the
    // component update it schedules before asserting the rendered projection.
    await nextTick();
    // Keep this assertion diagnostic local: if mounting fails, report the
    // actual rendered branch rather than inferring it from component lookup.
    expect(wrapper.findComponent(ThinkingPanelRealtime).exists()).toBe(true);
    expect(wrapper.html()).toContain("thinking-realtime-shell");
    expect(wrapper.findAllComponents(ThinkingPanelRealtime)).toHaveLength(1);
    expect(wrapper.findComponent(ThinkingPanelRealtime).props("executionLogs"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ text: "restored-after-refresh" }),
      ]));
    expect(wrapper.findAll(".execution-log-line").map((item) => item.text())).toContain("restored-after-refresh");
  });
});
