/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { EXTENSION_POINT_DEFINITIONS } from "@noobot/plugin-protocol/frontend";
import { createExtensionRegistry } from "@noobot/plugin-runtime/contributions";

const registry = createExtensionRegistry({
  pointDefinitions: EXTENSION_POINT_DEFINITIONS,
  onWarning: (message) => console.warn(`[extension-registry] ${message}`),
});

export const contributeExtension = registry.contribute;
export const listExtensionContributions = registry.list;
export const replacePluginExtensions = registry.replacePlugin;
export const removePluginExtensions = registry.removePlugin;
export const resolveExtensionPoint = registry.resolve;
export const resolveExtensionProps = registry.resolveProps;
export const resolveExtensionListeners = registry.resolveListeners;
export const provideResolvedExtensionValues = registry.provide;
export function provideExtensionValues(point = "", context = {}) {
  return registry.provide(registry.resolve(point, context), context);
}
export const clearExtensionRegistry = registry.clear;
export const createExtensionRegistryGeneration = registry.createGeneration;
export const publishExtensionRegistryGeneration = registry.publish;
