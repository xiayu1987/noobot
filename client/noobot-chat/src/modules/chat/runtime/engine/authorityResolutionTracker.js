/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createAuthorityResolutionTracker({ applyTurnLifecycleEnvelope }) {
  const pending = [];

  const track = (result) => {
    pending.push(result);
    void result.finally(() => {
      pending.splice(pending.indexOf(result), 1);
    });
    return result;
  };

  return {
    applyTrackedTurnLifecycleEnvelope: (envelope) => track(applyTurnLifecycleEnvelope(envelope)),
    async drain() {
      while (pending.length > 0) {
        await Promise.all([...pending]);
      }
    },
  };
}
