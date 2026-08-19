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
  const normalized = Array.isArray(path)
    ? path.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!normalized.length) throw new TypeError("plugin capability facade path is required");
  return normalized;
}

function assignFacadePath(target, path, value, ownedContainers) {
  let cursor = target;
  for (const segment of path.slice(0, -1)) {
    const existing = Object.hasOwn(cursor, segment) ? cursor[segment] : undefined;
    if (!existing) {
      const container = Object.create(null);
      Object.defineProperty(cursor, segment, {
        configurable: false,
        enumerable: true,
        value: container,
        writable: false,
      });
      ownedContainers.add(container);
      cursor = container;
    } else if (!ownedContainers.has(existing)) {
      throw new Error(`plugin host facade path conflicts with public context: ${path.join(".")}`);
    } else {
      cursor = existing;
    }
  }
  const leaf = path[path.length - 1];
  if (Object.hasOwn(cursor, leaf))
    throw new Error(`duplicate plugin host facade path: ${path.join(".")}`);
  Object.defineProperty(cursor, leaf, {
    configurable: false,
    enumerable: true,
    value,
    writable: false,
  });
}

export function createPluginHostFacade({
  entry = null,
  capabilityAdapters = {},
  publicContext = {},
} = {}) {
  if (!entry?.manifest) throw new TypeError("loaded plugin entry is required");
  const facade = { ...(publicContext && typeof publicContext === "object" ? publicContext : {}) };
  const ownedContainers = new Set([facade]);
  for (const port of portsForPluginSurface(entry.manifest, entry.surface)) {
    const descriptor = capabilityAdapters?.[port];
    if (!descriptor || typeof descriptor !== "object") {
      throw new Error(`plugin ${entry.pluginId} requires unavailable host port ${port}`);
    }
    assignFacadePath(facade, normalizePath(descriptor.path), descriptor.value, ownedContainers);
  }
  for (const container of [...ownedContainers].reverse()) Object.freeze(container);
  return facade;
}

export function createContributionTransaction({ commit, rollback = null } = {}) {
  if (typeof commit !== "function")
    throw new TypeError("contribution transaction commit is required");
  const staged = [];
  let state = "staging";
  return Object.freeze({
    get state() {
      return state;
    },
    stage(contribution) {
      if (state !== "staging")
        throw new Error(`cannot stage contribution while transaction is ${state}`);
      staged.push(contribution);
      return contribution;
    },
    receipt() {
      return Object.freeze([...staged]);
    },
    commit() {
      if (state !== "staging")
        throw new Error(`cannot commit contribution transaction while ${state}`);
      const result = commit(Object.freeze([...staged]));
      state = "committed";
      return result;
    },
    rollback() {
      if (state === "rolled_back") return;
      if (state === "committed" && typeof rollback !== "function") {
        throw new Error("committed contribution transaction has no rollback operation");
      }
      const previousState = state;
      state = "rolled_back";
      if (typeof rollback === "function")
        return rollback(Object.freeze([...staged]), previousState);
    },
  });
}

function emitLifecycle(lifecycleSink, event, entry, options = {}) {
  const record = createPluginLifecycleRecord({ event, entry, ...options });
  if (typeof lifecycleSink === "function") lifecycleSink(record);
  return record;
}

function captureLifecycle({ lifecycleEvents, lifecycleSink, event, entry, options = {}, errors }) {
  try {
    const record = emitLifecycle(lifecycleSink, event, entry, options);
    lifecycleEvents.push(record);
    return record;
  } catch (error) {
    errors.push(error);
    return null;
  }
}

function ensureSync(value, operation) {
  if (value && typeof value.then === "function")
    throw new TypeError(`${operation} must be synchronous`);
  return value;
}

function cleanupError(primaryError, errors, message) {
  if (!errors.length) return primaryError || null;
  if (!primaryError && errors.length === 1) return errors[0];
  return new AggregateError(
    primaryError ? [primaryError, ...errors] : errors,
    primaryError?.message || message,
    primaryError ? { cause: primaryError } : undefined,
  );
}

function captureCleanupOutcome({
  lifecycleEvents,
  lifecycleSink,
  entry,
  successEvent,
  entryErrors,
  errors,
}) {
  errors.push(...entryErrors);
  captureLifecycle({
    lifecycleEvents,
    lifecycleSink,
    event: entryErrors.length ? PLUGIN_LIFECYCLE_EVENT.FAILED : successEvent,
    entry,
    options: entryErrors.length
      ? { error: cleanupError(null, entryErrors, "plugin cleanup failed") }
      : {},
    errors,
  });
}

