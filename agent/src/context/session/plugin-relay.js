/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { tSystem } from "noobot-i18n/agent/system-text";

const GENERIC_PLUGIN_RELAY_PATTERN = /^\[(?:Relay from plugin|Relay from agent plugin|agent-plugin-relay)\/([^\]]+)\]/;

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildLegacyRelayPatterns() {
  return ["zh-CN", "en-US"]
    .map((locale) => tSystem("agent.legacyPluginRelayPrefix", locale, ""))
    .filter(Boolean)
    .map((template) => {
      const escaped = escapeRegExp(template).replace("\\{purpose\\}", "([^\\]]+)");
      return new RegExp(`^${escaped}`);
    });
}

const LEGACY_PLUGIN_RELAY_PATTERNS = buildLegacyRelayPatterns();

export function resolvePluginRelayPurposeFromContent(content = "") {
  const normalizedContent = String(content || "").trim();
  const genericMatch = normalizedContent.match(GENERIC_PLUGIN_RELAY_PATTERN);
  if (genericMatch?.[1]) return String(genericMatch[1] || "").trim();
  for (const pattern of LEGACY_PLUGIN_RELAY_PATTERNS) {
    const legacyMatch = normalizedContent.match(pattern);
    if (legacyMatch?.[1]) return String(legacyMatch[1] || "").trim();
  }
  return "";
}

export function isPluginRelayContent(content = "") {
  return Boolean(resolvePluginRelayPurposeFromContent(content));
}

export function resolvePluginRelayInjectedMessageType(content = "") {
  const purpose = resolvePluginRelayPurposeFromContent(content);
  return purpose ? `plugin_relay:${purpose}` : "";
}
