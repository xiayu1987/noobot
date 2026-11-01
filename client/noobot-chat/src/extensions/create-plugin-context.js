/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject, requireFunctionDependencies, text } from "@noobot/shared/value";

export function createPluginContext({ pluginId, getConfig, updateConfig }) {
  const namespace = text(pluginId);
  if (!namespace) throw new Error("plugin context id is required");
  requireFunctionDependencies("createPluginContext", { getConfig, updateConfig });

  function readConfig() {
    const root = getConfig();
    if (!isPlainObject(root)) throw new TypeError("plugin config root must be an object");
    if (Object.hasOwn(root, namespace) && !isPlainObject(root[namespace])) {
      throw new TypeError(`plugin config ${namespace} must be an object`);
    }
    return root;
  }

  return Object.freeze({
    pluginId: namespace,
    config: Object.freeze({
      get() {
        const root = readConfig();
        return Object.hasOwn(root, namespace) ? root[namespace] : {};
      },
      patch(patch) {
        if (!isPlainObject(patch)) throw new TypeError("plugin config patch must be an object");
        const root = readConfig();
        const current = Object.hasOwn(root, namespace) ? root[namespace] : {};
        updateConfig({
          ...root,
          [namespace]: { ...current, ...patch },
        });
      },
    }),
  });
}
