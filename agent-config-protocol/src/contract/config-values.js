/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * Value authority for explicit configuration.
 *
 * Structure comes from `config-structure.js`; this module answers only "what
 * value should stand here when the target's own value is missing or invalid".
 * There are exactly two value sources, and neither is consulted otherwise:
 *
 * - Model facts (a provider entry's fields): the model library.
 * - Everything else: `service/config/global.config.example.json`.
 *
 * The user-default template is NOT a value source. It is a value *override*
 * layer: it may restate a value it deliberately differs on, and repair prefers
 * it for those paths only. It can never introduce a field or a new default.
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

/**
 * Create the value authority for one repair run.
 *
 * `baseValues` is the global example — the sole non-model value source.
 * User configuration files are never value sources.
 */
export function createConfigValueSource({ baseValues = {} } = {}) {
  const base = isPlainObject(baseValues) ? baseValues : {};

  const hasAt = (source, path) => {
    if (!path.length) return isPlainObject(source);
    const parent = valueAt(source, path.slice(0, -1));
    return isPlainObject(parent) && Object.prototype.hasOwnProperty.call(parent, path.at(-1));
  };

  return Object.freeze({
    /** Whether any value source declares this path. */
    has(path = []) {
      return hasAt(base, path);
    },

    /** The authoritative value for a non-model path. */
    resolve(path = []) {
      return valueAt(base, path);
    },

    /**
     * The authoritative value template for one provider entry. The model
     * library owns model values, so a provider present in the library uses its
     * library entry; anything else falls back to the library's generic
     * provider. The global example never overrides a library value — it only
     * supplies entries the library does not know.
     */
    resolveProviderValues(alias = "") {
      const fromLibrary = resolveModelLibraryProvider(alias);
      if (isPlainObject(fromLibrary)) return fromLibrary;
      const configuredModel = valueAt(base, ["providers", alias, "model"]);
      const fromModel = resolveModelLibraryProviderByModel(configuredModel);
      if (isPlainObject(fromModel)) return fromModel;
      // A provider alias that is intentionally defined only by the explicit
      // global example still needs its declared capabilities and connection
      // fields.  The model library remains authoritative whenever it knows the
      // alias or concrete model; this is the missing-library fallback.
      return resolveDefaultModelLibraryProvider();
    },

    /** Provider aliases the value sources declare, in declaration order. */
    listProviderAliases() {
      const aliases = new Set();
      const providers = isPlainObject(base) ? base.providers : null;
      if (isPlainObject(providers)) for (const alias of Object.keys(providers)) aliases.add(alias);
      return Object.freeze([...aliases]);
    },
  });
}
