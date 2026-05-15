/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function envBoolean(name, defaultValue = false) {
  const value = String(import.meta.env?.[name] ?? "").trim().toLowerCase();
  if (!value) return Boolean(defaultValue);
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return Boolean(defaultValue);
}

function envNumber(name, defaultValue, min = 0) {
  const value = Number(import.meta.env?.[name] ?? defaultValue);
  if (!Number.isFinite(value)) return Math.max(min, Number(defaultValue || 0));
  return Math.max(min, value);
}

export const frontendConfig = Object.freeze({
  reconnect: Object.freeze({
    listenOnline: envBoolean("VITE_NOOBOT_RECONNECT_ON_ONLINE", true),
    listenVisibilityChange: envBoolean("VITE_NOOBOT_RECONNECT_ON_VISIBILITY", false),
    listenWindowFocus: envBoolean("VITE_NOOBOT_RECONNECT_ON_FOCUS", false),
    signalCooldownMs: envNumber("VITE_NOOBOT_RECONNECT_SIGNAL_COOLDOWN_MS", 2000, 0),
  }),
  debug: Object.freeze({
    showConversationStatePanel: envBoolean(
      "VITE_NOOBOT_DEBUG_CONVERSATION_STATE_PANEL",
      Boolean(import.meta.env?.DEV),
    ),
  }),
});
