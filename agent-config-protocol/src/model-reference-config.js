/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "./utils.js";
import { resolveModelLibraryProvider } from "@noobot/model-protocol";
import { listConfigModelReferences, supportsModelReference } from "./contract/model-reference.js";
import { text } from "@noobot/shared/value";

export function applyPrimaryModelReferencesToConfigFile(config = {}, modelAlias = "") {
  const alias = text(modelAlias);
  if (!isPlainObject(config) || !alias) return config;
  const providers = isPlainObject(config.providers) ? config.providers : {};
  if (!supportsModelReference(providers[alias], "model")) {
    throw new TypeError(`selected model provider not found: ${alias}`);
  }

  config.default_provider = alias;
  providers[alias].enabled = true;
  providers[alias].used_for_conversation = true;

  for (const { container, key, requirement } of listConfigModelReferences(config)) {
    if (supportsModelReference(providers[alias], requirement)) container[key] = alias;
  }
  return config;
}

export function ensureModelProviderInConfigFile(
  config = {},
  modelAlias = "",
  { providerTemplate = null } = {},
) {
  const alias = text(modelAlias);
  if (!isPlainObject(config)) throw new TypeError("config must be an object");
  if (!alias) throw new TypeError("model alias is required");
  if (!isPlainObject(config.providers)) config.providers = {};
  if (isPlainObject(config.providers[alias])) return config.providers[alias];

  const selectedTemplate = isPlainObject(providerTemplate)
    ? providerTemplate
    : resolveModelLibraryProvider(alias);
  if (!isPlainObject(selectedTemplate)) {
    throw new TypeError(`selected model provider not found: ${alias}`);
  }
  config.providers[alias] = JSON.parse(JSON.stringify(selectedTemplate));
  return config.providers[alias];
}
