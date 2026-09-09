/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  resolveDefaultModelLibraryProvider,
  resolveModelLibraryProvider,
  resolveModelLibraryProviderByModel,
} from "@noobot/model-protocol";
import { isPlainObject } from "../utils.js";

function valueAt(source, path) {
  let node = source;
  for (const key of path) {
    if (!isPlainObject(node) && !Array.isArray(node)) return undefined;
    node = node[key];
  }
  return node;
}

export function createConfigValueSource({ baseValues = {} } = {}) {
  const base = isPlainObject(baseValues) ? baseValues : {};

  const hasAt = (source, path) => {
    if (!path.length) return isPlainObject(source);
    const parent = valueAt(source, path.slice(0, -1));
    return isPlainObject(parent) && Object.prototype.hasOwnProperty.call(parent, path.at(-1));
  };

  return Object.freeze({
    has(path = []) {
      return hasAt(base, path);
    },

    resolve(path = []) {
      return valueAt(base, path);
    },

    resolveProviderValues(alias = "") {
      const fromLibrary = resolveModelLibraryProvider(alias);
      if (isPlainObject(fromLibrary)) return fromLibrary;
      const configuredModel = valueAt(base, ["providers", alias, "model"]);
      const fromModel = resolveModelLibraryProviderByModel(configuredModel);
      if (isPlainObject(fromModel)) return fromModel;

      const fromExample = valueAt(base, ["providers", alias]);
      if (isPlainObject(fromExample)) return fromExample;
      return resolveDefaultModelLibraryProvider();
    },

    listProviderAliases() {
      const aliases = new Set();
      const providers = isPlainObject(base) ? base.providers : null;
      if (isPlainObject(providers)) for (const alias of Object.keys(providers)) aliases.add(alias);
      return Object.freeze([...aliases]);
    },
  });
}
