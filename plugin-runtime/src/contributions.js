/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { EXTENSION_ARBITRATION } from "@noobot/plugin-protocol/frontend";

function normalizeString(value = "") { return String(value || "").trim(); }
const REGISTRY_SNAPSHOT = Symbol("plugin-runtime.extension-registry-snapshot");

function cloneRegistryState(source = new Map()) {
  return new Map([...source].map(([point, entries]) => [point, [...entries]]));
}

export function createExtensionRegistry({ pointDefinitions = {}, onWarning = null, initialState = null } = {}) {
  let contributionsByPoint = cloneRegistryState(initialState || new Map());
  const reportedConflicts = new Set();
  const knownPoints = new Set(Object.keys(pointDefinitions));
  const warn = (message) => {
    const text = normalizeString(message);
    if (text && typeof onWarning === "function") onWarning(text);
  };
  const createEntry = ({ contribution = {}, id, pluginId, point }) => ({
    ...contribution,
    id,
    pluginId,
    point,
    priority: Number.isFinite(Number(contribution?.priority)) ? Number(contribution.priority) : 100,
    enabled: typeof contribution?.enabled === "function" ? contribution.enabled : contribution?.enabled !== false,
    exclusiveGroup: normalizeString(contribution?.exclusiveGroup),
    when: typeof contribution?.when === "function" ? contribution.when : () => true,
    resolveProps: typeof contribution?.resolveProps === "function" ? contribution.resolveProps : () => ({}),
    resolveListeners: typeof contribution?.resolveListeners === "function" ? contribution.resolveListeners : () => ({}),
  });
  const list = (point = "") => {
    const normalized = normalizeString(point);
    const entries = normalized ? contributionsByPoint.get(normalized) || [] : [...contributionsByPoint.values()].flat();
    return entries.map((entry) => ({
      id: entry.id,
      pluginId: entry.pluginId,
      point: entry.point,
      priority: entry.priority,
      enabled: entry.enabled !== false,
      hasProvider: typeof entry.provide === "function",
    }));
  };
  const replacePlugin = (pluginId = "", contributions = []) => {
    const normalizedPluginId = normalizeString(pluginId);
    if (!normalizedPluginId) throw new Error("plugin id is required");
    const staged = Array.isArray(contributions) ? contributions : [];
    const seen = new Set();
    for (const item of staged) {
      const point = normalizeString(item?.point);
      const id = normalizeString(item?.contribution?.id);
      if (!knownPoints.has(point)) throw new Error(`unknown extension point "${point}"`);
      if (!id) throw new Error(`extension contribution id is required for "${point}"`);
      const key = `${point}:${id}`;
      if (seen.has(key)) throw new Error(`extension contribution "${id}" duplicated at "${point}"`);
      seen.add(key);
    }
    const next = new Map();
    for (const [point, entries] of contributionsByPoint) {
      const retained = entries.filter((entry) => entry.pluginId !== normalizedPluginId);
      if (retained.length) next.set(point, retained);
    }
    for (const item of staged) {
      const point = normalizeString(item.point);
      const contribution = item.contribution || {};
      const entries = next.get(point) || [];
      const id = normalizeString(contribution.id);
      if (entries.some((entry) => entry.id === id)) throw new Error(`extension contribution "${id}" duplicated at "${point}"`);
      entries.push(createEntry({ contribution, id, pluginId: normalizedPluginId, point }));
      next.set(point, entries);
    }
    contributionsByPoint = next;
    return list().filter((entry) => entry.pluginId === normalizedPluginId);
  };
  const removePlugin = (pluginId = "") => {
    const normalized = normalizeString(pluginId);
    if (!normalized) return;
    for (const [point, entries] of contributionsByPoint) {
      const remaining = entries.filter((entry) => entry.pluginId !== normalized);
      if (remaining.length) contributionsByPoint.set(point, remaining);
      else contributionsByPoint.delete(point);
    }
  };
  const contribute = (point = "", contribution = {}) => {
    const normalizedPoint = normalizeString(point);
    const id = normalizeString(contribution?.id);
    const pluginId = normalizeString(contribution?.pluginId);
    if (!knownPoints.has(normalizedPoint)) throw new Error(`unknown extension point "${normalizedPoint}"`);
    const existing = contributionsByPoint.get(normalizedPoint) || [];
    if (!id) throw new Error(`extension contribution id is required for "${normalizedPoint}"`);
    if (existing.some((entry) => entry.id === id)) {
      warn(`contribution "${id}" duplicated at "${normalizedPoint}", skipped`);
      return false;
    }
    existing.push(createEntry({ contribution, id, pluginId, point: normalizedPoint }));
    contributionsByPoint.set(normalizedPoint, existing);
    return true;
  };
  const resolve = (point = "", context = {}) => {
    const normalizedPoint = normalizeString(point);
    const matches = (contributionsByPoint.get(normalizedPoint) || []).filter((entry) => {
      try {
        const enabled = typeof entry.enabled === "function" ? entry.enabled(context) : entry.enabled;
        return enabled !== false && entry.when(context) === true;
      } catch (error) {
        warn(`contribution "${entry.id}" predicate failed: ${error?.message || error}`);
        return false;
      }
    }).sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
    const strategy = pointDefinitions[normalizedPoint]?.strategy || EXTENSION_ARBITRATION.MULTI;
    if (matches.length < 2) return matches;
    if (strategy === EXTENSION_ARBITRATION.FIRST_MATCH || strategy === EXTENSION_ARBITRATION.EXCLUSIVE) {
      const key = `${normalizedPoint}:${strategy}:${matches.map(({ id }) => id).join(",")}`;
      if (!reportedConflicts.has(key)) {
        reportedConflicts.add(key);
        warn(`conflict at "${normalizedPoint}" (${strategy}): selected "${matches[0].id}"`);
      }
      return matches.slice(0, 1);
    }
    const groups = new Set();
    return matches.filter((entry) => {
      if (!entry.exclusiveGroup) return true;
      if (groups.has(entry.exclusiveGroup)) {
        const key = `${normalizedPoint}:exclusive:${entry.exclusiveGroup}`;
        if (!reportedConflicts.has(key)) {
          reportedConflicts.add(key);
          warn(`conflict at "${normalizedPoint}" (exclusive:${entry.exclusiveGroup}): skipped "${entry.id}"`);
        }
        return false;
      }
      groups.add(entry.exclusiveGroup);
      return true;
    });
  };
  const registry = {
    contribute,
    list,
    replacePlugin,
    removePlugin,
    resolve,
    resolveProps(contribution = {}, context = {}) {
      try { const value = contribution.resolveProps(context); return value && typeof value === "object" ? value : {}; }
      catch (error) { warn(`contribution "${contribution?.id || "unknown"}" props failed: ${error?.message || error}`); return {}; }
    },
    resolveListeners(contribution = {}, context = {}) {
      try { const value = contribution.resolveListeners(context); return value && typeof value === "object" ? value : {}; }
      catch (error) { warn(`contribution "${contribution?.id || "unknown"}" listeners failed: ${error?.message || error}`); return {}; }
    },
    provide(entries = [], context = {}) {
      return (Array.isArray(entries) ? entries : []).flatMap((entry) => {
        if (typeof entry.provide !== "function") return [];
        try { const value = entry.provide(context); return Array.isArray(value) ? value : []; }
        catch (error) { warn(`contribution "${entry.id}" provider failed: ${error?.message || error}`); return []; }
      });
    },
    clear() { contributionsByPoint = new Map(); reportedConflicts.clear(); },
    createGeneration() {
      return createExtensionRegistry({
        pointDefinitions,
        onWarning,
        initialState: contributionsByPoint,
      });
    },
    publish(generation) {
      if (!generation || typeof generation[REGISTRY_SNAPSHOT] !== "function") {
        throw new TypeError("extension registry generation is required");
      }
      contributionsByPoint = generation[REGISTRY_SNAPSHOT]();
      reportedConflicts.clear();
      return list();
    },
    [REGISTRY_SNAPSHOT]() { return cloneRegistryState(contributionsByPoint); },
  };
  return Object.freeze(registry);
}
