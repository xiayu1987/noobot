/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject } from "./configStructureContract.js";
import { resolveModelFamilyPromptCacheFields } from "@noobot/model-protocol";

export const CONFIG_MODEL_REFERENCE_SOURCE = "providers";

function readContainerKeys(document, sourcePath) {
  if (!isPlainObject(document) || !sourcePath) return [];
  let cursor = document;
  for (const key of String(sourcePath).split(".")) {
    if (!isPlainObject(cursor)) return [];
    cursor = cursor[key];
  }
  return isPlainObject(cursor) ? Object.keys(cursor).filter(Boolean) : [];
}

export function resolveConfigReferenceOptions(node, document) {
  if (!isPlainObject(node)) return [];
  if (node.modelReference) {
    return readContainerKeys(document, CONFIG_MODEL_REFERENCE_SOURCE);
  }
  if (node.documentReference) {
    return readContainerKeys(document, node.documentReference);
  }
  return [];
}

function readDeclaredOptions(node, declarationContainer) {
  if (!node?.optionsField || !Array.isArray(declarationContainer?.[node.optionsField])) return [];
  return declarationContainer[node.optionsField].map(String).filter(Boolean);
}

export function resolveConfigFieldOptions(node, container, document, declarationContainer) {
  if (node?.key === "prompt_cache_fields") {
    return resolveModelFamilyPromptCacheFields({ model: container?.model });
  }
  const referenceOptions = resolveConfigReferenceOptions(node, document);
  if (referenceOptions.length) return referenceOptions;
  const declaredOptions = readDeclaredOptions(node, declarationContainer);
  if (declaredOptions.length) return declaredOptions;
  const legacyOptions = readDeclaredOptions(node, container);
  if (legacyOptions.length) return legacyOptions;
  return Array.isArray(node?.options) ? node.options.map(String).filter(Boolean) : [];
}

export function hasConfigReferenceSource(node) {
  if (!isPlainObject(node)) return false;
  return Boolean(node.modelReference || node.documentReference);
}
