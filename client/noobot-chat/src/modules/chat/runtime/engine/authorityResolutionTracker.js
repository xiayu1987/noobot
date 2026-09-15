/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * Tracks in-flight authoritative state resolutions so the send flow can await
 * every pending projection before reporting the turn as resolved.
 */
export function createAuthorityResolutionTracker({
  applyRunStateEvent,
  applyTurnLifecycleEnvelope,
}) {
  const pending = [];

  const track = (result) => {
    if (result && typeof result.then === "function") {
      const settled = Promise.resolve(result);
      pending.push(settled);
      void settled.finally(() => {
        const index = pending.indexOf(settled);
        if (index >= 0) pending.splice(index, 1);
      });
    }
    return result;
  };

  return {
    applyTrackedRunStateEvent: (event) => track(applyRunStateEvent?.(event)),
    applyTrackedTurnLifecycleEnvelope: (envelope) => track(applyTurnLifecycleEnvelope?.(envelope)),
    async drain() {
      while (pending.length > 0) {
        await Promise.all([...pending]);
      }
    },
  };
}
