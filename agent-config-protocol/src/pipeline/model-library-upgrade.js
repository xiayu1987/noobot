/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MODEL_LIBRARY_VERSION,
  listModelLibraryOptions,
  resolveModelLibraryProvider,
} from "@noobot/model-protocol";
import { isPlainObject } from "../utils.js";

export function upgradeConfigModelLibrary(target) {
  if (!isPlainObject(target)) throw new TypeError("model library upgrade requires a config object");
  const previousVersion = target.model_library_version;
  if (
    previousVersion !== undefined &&
    (!Number.isInteger(previousVersion) || previousVersion < 1)
  ) {
    throw new TypeError("config model_library_version must be a positive integer");
  }
  if (previousVersion === MODEL_LIBRARY_VERSION) {
    return {
      document: structuredClone(target),
      report: {
        changed: false,
        previousVersion,
        version: MODEL_LIBRARY_VERSION,
        added: [],
        removed: [],
        markedCustom: [],
      },
    };
  }
  if (target.providers !== undefined && !isPlainObject(target.providers)) {
    throw new TypeError("model library upgrade requires a providers object");
  }
  const document = structuredClone(target);
  const providers = document.providers ?? {};
  const aliases = listModelLibraryOptions().map(({ key }) => key);
  const libraryAliases = new Set(aliases);
  const added = [];
  const removed = [];
  const markedCustom = [];
  for (const [alias, provider] of Object.entries(providers)) {
    if (!isPlainObject(provider)) throw new TypeError(`invalid model provider: ${alias}`);
    if (previousVersion === undefined) {
      provider.is_custom = true;
      markedCustom.push(alias);
    } else if (provider.is_custom === undefined) {
      provider.is_custom = false;
    } else if (typeof provider.is_custom !== "boolean") {
      throw new TypeError(`model provider ${alias}.is_custom must be a boolean`);
    }
  }
  for (const alias of aliases) {
    if (Object.hasOwn(providers, alias)) continue;
    providers[alias] = resolveModelLibraryProvider(alias);
    added.push(alias);
  }
  for (const [alias, provider] of Object.entries(providers)) {
    if (libraryAliases.has(alias) || provider.is_custom) continue;
    delete providers[alias];
    removed.push(alias);
  }
  document.providers = providers;
  document.model_library_version = MODEL_LIBRARY_VERSION;
  return {
    document,
    report: {
      changed: true,
      previousVersion,
      version: MODEL_LIBRARY_VERSION,
      added,
      removed,
      markedCustom,
    },
  };
}
