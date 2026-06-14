/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const PLUGIN_RELAY_PATTERN =
  /^\[(?:Relay from plugin|Relay from agent plugin|来自harness外部模型输出|Relay from harness external model)\/([^\]]+)\]/;

export function resolvePluginRelayPurposeFromContent(content = "") {
  const normalizedContent = String(content || "").trim();
  const match = normalizedContent.match(PLUGIN_RELAY_PATTERN);
  return match?.[1] ? String(match[1] || "").trim() : "";
}

export function isPluginRelayContent(content = "") {
  return Boolean(resolvePluginRelayPurposeFromContent(content));
}

export function resolvePluginRelayInjectedMessageType(content = "") {
  const purpose = resolvePluginRelayPurposeFromContent(content);
  return purpose ? `plugin_relay:${purpose}` : "";
}
