/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { frontendConfig } from "../../shared/config/frontendConfig";

export function useReconnect({
  connected,
  hasActiveSession,
  handleReconnect,
} = {}) {
  const reconnectPromise = ref(null);
  const lastReconnectAttemptAt = ref(0);
  const cooldownMs = frontendConfig.reconnect.signalCooldownMs;

  async function reconnectActiveSession({ force = false } = {}) {
    if (!connected?.value) return;
    if (!hasActiveSession?.()) return;
    if (reconnectPromise.value) return;
    const now = Date.now();
    if (!force && now - lastReconnectAttemptAt.value < cooldownMs) return;
    lastReconnectAttemptAt.value = now;
    reconnectPromise.value = handleReconnect?.();
    try {
      await reconnectPromise.value;
    } finally {
      reconnectPromise.value = null;
    }
  }

  function handleBrowserReconnectSignal() {
    if (document.visibilityState && document.visibilityState !== "visible") return;
    reconnectActiveSession();
  }

  function setupListeners() {
    if (frontendConfig.reconnect.listenOnline) {
      window.addEventListener("online", handleBrowserReconnectSignal);
    }
    if (frontendConfig.reconnect.listenWindowFocus) {
      window.addEventListener("focus", handleBrowserReconnectSignal);
    }
    if (frontendConfig.reconnect.listenVisibilityChange) {
      document.addEventListener("visibilitychange", handleBrowserReconnectSignal);
    }
  }

  function removeListeners() {
    if (frontendConfig.reconnect.listenOnline) {
      window.removeEventListener("online", handleBrowserReconnectSignal);
    }
    if (frontendConfig.reconnect.listenWindowFocus) {
      window.removeEventListener("focus", handleBrowserReconnectSignal);
    }
    if (frontendConfig.reconnect.listenVisibilityChange) {
      document.removeEventListener("visibilitychange", handleBrowserReconnectSignal);
    }
  }

  onMounted(() => {
    setupListeners();
  });

  onBeforeUnmount(() => {
    removeListeners();
  });

  // Auto-reconnect when connection is (re-)established
  watch(
    () => connected?.value,
    (nextConnected, previousConnected) => {
      if (!nextConnected || previousConnected) return;
      reconnectActiveSession({ force: true });
    },
  );

  return {
    reconnectActiveSession,
    handleBrowserReconnectSignal,
  };
}
