/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { provideExtensionValues } from "../../../extensions/extension-registry.js";
import { EXTENSION_POINTS } from "../../../extensions/extension-point-ids.js";

function compatibilityValues(kind, value) {
  return provideExtensionValues(EXTENSION_POINTS.MESSAGE_LOG_COMPATIBILITY, { kind, value });
}

export function getPluginFlow(logItem = {}) {
  const current = logItem?.pluginFlow ?? logItem?.data?.pluginFlow;
  if (current != null) return current;
  return compatibilityValues("flow", logItem).find((value) => value != null) ?? "";
}

export function isPluginCapabilityResponseEvent(eventName = "") {
  return eventName === "plugin_capability_response" ||
    compatibilityValues("capability-response-event", eventName).some(Boolean);
}

export function stripPluginModelResponsePrefix(value = "") {
  const current = String(value || "").replace(/^Plugin\s+模型返回\s*\/\s*[^\n]+\n?/i, "").trim();
  return compatibilityValues("model-response-text", current).reduce(
    (text, candidate) => typeof candidate === "string" ? candidate : text,
    current,
  );
}
