/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getCurrentScope, onScopeDispose } from "vue";

import { disposeReconnectReplayTimers } from "./cleanup.js";

export function registerReconnectReplayLifecycleCleanup({
  getCacheExpiredRefreshTimer,
  setCacheExpiredRefreshTimer,
}) {
  if (!getCurrentScope()) {
    return;
  }

  onScopeDispose(() => {
    disposeReconnectReplayTimers({
      getCacheExpiredRefreshTimer,
      setCacheExpiredRefreshTimer,
    });
  });
}
