/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { ref, toRaw } from "vue";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { AGENT_TRANSPORT_EVENT } from "@noobot/agent-transport-protocol";
import { API_REQUEST_ERROR_CODE, ApiRequestError } from "@noobot/shared/request-error";
import { createCommandResultError } from "../../../../../../src/infrastructure/websocket/chatWebSocketProtocol.js";
import {
  applyLatestSessionAggregateVersion,
  createSessionAggregateVersionManager,
  isNewerSessionAggregateVersion,
} from "../../../../../../src/modules/chat/runtime/engine/sessionAggregateVersionManager.js";

function failedReceiptError(error) {
  return createCommandResultError(AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT, {
    commandId: "continue-1",
    outcome: "failed",
    error: { message: "rejected", ...error },
  });
}

describe("sessionAggregateVersionManager stream protocol", () => {
  it("applies the receipt conflict version and retries without replacing local presentations", async () => {
    const localMessages = [{ messageOrigin: "natural", userMetaMaterialized: true }];
    const activeSession = ref({
      sessionId: "s1",
      aggregateVersion: 2,
      messages: localMessages,
    });
    const stream = vi
      .fn()
      .mockRejectedValueOnce(
        failedReceiptError({
          code: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
          currentVersion: 3,
        }),
      )
      .mockResolvedValueOnce(undefined);
    const manager = createSessionAggregateVersionManager({ activeSession });

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
    expect(result).toMatchObject({ attempt: 2, expectedAggregateVersion: 3 });
  });

  it("retries when a lifecycle event advanced the version while the command was in flight", async () => {
    const activeSession = ref({ sessionId: "s1", aggregateVersion: 26 });
    const stream = vi
      .fn()
      .mockImplementationOnce(async () => {
        applyLatestSessionAggregateVersion(activeSession.value, { aggregateVersion: 51 });
        throw failedReceiptError({
          code: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
          currentVersion: 51,
        });
      })
      .mockResolvedValueOnce(undefined);
    const manager = createSessionAggregateVersionManager({ activeSession });
    const result = await manager.runAggregateVersionedStream({
      buildPayload: ({ expectedAggregateVersion }) => ({ expectedAggregateVersion }),
      stream,
      conflictOptions: { sessionId: "s1" },
    });
    expect(stream.mock.calls.map(([payload]) => payload.expectedAggregateVersion)).toEqual([
      26, 51,
    ]);
    expect(result).toMatchObject({ attempt: 2, expectedAggregateVersion: 51 });
  });

  it("does not retry when the receipt conflict version is not newer", async () => {
    const activeSession = ref({ sessionId: "s1", aggregateVersion: 3, messages: [] });
    const conflict = failedReceiptError({
      code: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
      currentVersion: 3,
    });
    const stream = vi.fn().mockRejectedValue(conflict);
    const manager = createSessionAggregateVersionManager({ activeSession });

    await expect(
      manager.runAggregateVersionedStream({
        buildPayload: ({ expectedAggregateVersion }) => ({ expectedAggregateVersion }),
        stream,
        conflictOptions: { sessionId: "s1" },
      }),
    ).rejects.toBe(conflict);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(activeSession.value.aggregateVersion).toBe(3);
  });

  it.each([
    ["non-version receipt failure", () => failedReceiptError({ code: "MODEL_FAILED" })],
    ["transport error without a receipt", () => new Error("socket closed")],
  ])("does not retry a %s", async (_label, createError) => {
    const activeSession = ref({ sessionId: "s1", aggregateVersion: 2 });
    const streamError = createError();
    const stream = vi.fn().mockRejectedValue(streamError);
    const manager = createSessionAggregateVersionManager({ activeSession });

    await expect(
      manager.runAggregateVersionedStream({
        buildPayload: ({ expectedAggregateVersion }) => ({ expectedAggregateVersion }),
        stream,
        conflictOptions: { sessionId: "s1" },
      }),
    ).rejects.toBe(streamError);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("rejects construction and calls without required dependencies", async () => {
    expect(() => createSessionAggregateVersionManager({ activeSession: null })).toThrow(
      /activeSession ref/,
    );
    expect(() => createSessionAggregateVersionManager({ activeSession: {} })).toThrow(
      /activeSession ref/,
    );
    const manager = createSessionAggregateVersionManager({
      activeSession: ref({ sessionId: "s1", aggregateVersion: 2 }),
    });
    await expect(manager.runAggregateVersionedStream({})).rejects.toThrow(/buildPayload, stream/);
  });
});

describe("sessionAggregateVersionManager mutation protocol", () => {
  function versionConflict(currentVersion) {
    return new ApiRequestError("conflict", {
      code: API_REQUEST_ERROR_CODE.HTTP,
      status: 409,
      serverErrorCode: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
      currentVersion,
    });
  }

  it("retries once with the authoritative conflict version when retry is requested", async () => {
    const activeSession = ref({ sessionId: "s1", aggregateVersion: 2 });
    const mutate = vi
      .fn()
      .mockRejectedValueOnce(versionConflict(5))
      .mockResolvedValueOnce({ done: true });
    const manager = createSessionAggregateVersionManager({ activeSession });

    const result = await manager.runAggregateVersionedMutation({
      mutate,
      shouldRetry: true,
      conflictOptions: { sessionId: "s1" },
    });

    expect(mutate.mock.calls.map(([input]) => input)).toEqual([
      { expectedAggregateVersion: 2, attempt: 1 },
      { expectedAggregateVersion: 5, attempt: 2 },
    ]);
    expect(result).toEqual({ payload: { done: true }, expectedAggregateVersion: 5, attempt: 2 });
  });

  it("surfaces a conflict without retrying when retry is disabled", async () => {
    const activeSession = ref({ sessionId: "s1", aggregateVersion: 2 });
    const conflict = versionConflict(5);
    const mutate = vi.fn().mockRejectedValue(conflict);
    const manager = createSessionAggregateVersionManager({ activeSession });

    await expect(
      manager.runAggregateVersionedMutation({
        mutate,
        shouldRetry: false,
        conflictOptions: { sessionId: "s1" },
      }),
    ).rejects.toBe(conflict);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(activeSession.value.aggregateVersion).toBe(2);
  });

  it("requires explicit retry intent, conflict options and an active session", async () => {
    const mutate = vi.fn();
    const manager = createSessionAggregateVersionManager({
      activeSession: ref({ sessionId: "s1", aggregateVersion: 2 }),
    });
    await expect(manager.runAggregateVersionedMutation({})).rejects.toThrow(/mutate/);
    await expect(
      manager.runAggregateVersionedMutation({ mutate, conflictOptions: { sessionId: "s1" } }),
    ).rejects.toThrow(/shouldRetry/);
    await expect(
      manager.runAggregateVersionedMutation({ mutate, shouldRetry: true }),
    ).rejects.toThrow(/conflictOptions/);
    const detached = createSessionAggregateVersionManager({ activeSession: ref(null) });
    await expect(
      detached.runAggregateVersionedMutation({
        mutate,
        shouldRetry: true,
        conflictOptions: { sessionId: "s1" },
      }),
    ).rejects.toThrow(/requires an active session/);
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("session aggregate conflict ownership", () => {
  it.each(["mutation", "stream"])(
    "does not apply an old %s conflict or retry after a session switch",
    async (kind) => {
      const activeSession = ref({ sessionId: "s1", aggregateVersion: 2 });
      const originalSession = activeSession.value;
      const conflict =
        kind === "mutation"
          ? new ApiRequestError("conflict", {
              code: API_REQUEST_ERROR_CODE.HTTP,
              status: 409,
              serverErrorCode: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
              currentVersion: 5,
            })
          : failedReceiptError({
              code: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
              currentVersion: 5,
            });
      let rejectRequest;
      const request = vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            rejectRequest = reject;
          }),
      );
      const manager = createSessionAggregateVersionManager({ activeSession });
      const pending =
        kind === "mutation"
          ? manager.runAggregateVersionedMutation({
              mutate: request,
              shouldRetry: true,
              conflictOptions: { sessionId: "s1" },
            })
          : manager.runAggregateVersionedStream({
              buildPayload: ({ expectedAggregateVersion }) => ({ expectedAggregateVersion }),
              stream: request,
              conflictOptions: { sessionId: "s1" },
            });
      activeSession.value = { sessionId: "s2", aggregateVersion: 1 };
      rejectRequest(conflict);
      await expect(pending).rejects.toBe(conflict);
      expect(request).toHaveBeenCalledTimes(1);
      expect(originalSession.aggregateVersion).toBe(2);
      expect(activeSession.value.aggregateVersion).toBe(1);
    },
  );

  it("rejects mismatched command ownership before sending or publishing a conflict version", async () => {
    const activeSession = ref({ sessionId: "s2", aggregateVersion: 1 });
    const manager = createSessionAggregateVersionManager({ activeSession });
    const mutate = vi.fn();
    await expect(
      manager.runAggregateVersionedMutation({
        mutate,
        shouldRetry: true,
        conflictOptions: { sessionId: "s1" },
      }),
    ).rejects.toMatchObject({ code: SESSION_ERROR_CODE.SCOPE_IDENTITY_CONFLICT });
    expect(mutate).not.toHaveBeenCalled();
    expect(() =>
      manager.applyConflictVersion({
        sessionId: "s1",
        previousVersion: 2,
        conflict: { currentVersion: 5 },
      }),
    ).toThrow(/another session/);
    expect(activeSession.value.aggregateVersion).toBe(1);
  });
});

describe("session aggregate version comparison", () => {
  it("delegates to the protocol's strict integer comparison", () => {
    expect(isNewerSessionAggregateVersion(3, 2)).toBe(true);
    expect(isNewerSessionAggregateVersion(2, 2)).toBe(false);
    expect(isNewerSessionAggregateVersion(1, 2)).toBe(false);
    for (const invalid of [null, undefined, "", "3", -1, 1.5]) {
      expect(() => isNewerSessionAggregateVersion(invalid, 2)).toThrow();
      expect(() => isNewerSessionAggregateVersion(2, invalid)).toThrow();
    }
  });

  it("applies only a strictly newer source version", () => {
    const session = { aggregateVersion: 2 };
    expect(applyLatestSessionAggregateVersion(session, { aggregateVersion: 2 })).toBe(false);
    expect(applyLatestSessionAggregateVersion(session, { aggregateVersion: 4 })).toBe(true);
    expect(session.aggregateVersion).toBe(4);
  });
});
