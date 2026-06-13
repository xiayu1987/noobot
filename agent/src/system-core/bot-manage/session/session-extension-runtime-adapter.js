/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RunConfigExtensionPreparer } from "./run-config-extension-preparer.js";
import { normalizePluginSelectorSet } from "./session-execution-engine-utils.js";

export function createSessionExtensionRuntime({
  loadedExtensions = null,
  descriptors = [],
  resolveExtensionKey = null,
} = {}) {
  const runtime = {};
  for (const descriptor of Array.isArray(descriptors) ? descriptors : []) {
    if (!descriptor || typeof descriptor !== "object") continue;
    const keyProperty = String(descriptor.keyProperty || "").trim();
    const selectorsProperty = String(descriptor.selectorsProperty || "").trim();
    if (!keyProperty || !selectorsProperty) continue;

    const fallbackKey = String(descriptor.fallbackKey || "").trim();
    const resolvedKey =
      typeof resolveExtensionKey === "function"
        ? String(resolveExtensionKey({ loadedExtensions, descriptor }) || "").trim()
        : "";
    const extensionKey = resolvedKey || fallbackKey;
    const selectors = normalizePluginSelectorSet([
      extensionKey,
      fallbackKey,
      ...(Array.isArray(descriptor.selectors) ? descriptor.selectors : []),
    ]);

    runtime[keyProperty] = extensionKey;
    runtime[selectorsProperty] = selectors;
  }
  return Object.freeze(runtime);
}

export function createRunConfigExtensionPreparer({
  globalConfig = {},
  workspaceService = null,
  loadedExtensions = null,
  extensionRuntime = {},
  normalizeStringArray = null,
  mergeModelExtensionOptions = null,
  mergeHarnessExtensionOptions = null,
  createExtensionResolveModelMessages = null,
  createHarnessResolveModelMessages = null,
  createExtensionResolveMessageBlock = null,
  createHarnessResolveMessageBlock = null,
  createExtensionMarkMessagesSummarized = null,
  createHarnessMarkMessagesSummarized = null,
  createDetachedSubSessionRunner = null,
  createBotSubSessionRunner = null,
  createGeneratedArtifactPersister = null,
  createScopedJsonWriter = null,
  createWorkflowScopedJsonWriter = null,
  createScopedEventLogger = null,
  createWorkflowScopedEventLogger = null,
} = {}) {
  return new RunConfigExtensionPreparer({
    globalConfig,
    workspaceService,
    loadedDynamicPlugins: loadedExtensions,
    extensionRuntime,
    normalizeStringArray,
    mergeModelExtensionOptions,
    mergeHarnessExtensionOptions,
    createExtensionResolveModelMessages,
    createHarnessResolveModelMessages,
    createExtensionResolveMessageBlock,
    createHarnessResolveMessageBlock,
    createExtensionMarkMessagesSummarized,
    createHarnessMarkMessagesSummarized,
    createDetachedSubSessionRunner,
    createBotSubSessionRunner,
    createGeneratedArtifactPersister,
    createScopedJsonWriter,
    createWorkflowScopedJsonWriter,
    createScopedEventLogger,
    createWorkflowScopedEventLogger,
  });
}
