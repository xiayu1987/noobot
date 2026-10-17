/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isFunction } from "@noobot/shared/value";
export function createAuthorityResolutionTracker({ applyTurnLifecycleEnvelope }) {
  const pending = [];

  const track = (result) => {
    if (result && isFunction(result.then)) {
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
    applyTrackedTurnLifecycleEnvelope: (envelope) => track(applyTurnLifecycleEnvelope?.(envelope)),
    async drain() {
      while (pending.length > 0) {
        await Promise.all([...pending]);
      }
    },
  };
}
