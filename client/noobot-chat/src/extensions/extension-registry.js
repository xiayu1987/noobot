/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const contributionsByPoint = new Map();
const reportedConflicts = new Set();
import {
  EXTENSION_ARBITRATION,
  EXTENSION_POINT_DEFINITIONS,
  KNOWN_EXTENSION_POINTS,
} from "./extension-point-ids.js";

function normalizeString(value = "") {
  return String(value || "").trim();
}

function warn(message = "") {
  const text = normalizeString(message);
  if (text) console.warn(`[extension-registry] ${text}`);
}

function warnConflict(point, strategy, winner, skipped) {
  const key = `${point}:${strategy}:${winner.id}:${skipped.map(({ id }) => id).join(",")}`;
  if (reportedConflicts.has(key)) return;
  reportedConflicts.add(key);
  warn(`conflict at "${point}" (${strategy}): selected "${winner.id}", skipped ${skipped.map(({ id }) => `"${id}"`).join(", ")}`);
}

function matches(entry, context) {
  try {
    const enabled = typeof entry.enabled === "function" ? entry.enabled(context) : entry.enabled;
    return enabled !== false && entry.when(context) === true;
  } catch (error) {
    warn(`contribution "${entry.id}" predicate failed: ${error?.message || error}`);
    return false;
  }
}

function arbitrate(point, entries) {
  const strategy = EXTENSION_POINT_DEFINITIONS[point]?.strategy || EXTENSION_ARBITRATION.MULTI;
  if (entries.length < 2) return entries;
  if (strategy === EXTENSION_ARBITRATION.FIRST_MATCH || strategy === EXTENSION_ARBITRATION.EXCLUSIVE) {
    warnConflict(point, strategy, entries[0], entries.slice(1));
    return entries.slice(0, 1);
  }
  const winnersByGroup = new Map();
  const resolved = [];
  for (const entry of entries) {
    if (!entry.exclusiveGroup) {
      resolved.push(entry);
      continue;
    }
    const winner = winnersByGroup.get(entry.exclusiveGroup);
    if (!winner) {
      winnersByGroup.set(entry.exclusiveGroup, entry);
      resolved.push(entry);
    } else {
      warnConflict(point, `exclusive:${entry.exclusiveGroup}`, winner, [entry]);
    }
  }
  return resolved;
}

export function contributeExtension(point = "", contribution = {}) {
  const extensionPoint = normalizeString(point);
  const id = normalizeString(contribution?.id);
  const pluginId = normalizeString(contribution?.pluginId);
  if (!extensionPoint) throw new Error("extension point is required");
  if (!KNOWN_EXTENSION_POINTS.has(extensionPoint)) {
    throw new Error(`unknown extension point "${extensionPoint}"`);
  }
  if (!id) throw new Error(`extension contribution id is required for "${extensionPoint}"`);

  const entries = contributionsByPoint.get(extensionPoint) || [];
  if (entries.some((entry) => entry.id === id)) {
    warn(`contribution "${id}" duplicated at "${extensionPoint}", skipped`);
    return false;
  }
  entries.push({
    ...contribution,
    id,
    pluginId,
    point: extensionPoint,
    priority: Number.isFinite(Number(contribution?.priority)) ? Number(contribution.priority) : 100,
    enabled: typeof contribution?.enabled === "function" ? contribution.enabled : contribution?.enabled !== false,
    exclusiveGroup: normalizeString(contribution?.exclusiveGroup),
    when: typeof contribution?.when === "function" ? contribution.when : () => true,
    resolveProps: typeof contribution?.resolveProps === "function" ? contribution.resolveProps : () => ({}),
    resolveListeners: typeof contribution?.resolveListeners === "function" ? contribution.resolveListeners : () => ({}),
  });
  contributionsByPoint.set(extensionPoint, entries);
  return true;
}

export function resolveExtensionPoint(point = "", context = {}) {
  const extensionPoint = normalizeString(point);
  const entries = contributionsByPoint.get(extensionPoint) || [];
  const matchesInOrder = entries
    .filter((entry) => matches(entry, context))
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  return arbitrate(extensionPoint, matchesInOrder);
}

export function resolveExtensionProps(contribution = {}, context = {}) {
  try {
    const value = contribution.resolveProps(context);
    return value && typeof value === "object" ? value : {};
  } catch (error) {
    warn(`contribution "${contribution?.id || "unknown"}" props failed: ${error?.message || error}`);
    return {};
  }
}

export function resolveExtensionListeners(contribution = {}, context = {}) {
  try {
    const value = contribution.resolveListeners(context);
    return value && typeof value === "object" ? value : {};
  } catch (error) {
    warn(`contribution "${contribution?.id || "unknown"}" listeners failed: ${error?.message || error}`);
    return {};
  }
}

export function removePluginExtensions(pluginId = "") {
  const normalized = normalizeString(pluginId);
  if (!normalized) return;
  for (const [point, entries] of contributionsByPoint) {
    const remaining = entries.filter((entry) => entry.pluginId !== normalized);
    if (remaining.length) contributionsByPoint.set(point, remaining);
    else contributionsByPoint.delete(point);
  }
}

export function provideExtensionValues(point = "", context = {}) {
  return resolveExtensionPoint(point, context).flatMap((entry) => {
    if (typeof entry.provide !== "function") return [];
    try {
      const value = entry.provide(context);
      return Array.isArray(value) ? value : [];
    } catch (error) {
      warn(`contribution "${entry.id}" provider failed: ${error?.message || error}`);
      return [];
    }
  });
}

export function clearExtensionRegistry() {
  contributionsByPoint.clear();
  reportedConflicts.clear();
}
