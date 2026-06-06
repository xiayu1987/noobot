/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const frontendPluginStore = {
  plugins: new Map(),
  messageCards: [],
  messageActions: [],
};

function logRegistryWarning(message = "") {
  const text = normalizeString(message);
  if (!text) return;
  console.warn(`[frontend-plugin-registry] ${text}`);
}

function normalizeString(value = "") {
  return String(value || "").trim();
}

function normalizeCapabilityList(capabilities = []) {
  return Array.from(
    new Set(
      (Array.isArray(capabilities) ? capabilities : [])
        .map((item) => normalizeString(item))
        .filter(Boolean),
    ),
  );
}

function normalizeMessageCardEntry(entry = {}, pluginId = "", pluginCapabilities = []) {
  const id = normalizeString(entry?.id) || `${pluginId}:message-card`;
  const slot = normalizeString(entry?.slot) || "pre";
  return {
    id,
    pluginId,
    slot,
    capability:
      normalizeString(entry?.capability) ||
      pluginCapabilities[0] ||
      "message.card",
    priority: Number.isFinite(Number(entry?.priority))
      ? Number(entry.priority)
      : 100,
    component: entry?.component || null,
    match:
      typeof entry?.match === "function"
        ? entry.match
        : () => false,
    resolveProps:
      typeof entry?.resolveProps === "function"
        ? entry.resolveProps
        : () => ({}),
    resolveListeners:
      typeof entry?.resolveListeners === "function"
        ? entry.resolveListeners
        : () => ({}),
  };
}

function normalizeMessageActionEntry(entry = {}, pluginId = "", pluginCapabilities = []) {
  const id = normalizeString(entry?.id) || `${pluginId}:message-action`;
  return {
    id,
    pluginId,
    capability:
      normalizeString(entry?.capability) ||
      pluginCapabilities[0] ||
      "message.action",
    priority: Number.isFinite(Number(entry?.priority))
      ? Number(entry.priority)
      : 100,
    component: entry?.component || null,
    match:
      typeof entry?.match === "function"
        ? entry.match
        : () => false,
    resolveProps:
      typeof entry?.resolveProps === "function"
        ? entry.resolveProps
        : () => ({}),
  };
}

export function registerFrontendPlugin(definition = {}) {
  const pluginId = normalizeString(definition?.id);
  if (!pluginId) throw new Error("frontend plugin id is required");
  const capabilities = normalizeCapabilityList(definition?.capabilities);
  const messageCards = Array.isArray(definition?.messageCards)
    ? definition.messageCards
    : [];
  const messageActions = Array.isArray(definition?.messageActions)
    ? definition.messageActions
    : [];
  if (frontendPluginStore.plugins.has(pluginId)) {
    logRegistryWarning(`plugin "${pluginId}" already registered, overriding metadata`);
  }
  frontendPluginStore.plugins.set(pluginId, {
    id: pluginId,
    name: normalizeString(definition?.name),
    capabilities,
  });
  for (const item of messageCards) {
    const normalized = normalizeMessageCardEntry(item, pluginId, capabilities);
    if (!normalized.component) continue;
    const duplicatedById = frontendPluginStore.messageCards.some(
      (existing) => existing.id === normalized.id,
    );
    if (duplicatedById) {
      logRegistryWarning(`message card "${normalized.id}" duplicated, skipped`);
      continue;
    }
    const conflict = frontendPluginStore.messageCards.find(
      (existing) =>
        existing.capability === normalized.capability &&
        existing.slot === normalized.slot &&
        existing.priority === normalized.priority,
    );
    if (conflict) {
      logRegistryWarning(
        `message card conflict on capability "${normalized.capability}" slot "${normalized.slot}" priority ${normalized.priority} between "${conflict.id}" and "${normalized.id}"`,
      );
    }
    frontendPluginStore.messageCards.push(normalized);
  }
  for (const item of messageActions) {
    const normalized = normalizeMessageActionEntry(item, pluginId, capabilities);
    if (!normalized.component) continue;
    const duplicatedById = frontendPluginStore.messageActions.some(
      (existing) => existing.id === normalized.id,
    );
    if (duplicatedById) {
      logRegistryWarning(`message action "${normalized.id}" duplicated, skipped`);
      continue;
    }
    const conflict = frontendPluginStore.messageActions.find(
      (existing) =>
        existing.capability === normalized.capability &&
        existing.priority === normalized.priority,
    );
    if (conflict) {
      logRegistryWarning(
        `message action conflict on capability "${normalized.capability}" priority ${normalized.priority} between "${conflict.id}" and "${normalized.id}"`,
      );
    }
    frontendPluginStore.messageActions.push(normalized);
  }
}

export function isFrontendPluginRegistered(pluginId = "") {
  const normalized = normalizeString(pluginId);
  if (!normalized) return false;
  return frontendPluginStore.plugins.has(normalized);
}

export function resolveMessageCardRenderers(messageItem = {}, options = {}) {
  const requestedSlot = normalizeString(options?.slot) || "";
  return frontendPluginStore.messageCards
    .filter((item) => !requestedSlot || item.slot === requestedSlot)
    .filter((item) => {
      try {
        return item.match(messageItem) === true;
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.priority - b.priority);
}

export function resolveMessageCardProps(renderer = {}, context = {}) {
  if (!renderer || typeof renderer !== "object") return {};
  try {
    const props = renderer.resolveProps(context);
    return props && typeof props === "object" ? props : {};
  } catch {
    return {};
  }
}

export function resolveMessageCardListeners(renderer = {}, context = {}) {
  if (!renderer || typeof renderer !== "object") return {};
  try {
    const listeners = renderer.resolveListeners(context);
    return listeners && typeof listeners === "object" ? listeners : {};
  } catch {
    return {};
  }
}

export function resolveMessageActionRenderers(messageItem = {}) {
  return frontendPluginStore.messageActions
    .filter((item) => {
      try {
        return item.match(messageItem) === true;
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.priority - b.priority);
}

export function resolveMessageActionProps(renderer = {}, context = {}) {
  return resolveMessageCardProps(renderer, context);
}
