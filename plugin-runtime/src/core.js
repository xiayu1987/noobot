/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createPluginLifecycleRecord,
  PLUGIN_LIFECYCLE_EVENT,
  portsForPluginSurface,
  validatePluginContributionReceipt,
  validatePluginActivationResult,
} from "@noobot/plugin-protocol";

function normalizePath(path = []) {
  const normalized = Array.isArray(path) ? path.map((item) => String(item || "").trim()).filter(Boolean) : [];
  if (!normalized.length) throw new TypeError("plugin capability facade path is required");
  return normalized;
}

function assignFacadePath(target, path, value) {
  let cursor = target;
  for (const segment of path.slice(0, -1)) {
    if (!cursor[segment]) cursor[segment] = {};
    cursor = cursor[segment];
  }
  const leaf = path[path.length - 1];
  if (Object.hasOwn(cursor, leaf)) throw new Error(`duplicate plugin host facade path: ${path.join(".")}`);
  cursor[leaf] = value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export function createPluginHostFacade({ entry = null, capabilityAdapters = {}, publicContext = {} } = {}) {
  if (!entry?.manifest) throw new TypeError("loaded plugin entry is required");
  const facade = { ...(publicContext && typeof publicContext === "object" ? publicContext : {}) };
  for (const port of portsForPluginSurface(entry.manifest, entry.surface)) {
    const descriptor = capabilityAdapters?.[port];
    if (!descriptor || typeof descriptor !== "object") {
      throw new Error(`plugin ${entry.pluginId} requires unavailable host port ${port}`);
    }
    assignFacadePath(facade, normalizePath(descriptor.path), descriptor.value);
  }
  return deepFreeze(facade);
}

export function createContributionTransaction({ commit, rollback = null } = {}) {
  if (typeof commit !== "function") throw new TypeError("contribution transaction commit is required");
  const staged = [];
  let state = "staging";
  return Object.freeze({
    get state() { return state; },
    stage(contribution) {
      if (state !== "staging") throw new Error(`cannot stage contribution while transaction is ${state}`);
      staged.push(contribution);
      return contribution;
    },
    receipt() { return Object.freeze([...staged]); },
    commit() {
      if (state !== "staging") throw new Error(`cannot commit contribution transaction while ${state}`);
      const result = commit(Object.freeze([...staged]));
      state = "committed";
      return result;
    },
    rollback() {
      if (state === "rolled_back") return;
      if (state === "committed" && typeof rollback !== "function") {
        throw new Error("committed contribution transaction has no rollback operation");
      }
      if (typeof rollback === "function") rollback(Object.freeze([...staged]), state);
      state = "rolled_back";
    },
  });
}

function emitLifecycle(lifecycleSink, event, entry, options = {}) {
  const record = createPluginLifecycleRecord({ event, entry, ...options });
  if (typeof lifecycleSink === "function") lifecycleSink(record);
  return record;
}

function ensureSync(value, operation) {
  if (value && typeof value.then === "function") throw new TypeError(`${operation} must be synchronous`);
  return value;
}

function createScopeHandle({ entries, activations, transactions, lifecycleEvents, lifecycleSink, synchronous }) {
  let disposed = false;
  const dispose = synchronous
    ? () => {
        if (disposed) return;
        for (const entry of [...entries].reverse()) {
          const activation = activations.get(entry.pluginId);
          if (!activation) continue;
          emitLifecycle(lifecycleSink, PLUGIN_LIFECYCLE_EVENT.DEACTIVATING, entry);
          const transaction = transactions.get(entry.pluginId);
          transaction?.rollback();
          ensureSync(activation.dispose(), `plugin ${entry.pluginId} dispose`);
          emitLifecycle(lifecycleSink, PLUGIN_LIFECYCLE_EVENT.DEACTIVATED, entry);
        }
        activations.clear();
        disposed = true;
      }
    : async () => {
        if (disposed) return;
        for (const entry of [...entries].reverse()) {
          const activation = activations.get(entry.pluginId);
          if (!activation) continue;
          emitLifecycle(lifecycleSink, PLUGIN_LIFECYCLE_EVENT.DEACTIVATING, entry);
          const transaction = transactions.get(entry.pluginId);
          await transaction?.rollback();
          await activation.dispose();
          emitLifecycle(lifecycleSink, PLUGIN_LIFECYCLE_EVENT.DEACTIVATED, entry);
        }
        activations.clear();
        disposed = true;
      };
  return Object.freeze({
    entries: Object.freeze([...entries]),
    activations,
    lifecycleEvents: Object.freeze(lifecycleEvents),
    get disposed() { return disposed; },
    dispose,
  });
}

function activateScopeSync({ entries = [], hostFactory, configFactory, transactionFactory, lifecycleSink } = {}) {
  const selectedEntries = [...entries];
  const activations = new Map();
  const transactions = new Map();
  const lifecycleEvents = [];
  try {
    for (const entry of selectedEntries) {
      lifecycleEvents.push(emitLifecycle(lifecycleSink, PLUGIN_LIFECYCLE_EVENT.ACTIVATING, entry));
      const transaction = transactionFactory?.(entry) || createContributionTransaction({
        commit: () => undefined,
        rollback: () => undefined,
      });
      transactions.set(entry.pluginId, transaction);
      const result = ensureSync(entry.activate(hostFactory(entry, transaction), configFactory?.(entry) || {}), `plugin ${entry.pluginId} activate`);
      const activation = validatePluginActivationResult(result, { pluginId: entry.pluginId, surface: entry.surface });
      activations.set(entry.pluginId, activation);
      lifecycleEvents.push(emitLifecycle(lifecycleSink, PLUGIN_LIFECYCLE_EVENT.ACTIVATED, entry));
      validatePluginContributionReceipt(entry.manifest, entry.surface, transaction.receipt());
      ensureSync(transaction.commit(), `plugin ${entry.pluginId} contribution commit`);
      lifecycleEvents.push(emitLifecycle(lifecycleSink, PLUGIN_LIFECYCLE_EVENT.CONTRIBUTION_COMMITTED, entry));
    }
  } catch (error) {
    const failedEntry = selectedEntries.find((entry) => transactions.has(entry.pluginId) && !activations.has(entry.pluginId)) || selectedEntries[activations.size];
    if (failedEntry) lifecycleEvents.push(emitLifecycle(lifecycleSink, PLUGIN_LIFECYCLE_EVENT.FAILED, failedEntry, { error }));
    for (const entry of [...selectedEntries].reverse()) {
      if (!transactions.has(entry.pluginId)) continue;
      transactions.get(entry.pluginId).rollback();
      ensureSync(activations.get(entry.pluginId)?.dispose(), `plugin ${entry.pluginId} rollback dispose`);
      lifecycleEvents.push(emitLifecycle(lifecycleSink, PLUGIN_LIFECYCLE_EVENT.ROLLED_BACK, entry));
    }
    throw error;
  }
  return createScopeHandle({ entries: selectedEntries, activations, transactions, lifecycleEvents, lifecycleSink, synchronous: true });
}

export function createPluginActivationScopeSync(options = {}) {
  if (typeof options.hostFactory !== "function") throw new TypeError("plugin hostFactory is required");
  return activateScopeSync(options);
}

export async function createPluginActivationScope(options = {}) {
  if (typeof options.hostFactory !== "function") throw new TypeError("plugin hostFactory is required");
  const entries = [...(options.entries || [])];
  const activations = new Map();
  const transactions = new Map();
  const lifecycleEvents = [];
  try {
    for (const entry of entries) {
      lifecycleEvents.push(emitLifecycle(options.lifecycleSink, PLUGIN_LIFECYCLE_EVENT.ACTIVATING, entry));
      const transaction = options.transactionFactory?.(entry) || createContributionTransaction({
        commit: () => undefined,
        rollback: () => undefined,
      });
      transactions.set(entry.pluginId, transaction);
      const result = await entry.activate(options.hostFactory(entry, transaction), options.configFactory?.(entry) || {});
      const activation = validatePluginActivationResult(result, { pluginId: entry.pluginId, surface: entry.surface });
      activations.set(entry.pluginId, activation);
      lifecycleEvents.push(emitLifecycle(options.lifecycleSink, PLUGIN_LIFECYCLE_EVENT.ACTIVATED, entry));
      validatePluginContributionReceipt(entry.manifest, entry.surface, transaction.receipt());
      await transaction.commit();
      lifecycleEvents.push(emitLifecycle(options.lifecycleSink, PLUGIN_LIFECYCLE_EVENT.CONTRIBUTION_COMMITTED, entry));
    }
  } catch (error) {
    const failedEntry = entries.find((entry) => transactions.has(entry.pluginId) && !activations.has(entry.pluginId)) || entries[activations.size];
    if (failedEntry) lifecycleEvents.push(emitLifecycle(options.lifecycleSink, PLUGIN_LIFECYCLE_EVENT.FAILED, failedEntry, { error }));
    for (const entry of [...entries].reverse()) {
      if (!transactions.has(entry.pluginId)) continue;
      await transactions.get(entry.pluginId).rollback();
      await activations.get(entry.pluginId)?.dispose();
      lifecycleEvents.push(emitLifecycle(options.lifecycleSink, PLUGIN_LIFECYCLE_EVENT.ROLLED_BACK, entry));
    }
    throw error;
  }
  return createScopeHandle({ entries, activations, transactions, lifecycleEvents, lifecycleSink: options.lifecycleSink, synchronous: false });
}