function createScopeHandle({
  entries,
  activations,
  transactions,
  lifecycleEvents,
  lifecycleSink,
  synchronous,
}) {
  let disposed = false;
  let disposalPromise = null;
  const cleaned = new Set();
  const dispose = synchronous
    ? ({ cause = null } = {}) => {
        if (disposed) {
          if (cause) throw cause;
          return;
        }
        disposed = true;
        const errors = [];
        for (const entry of [...entries].reverse()) {
          const activation = activations.get(entry.pluginId);
          if (!activation || cleaned.has(entry.pluginId)) continue;
          cleaned.add(entry.pluginId);
          captureLifecycle({
            lifecycleEvents,
            lifecycleSink,
            event: PLUGIN_LIFECYCLE_EVENT.DEACTIVATING,
            entry,
            errors,
          });
          const transaction = transactions.get(entry.pluginId);
          const entryErrors = [];
          try {
            ensureSync(transaction?.rollback(), `plugin ${entry.pluginId} rollback`);
          } catch (error) {
            entryErrors.push(error);
          }
          try {
            ensureSync(activation.dispose(), `plugin ${entry.pluginId} dispose`);
          } catch (error) {
            entryErrors.push(error);
          }
          captureCleanupOutcome({
            lifecycleEvents,
            lifecycleSink,
            entry,
            successEvent: PLUGIN_LIFECYCLE_EVENT.DEACTIVATED,
            entryErrors,
            errors,
          });
        }
        activations.clear();
        const error = cleanupError(cause, errors, "plugin scope disposal failed");
        if (error) throw error;
      }
    : ({ cause = null } = {}) => {
        if (disposalPromise) return disposalPromise;
        disposed = true;
        disposalPromise = (async () => {
          const errors = [];
          for (const entry of [...entries].reverse()) {
            const activation = activations.get(entry.pluginId);
            if (!activation || cleaned.has(entry.pluginId)) continue;
            cleaned.add(entry.pluginId);
            captureLifecycle({
              lifecycleEvents,
              lifecycleSink,
              event: PLUGIN_LIFECYCLE_EVENT.DEACTIVATING,
              entry,
              errors,
            });
            const transaction = transactions.get(entry.pluginId);
            const entryErrors = [];
            try {
              await transaction?.rollback();
            } catch (error) {
              entryErrors.push(error);
            }
            try {
              await activation.dispose();
            } catch (error) {
              entryErrors.push(error);
            }
            captureCleanupOutcome({
              lifecycleEvents,
              lifecycleSink,
              entry,
              successEvent: PLUGIN_LIFECYCLE_EVENT.DEACTIVATED,
              entryErrors,
              errors,
            });
          }
          activations.clear();
          const error = cleanupError(cause, errors, "plugin scope disposal failed");
          if (error) throw error;
        })();
        return disposalPromise;
      };
  return Object.freeze({
    entries: Object.freeze([...entries]),
    getActivation(pluginId) {
      return activations.get(String(pluginId || "").trim());
    },
    get lifecycleEvents() {
      return Object.freeze([...lifecycleEvents]);
    },
    get disposed() {
      return disposed;
    },
    dispose,
  });
}

function rollbackScopeSync({
  entries,
  activations,
  transactions,
  lifecycleEvents,
  lifecycleSink,
  primaryError,
  errors = [],
}) {
  for (const entry of [...entries].reverse()) {
    if (!transactions.has(entry.pluginId)) continue;
    const entryErrors = [];
    try {
      ensureSync(transactions.get(entry.pluginId).rollback(), `plugin ${entry.pluginId} rollback`);
    } catch (error) {
      entryErrors.push(error);
    }
    try {
      ensureSync(
        activations.get(entry.pluginId)?.dispose(),
        `plugin ${entry.pluginId} rollback dispose`,
      );
    } catch (error) {
      entryErrors.push(error);
    }
    captureCleanupOutcome({
      lifecycleEvents,
      lifecycleSink,
      entry,
      successEvent: PLUGIN_LIFECYCLE_EVENT.ROLLED_BACK,
      entryErrors,
      errors,
    });
  }
  throw cleanupError(primaryError, errors, "plugin activation rollback failed");
}

async function rollbackScope({
  entries,
  activations,
  transactions,
  lifecycleEvents,
  lifecycleSink,
  primaryError,
  errors = [],
}) {
  for (const entry of [...entries].reverse()) {
    if (!transactions.has(entry.pluginId)) continue;
    const entryErrors = [];
    try {
      await transactions.get(entry.pluginId).rollback();
    } catch (error) {
      entryErrors.push(error);
    }
    try {
      await activations.get(entry.pluginId)?.dispose();
    } catch (error) {
      entryErrors.push(error);
    }
    captureCleanupOutcome({
      lifecycleEvents,
      lifecycleSink,
      entry,
      successEvent: PLUGIN_LIFECYCLE_EVENT.ROLLED_BACK,
      entryErrors,
      errors,
    });
  }
  throw cleanupError(primaryError, errors, "plugin activation rollback failed");
}

