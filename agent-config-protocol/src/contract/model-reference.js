/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  supportsModelMultimodalParsing,
  supportsModelMultimodalGeneration,
  resolveModelUsedForConversation,
  MODEL_GENERATION_OUTPUT_TYPES,
} from "@noobot/model-protocol";
import { isPlainObject } from "../utils.js";
import { AgentConfigProtocolError, CONFIG_ERROR_CODE } from "./errors.js";
import { createConfigIssue } from "./issues.js";
import { CONFIG_STRUCTURE_PLACEHOLDER, listStructureModelReferences } from "./config-structure.js";

const REQUIREMENTS = Object.freeze({
  model: () => true,
  conversation: (provider) => resolveModelUsedForConversation(provider),
  ...Object.fromEntries(
    ["image", "video", "audio", "document"].map((modality) => [
      `parse:${modality}`,
      (provider) => supportsModelMultimodalParsing(provider, [modality]),
    ]),
  ),
  ...Object.fromEntries(
    MODEL_GENERATION_OUTPUT_TYPES.map((modality) => [
      `generate:${modality}`,
      (provider) => supportsModelMultimodalGeneration(provider, [modality]),
    ]),
  ),
});

export function supportsModelReference(provider, requirement) {
  if (!Object.hasOwn(REQUIREMENTS, requirement)) {
    throw new TypeError(`unsupported model reference requirement: ${requirement}`);
  }
  return (
    isPlainObject(provider) &&
    typeof provider.model === "string" &&
    Boolean(provider.model.trim()) &&
    REQUIREMENTS[requirement](provider)
  );
}

export function diagnoseModelReference({ provider, alias, requirement, path }) {
  if (!Array.isArray(path) || !path.length) throw new TypeError("model reference path is required");
  if (typeof alias !== "string") throw new TypeError("model reference alias is required");
  if (supportsModelReference(provider, requirement)) return null;
  const code = supportsModelReference(provider, "model")
    ? CONFIG_ERROR_CODE.MODEL_REFERENCE_CAPABILITY_MISMATCH
    : CONFIG_ERROR_CODE.MODEL_REFERENCE_NOT_FOUND;
  return createConfigIssue(code, {
    path: path.join("."),
    alias,
    requirement,
  });
}

export function requireModelReference(options) {
  const issue = diagnoseModelReference(options);
  if (issue) {
    throw new AgentConfigProtocolError(
      `model reference ${issue.path} requires ${issue.requirement}: ${issue.alias} (${issue.code})`,
      { code: issue.code, details: issue },
    );
  }
  return options.provider;
}

export function diagnoseConfigModelReferences(document, options = {}) {
  return Object.freeze(
    listConfigModelReferences(document, options).flatMap(
      ({ container, key, path, requirement, nonEmpty }) => {
        const alias = container[key];
        if (!alias.trim() && !nonEmpty) return [];
        const issue = diagnoseModelReference({
          provider:
            isPlainObject(document.providers) && Object.hasOwn(document.providers, alias)
              ? document.providers[alias]
              : undefined,
          alias,
          path,
          requirement,
        });
        return issue ? [issue] : [];
      },
    ),
  );
}

export function listConfigModelReferences(document, options = {}) {
  const references = [];
  function visit(container, path, declaration) {
    if (!isPlainObject(container)) return;
    const segment = declaration.path[path.length];
    const keys = segment === CONFIG_STRUCTURE_PLACEHOLDER ? Object.keys(container) : [segment];
    for (const key of keys) {
      if (!Object.hasOwn(container, key)) continue;
      const resolvedPath = [...path, key];
      if (resolvedPath.length < declaration.path.length) {
        visit(container[key], resolvedPath, declaration);
        continue;
      }
      if (typeof container[key] !== "string") continue;
      references.push({
        container,
        key,
        path: resolvedPath,
        requirement: declaration.requirement,
        nonEmpty: declaration.nonEmpty,
      });
    }
  }
  for (const declaration of listStructureModelReferences(options)) {
    visit(document, [], declaration);
  }
  return references;
}
