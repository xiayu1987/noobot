/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { createSessionAggregateVersionManager } from "../../../../../../src/modules/chat/runtime/engine/sessionAggregateVersionManager.js";

describe("sessionAggregateVersionManager stream protocol", () => {
  it("refreshes and retries the same command identity after an aggregate conflict", async () => {
    const activeSession = ref({ sessionId: "s1", aggregateVersion: 2 });
    const fetchSessionDetail = vi.fn(async () => ({
      sessions: [{ sessionId: "s1", aggregateVersion: 3 }],
    }));
    const applySessionDetail = vi.fn((detail) => {
      activeSession.value = detail.sessions[0];
    });
    const stream = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("session aggregate version conflict"), {
          data: {
            errorCode: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
            currentVersion: 3,
          },
        }),
      )
      .mockResolvedValueOnce(undefined);
    const manager = createSessionAggregateVersionManager({
      activeSession,
      fetchSessionDetail,
      applySessionDetail,
    });

    const result = await manager.runAggregateVersionedStream({
      buildPayload: ({ expectedAggregateVersion }) => ({
        commandId: "continue-1",
        expectedAggregateVersion,
      }),
      stream,
      refreshOptions: { sessionId: "s1" },
    });

    expect(stream.mock.calls.map(([payload]) => payload)).toEqual([
      { commandId: "continue-1", expectedAggregateVersion: 2 },
      { commandId: "continue-1", expectedAggregateVersion: 3 },
    ]);
    expect(fetchSessionDetail).toHaveBeenCalledWith("s1", {
      source: "versionConflict",
      force: true,
      reuseRecentlyLoaded: false,
    });
    expect(result).toMatchObject({ attempt: 2, expectedAggregateVersion: 3 });
  });

  it("does not retry a non-version stream failure", async () => {
    const activeSession = ref({ sessionId: "s1", aggregateVersion: 2 });
    const streamError = Object.assign(new Error("model failed"), {
      data: { errorCode: "MODEL_FAILED" },
    });
    const stream = vi.fn().mockRejectedValue(streamError);
    const manager = createSessionAggregateVersionManager({
      activeSession,
      fetchSessionDetail: vi.fn(),
      applySessionDetail: vi.fn(),
    });

    await expect(
      manager.runAggregateVersionedStream({
        buildPayload: ({ expectedAggregateVersion }) => ({ expectedAggregateVersion }),
        stream,
        refreshOptions: { sessionId: "s1" },
      }),
    ).rejects.toBe(streamError);
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
