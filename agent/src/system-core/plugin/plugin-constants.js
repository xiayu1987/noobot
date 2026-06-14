/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const PLUGIN_SLOT_KEY = Object.freeze({
  AGENT: "agentPlugin",
  BOT: "botPlugin",
});

export const PLUGIN_RUNTIME_PROPERTY = Object.freeze({
  AGENT_PLUGIN_KEY: "agentPluginKey",
  BOT_PLUGIN_KEY: "botPluginKey",
  AGENT_PLUGIN_SELECTORS: "agentPluginSelectors",
  BOT_PLUGIN_SELECTORS: "botPluginSelectors",
});

export const PLUGIN_REGISTRATION_FLAG = Object.freeze({
  AGENT: "__noobotAgentPluginRegistered",
  BOT: "__noobotBotPluginRegistered",
});

export function createPluginSelectorSet(...keys) {
  return new Set(keys.map((item) => String(item || "").trim()).filter(Boolean));
}