function activateScopeSync({
  entries = [],
  hostFactory,
  configFactory,
  transactionFactory,
  lifecycleSink,
} = {}) {
  const selectedEntries = [...entries];
  const activations = new Map();
  const transactions = new Map();
  const lifecycleEvents = [];
  let currentEntry = null;
  try {
    for (const entry of selectedEntries) {
      currentEntry = entry;
      lifecycleEvents.push(emitLifecycle(lifecycleSink, PLUGIN_LIFECYCLE_EVENT.ACTIVATING, entry));
      const transaction =
        transactionFactory?.(entry) ||
        createContributionTransaction({
          commit: () => undefined,
          rollback: () => undefined,
        });
      transactions.set(entry.pluginId, transaction);
      const result = ensureSync(
        entry.activate(hostFactory(entry, transaction), configFactory?.(entry) || {}),
        `plugin ${entry.pluginId} activate`,
      );
      const activation = validatePluginActivationResult(result, {
        pluginId: entry.pluginId,
        surface: entry.surface,
      });
      activations.set(entry.pluginId, activation);
      lifecycleEvents.push(emitLifecycle(lifecycleSink, PLUGIN_LIFECYCLE_EVENT.ACTIVATED, entry));
      validatePluginContributionReceipt(entry.manifest, entry.surface, transaction.receipt());
      ensureSync(transaction.commit(), `plugin ${entry.pluginId} contribution commit`);
      lifecycleEvents.push(
        emitLifecycle(lifecycleSink, PLUGIN_LIFECYCLE_EVENT.CONTRIBUTION_COMMITTED, entry),
      );
    }
  } catch (error) {
    const cleanupErrors = [];
    if (currentEntry)
      captureLifecycle({
        lifecycleEvents,
        lifecycleSink,
        event: PLUGIN_LIFECYCLE_EVENT.FAILED,
        entry: currentEntry,
        options: { error },
        errors: cleanupErrors,
      });
    rollbackScopeSync({
      entries: selectedEntries,
      activations,
      transactions,
      lifecycleEvents,
      lifecycleSink,
      primaryError: error,
      errors: cleanupErrors,
    });
  }
  return createScopeHandle({
    entries: selectedEntries,
    activations,
    transactions,
    lifecycleEvents,
    lifecycleSink,
    synchronous: true,
  });
}

export function createPluginActivationScopeSync(options = {}) {
  if (typeof options.hostFactory !== "function")
    throw new TypeError("plugin hostFactory is required");
  return activateScopeSync(options);
}

export async function createPluginActivationScope(options = {}) {
  if (typeof options.hostFactory !== "function")
    throw new TypeError("plugin hostFactory is required");
  const entries = [...(options.entries || [])];
  const activations = new Map();
  const transactions = new Map();
  const lifecycleEvents = [];
  let currentEntry = null;
  try {
    for (const entry of entries) {
      currentEntry = entry;
      lifecycleEvents.push(
        emitLifecycle(options.lifecycleSink, PLUGIN_LIFECYCLE_EVENT.ACTIVATING, entry),
      );
      const transaction =
        options.transactionFactory?.(entry) ||
        createContributionTransaction({
          commit: () => undefined,
          rollback: () => undefined,
        });
      transactions.set(entry.pluginId, transaction);
      const result = await entry.activate(
        options.hostFactory(entry, transaction),
        options.configFactory?.(entry) || {},
      );
      const activation = validatePluginActivationResult(result, {
        pluginId: entry.pluginId,
        surface: entry.surface,
      });
      activations.set(entry.pluginId, activation);
      lifecycleEvents.push(
        emitLifecycle(options.lifecycleSink, PLUGIN_LIFECYCLE_EVENT.ACTIVATED, entry),
      );
      validatePluginContributionReceipt(entry.manifest, entry.surface, transaction.receipt());
      await transaction.commit();
      lifecycleEvents.push(
        emitLifecycle(options.lifecycleSink, PLUGIN_LIFECYCLE_EVENT.CONTRIBUTION_COMMITTED, entry),
      );
    }
  } catch (error) {
    const cleanupErrors = [];
    if (currentEntry)
      captureLifecycle({
        lifecycleEvents,
        lifecycleSink: options.lifecycleSink,
        event: PLUGIN_LIFECYCLE_EVENT.FAILED,
        entry: currentEntry,
        options: { error },
        errors: cleanupErrors,
      });
    await rollbackScope({
      entries,
      activations,
      transactions,
      lifecycleEvents,
      lifecycleSink: options.lifecycleSink,
      primaryError: error,
      errors: cleanupErrors,
    });
  }
  return createScopeHandle({
    entries,
    activations,
    transactions,
    lifecycleEvents,
    lifecycleSink: options.lifecycleSink,
    synchronous: false,
  });
}
