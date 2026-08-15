/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { ref, toRaw } from "vue";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { createSessionAggregateVersionManager } from "../../../../../../src/modules/chat/runtime/engine/sessionAggregateVersionManager.js";

describe("sessionAggregateVersionManager stream protocol", () => {
  it("applies the conflict version and retries without replacing local presentations", async () => {
    const localMessages = [{ messageId: "local-user", frontendUserMessage: true }];
    const activeSession = ref({
      sessionId: "s1",
      aggregateVersion: 2,
      messages: localMessages,
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
    });

    const result = await manager.runAggregateVersionedStream({
      buildPayload: ({ expectedAggregateVersion }) => ({
        commandId: "continue-1",
        expectedAggregateVersion,
      }),
      stream,
      conflictOptions: { sessionId: "s1" },
    });

    expect(stream.mock.calls.map(([payload]) => payload)).toEqual([
      { commandId: "continue-1", expectedAggregateVersion: 2 },
      { commandId: "continue-1", expectedAggregateVersion: 3 },
    ]);
    expect(toRaw(activeSession.value.messages)).toBe(localMessages);
    expect(activeSession.value.messages).toEqual([
      { messageId: "local-user", frontendUserMessage: true },
    ]);
    expect(result).toMatchObject({ attempt: 2, expectedAggregateVersion: 3 });
  });

  it("does not retry when a version conflict omits the authoritative current version", async () => {
    const activeSession = ref({ sessionId: "s1", aggregateVersion: 2, messages: [] });
    const conflict = Object.assign(new Error("session aggregate version conflict"), {
      data: { errorCode: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT },
    });
    const stream = vi.fn().mockRejectedValue(conflict);
    const manager = createSessionAggregateVersionManager({ activeSession });

    await expect(manager.runAggregateVersionedStream({
      buildPayload: ({ expectedAggregateVersion }) => ({ expectedAggregateVersion }),
      stream,
      conflictOptions: { sessionId: "s1" },
    })).rejects.toBe(conflict);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(activeSession.value.aggregateVersion).toBe(2);
  });

  it("does not retry a non-version stream failure", async () => {
    const activeSession = ref({ sessionId: "s1", aggregateVersion: 2 });
    const streamError = Object.assign(new Error("model failed"), {
      data: { errorCode: "MODEL_FAILED" },
    });
    const stream = vi.fn().mockRejectedValue(streamError);
    const manager = createSessionAggregateVersionManager({
      activeSession,
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
