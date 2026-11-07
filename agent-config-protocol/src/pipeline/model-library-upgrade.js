/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MODEL_LIBRARY_VERSION,
  MODEL_PROVIDER_CONFIG_CONTRACT,
  MODEL_PROVIDER_FIELD_GROUP,
  listModelLibraryOptions,
  resolveModelLibraryProvider,
} from "@noobot/model-protocol";
import { isPlainObject } from "../utils.js";
import { AgentConfigProtocolError, CONFIG_ERROR_CODE } from "../contract/errors.js";
import { createConfigIssue } from "../contract/issues.js";
import { diagnoseConfigModelReferences } from "../contract/model-reference.js";

function invalidLibraryConfig(path, message) {
  return new AgentConfigProtocolError(message, {
    code: CONFIG_ERROR_CODE.INVALID_MODEL_LIBRARY_CONFIG,
    details: createConfigIssue(CONFIG_ERROR_CODE.INVALID_MODEL_LIBRARY_CONFIG, { path, message }),
  });
}

const capabilityFields = Object.entries(MODEL_PROVIDER_CONFIG_CONTRACT.properties)
  .filter(([, contract]) => contract.group === MODEL_PROVIDER_FIELD_GROUP.CAPABILITY)
  .map(([field]) => field);

function synchronizeBuiltinProvider(provider, declaration) {
  if (provider.is_custom || provider.model !== declaration.model) return;
  provider.supplier = declaration.supplier;
  for (const field of capabilityFields) {
    if (Object.hasOwn(declaration, field)) {
      provider[field] = structuredClone(declaration[field]);
    } else {
      delete provider[field];
    }
  }
}

export function upgradeConfigModelLibrary(target) {
  if (!isPlainObject(target)) throw new TypeError("model library upgrade requires a config object");
  const previousVersion = target.model_library_version;
  if (
    previousVersion !== undefined &&
    (!Number.isInteger(previousVersion) || previousVersion < 1)
  ) {
    throw invalidLibraryConfig(
      "model_library_version",
      "config model_library_version must be a positive integer",
    );
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
        issues: diagnoseConfigModelReferences(target),
      },
    };
  }
  if (previousVersion > MODEL_LIBRARY_VERSION) {
    throw invalidLibraryConfig(
      "model_library_version",
      "config model library version is newer than this application",
    );
  }
  if (target.providers !== undefined && !isPlainObject(target.providers)) {
    throw invalidLibraryConfig("providers", "model library upgrade requires a providers object");
  }
  const document = structuredClone(target);
  const providers = document.providers ?? {};
  const aliases = listModelLibraryOptions().map(({ key }) => key);
  const libraryAliases = new Set(aliases);
  const added = [];
  const removed = [];
  const markedCustom = [];
  for (const [alias, provider] of Object.entries(providers)) {
    if (!isPlainObject(provider))
      throw invalidLibraryConfig(`providers.${alias}`, `invalid model provider: ${alias}`);
    if (previousVersion === undefined) {
      provider.is_custom = true;
      markedCustom.push(alias);
    } else if (provider.is_custom === undefined) {
      provider.is_custom = false;
    } else if (typeof provider.is_custom !== "boolean") {
      throw invalidLibraryConfig(
        `providers.${alias}.is_custom`,
        `model provider ${alias}.is_custom must be a boolean`,
      );
    }
  }
  for (const alias of aliases) {
    const declaration = resolveModelLibraryProvider(alias);
    if (Object.hasOwn(providers, alias)) {
      synchronizeBuiltinProvider(providers[alias], declaration);
      continue;
    }
    providers[alias] = declaration;
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
      issues: diagnoseConfigModelReferences(document),
    },
  };
}
