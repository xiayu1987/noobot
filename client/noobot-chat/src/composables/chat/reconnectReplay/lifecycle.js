/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getCurrentScope, onScopeDispose } from "vue";

import { disposeReconnectReplayTimers } from "./cleanup";

export function registerReconnectReplayLifecycleCleanup({
  missingInteractionPayloadTimers,
  getCacheExpiredRefreshTimer,
  setCacheExpiredRefreshTimer,
}) {
  if (!getCurrentScope()) {
    return;
  }

  onScopeDispose(() => {
    disposeReconnectReplayTimers({
      missingInteractionPayloadTimers,
      getCacheExpiredRefreshTimer,
      setCacheExpiredRefreshTimer,
    });
  });
}
