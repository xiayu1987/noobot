/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useReconnect } from "../../../../../../src/modules/chat/composables/connectivity/useReconnect.js";
import { mountComposable } from "../../../../fixtures/mountComposable.js";

describe("useReconnect", () => {
  it("deduplicates reconnect calls while promise is pending", async () => {
    const connected = ref(true);
    const hasActiveSession = vi.fn(() => true);
    let resolveReconnect;
    const handleReconnect = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveReconnect = resolve;
        }),
    );

    const { result, unmount } = mountComposable(() =>
      useReconnect({
        connected,
        hasActiveSession,
        handleReconnect,
      }),
    );
    const { reconnectActiveSession } = result;

    const p1 = reconnectActiveSession();
    const p2 = reconnectActiveSession();
    expect(handleReconnect).toHaveBeenCalledTimes(1);
    let secondCallSettled = false;
    void p2.then(() => {
      secondCallSettled = true;
    });
    await Promise.resolve();
    expect(secondCallSettled).toBe(false);
    resolveReconnect();
    await Promise.all([p1, p2]);
    unmount();
  });

  it("force=true bypasses cooldown and reconnects again", async () => {
    const connected = ref(true);
    const hasActiveSession = vi.fn(() => true);
    const handleReconnect = vi.fn(async () => {});

    const { result, unmount } = mountComposable(() =>
      useReconnect({
        connected,
        hasActiveSession,
        handleReconnect,
      }),
    );
    const { reconnectActiveSession } = result;

    await reconnectActiveSession();
    await reconnectActiveSession();
    await reconnectActiveSession({ force: true });

    expect(handleReconnect).toHaveBeenCalledTimes(2);
    unmount();
  });
});
