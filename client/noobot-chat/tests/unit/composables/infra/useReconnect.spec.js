/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { effectScope, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useReconnect } from "../../../../src/composables/infra/useReconnect";

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

    let reconnectActiveSession;
    const scope = effectScope();
    scope.run(() => {
      ({ reconnectActiveSession } = useReconnect({
        connected,
        hasActiveSession,
        handleReconnect,
      }));
    });

    const p1 = reconnectActiveSession();
    const p2 = reconnectActiveSession();
    expect(handleReconnect).toHaveBeenCalledTimes(1);
    resolveReconnect();
    await Promise.all([p1, p2]);
    scope.stop();
  });

  it("force=true bypasses cooldown and reconnects again", async () => {
    const connected = ref(true);
    const hasActiveSession = vi.fn(() => true);
    const handleReconnect = vi.fn(async () => {});

    let reconnectActiveSession;
    const scope = effectScope();
    scope.run(() => {
      ({ reconnectActiveSession } = useReconnect({
        connected,
        hasActiveSession,
        handleReconnect,
      }));
    });

    await reconnectActiveSession();
    await reconnectActiveSession();
    await reconnectActiveSession({ force: true });

    expect(handleReconnect).toHaveBeenCalledTimes(2);
    scope.stop();
  });
});
