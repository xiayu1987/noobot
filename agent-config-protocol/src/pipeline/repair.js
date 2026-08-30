/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MODEL_PROVIDER_CONFIG_CONTRACT,
  resolveDefaultModelLibraryProvider,
  resolveModelLibraryProvider,
  supportsModelMultimodalGeneration,
  supportsModelMultimodalParsing,
} from "@noobot/model-protocol";
import {
  CONFIG_DOCUMENT_SCOPE,
  CONFIG_NODE_POLICY,
  CONFIG_PATH_REPRESENTATION,
  CONFIG_REPAIR_ACTION,
  listConfigNodePathsByPolicy,
} from "../contract/repair.js";
import {
  CONFIG_EXTENSION_ENTRY_CONTRACTS,
  CONFIG_OPTIONAL_ROOT_CONTRACTS,
} from "../contract/extension-config.js";
import { migrateConfigFileToCurrentProtocol } from "./migration.js";
import { isPlainObject } from "../utils.js";

const REMOVE_NODE = Symbol("remove_config_node");
const OPEN_COLLECTION_PATHS = new Set([
  "providers",
  ...Object.keys(CONFIG_EXTENSION_ENTRY_CONTRACTS),
]);
const VALID_SCOPES = new Set(Object.values(CONFIG_DOCUMENT_SCOPE));

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function pathText(path) {
  return path.length ? path.join(".") : "$";
}

function validatesScalar(value, contract = {}) {
  const type = contract.type;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isPlainObject(value);
  if (type === "number" && (typeof value !== "number" || !Number.isFinite(value))) return false;
  if (type === "integer" && !Number.isInteger(value)) return false;
  if (!["number", "integer"].includes(type) && typeof value !== type) return false;
  if (type === "string" && contract.nonEmpty && !value.trim()) return false;
  if (Array.isArray(contract.values) && !contract.values.includes(value)) return false;
  if (typeof value === "number" && contract.minimum !== undefined && value < contract.minimum)
    return false;
  if (typeof value === "number" && contract.maximum !== undefined && value > contract.maximum)
    return false;
  return true;
}

function validatesContract(value, contract = {}) {
  if (Array.isArray(contract.oneOf)) {
    return contract.oneOf.some((variant) => validatesContract(value, variant));
  }
  if (!validatesScalar(value, contract)) return false;
  if (contract.type === "array" && contract.items) {
    return value.every((item) => validatesContract(item, contract.items));
  }
  if (contract.type !== "object") return true;
  const properties = isPlainObject(contract.properties) ? contract.properties : {};
  for (const key of contract.required || []) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
    if (!validatesContract(value[key], properties[key])) return false;
  }
  for (const [key, child] of Object.entries(value)) {
    if (properties[key]) {
      if (!validatesContract(child, properties[key])) return false;
      continue;
    }
    if (contract.additionalProperties === true) continue;
    if (!isPlainObject(contract.additionalProperties)) return false;
    if (!validatesContract(child, contract.additionalProperties)) return false;
  }
  return true;
}

function recordChange(changes, path, action, reason) {
  changes.push(Object.freeze({ path: pathText(path), action, reason }));
}

function repairInvalidNode({ template, path, changes, reason }) {
  if (template !== undefined) {
    recordChange(changes, path, CONFIG_REPAIR_ACTION.RESET_TO_DEFAULT, reason);
    return clone(template);
  }
  recordChange(changes, path, CONFIG_REPAIR_ACTION.REMOVE_INVALID_OPTIONAL, reason);
  return REMOVE_NODE;
}

function repairContractNode({ contract, template, target, path, changes }) {
  if (target === undefined) {
    if (template === undefined) return REMOVE_NODE;
    recordChange(changes, path, CONFIG_REPAIR_ACTION.ADD_DEFAULT, "missing_defaulted_node");
    return clone(template);
  }
  if (Array.isArray(contract.oneOf)) {
    const variant = contract.oneOf.find((item) => validatesContract(target, item));
    if (!variant) {
      return repairInvalidNode({ template, path, changes, reason: "invalid_node_value" });
    }
    return repairContractNode({ contract: variant, template, target, path, changes });
  }
  if (!validatesScalar(target, contract)) {
    return repairInvalidNode({ template, path, changes, reason: "invalid_node_value" });
  }
  if (contract.type === "array") {
    if (!contract.items || target.every((item) => validatesContract(item, contract.items))) {
      return clone(target);
    }
    return repairInvalidNode({ template, path, changes, reason: "invalid_array_item" });
  }
  if (contract.type !== "object") return clone(target);

  const output = {};
  const templateObject = isPlainObject(template) ? template : {};
  const properties = isPlainObject(contract.properties) ? contract.properties : {};
  for (const [key, childContract] of Object.entries(properties)) {
    const child = repairContractNode({
      contract: childContract,
      template: templateObject[key],
      target: target[key],
      path: [...path, key],
      changes,
    });
    if (child !== REMOVE_NODE) output[key] = child;
  }
  for (const [key, child] of Object.entries(templateObject)) {
    if (properties[key]) continue;
    if (contract.additionalProperties === true) {
      if (Object.prototype.hasOwnProperty.call(target, key)) {
        output[key] = clone(target[key]);
      } else {
        output[key] = clone(child);
        recordChange(
          changes,
          [...path, key],
          CONFIG_REPAIR_ACTION.ADD_DEFAULT,
          "missing_defaulted_node",
        );
      }
      continue;
    }
    if (isPlainObject(contract.additionalProperties)) {
      const repaired = repairContractNode({
        contract: contract.additionalProperties,
        template: child,
        target: target[key],
        path: [...path, key],
        changes,
      });
      if (repaired !== REMOVE_NODE) output[key] = repaired;
      continue;
    }
    throw new TypeError(`config template contains unsupported node: ${pathText([...path, key])}`);
  }
  for (const [key, child] of Object.entries(target)) {
    if (properties[key] || Object.prototype.hasOwnProperty.call(output, key)) continue;
    if (contract.additionalProperties === true) {
      output[key] = clone(child);
      continue;
    }
    if (isPlainObject(contract.additionalProperties)) {
      const repaired = repairContractNode({
        contract: contract.additionalProperties,
        target: child,
        path: [...path, key],
        changes,
      });
      if (repaired !== REMOVE_NODE) output[key] = repaired;
      continue;
    }
    recordChange(
      changes,
      [...path, key],
      CONFIG_REPAIR_ACTION.REMOVE_UNSUPPORTED,
      "unsupported_node",
    );
  }
  return output;
}

function repairUnknownProvider({ target, path, changes }) {
  const template = resolveDefaultModelLibraryProvider();
  const repaired = repairContractNode({
    contract: MODEL_PROVIDER_CONFIG_CONTRACT,
    template,
    target: isPlainObject(target) ? target : {},
    path,
    changes,
  });
  if (repaired === REMOVE_NODE) return clone(template);
  return repaired;
}

function repairCollectionEntry({ collectionPath, template, target, path, changes }) {
  // Provider aliases are user-owned model configurations and their key and
  // valid values must survive repair. Unknown providers use only the generic
  // library template to fill missing or invalid fields.
  if (collectionPath === "providers" && template === undefined) {
    const libraryTemplate = resolveModelLibraryProvider(path.at(-1));
    if (libraryTemplate) {
      return repairContractNode({
        contract: MODEL_PROVIDER_CONFIG_CONTRACT,
        template: libraryTemplate,
        target,
        path,
        changes,
      });
    }
    return repairUnknownProvider({ target, path, changes });
  }
  const contract =
    collectionPath === "providers"
      ? MODEL_PROVIDER_CONFIG_CONTRACT
      : CONFIG_EXTENSION_ENTRY_CONTRACTS[collectionPath];
  if (template !== undefined && collectionPath === "plugins") return null;
  if (!contract) return isPlainObject(target) ? clone(target) : REMOVE_NODE;
  const repaired = repairContractNode({ contract, template, target, path, changes });
  if (repaired === REMOVE_NODE) return repaired;
  if (template === undefined && !validatesContract(repaired, contract)) {
    recordChange(
      changes,
      path,
      CONFIG_REPAIR_ACTION.REMOVE_UNSUPPORTED,
      "incomplete_extension_entry",
    );
    return REMOVE_NODE;
  }
  return repaired;
}

function matchesTemplateType(template, target) {
  if (Array.isArray(template)) return Array.isArray(target);
  if (isPlainObject(template)) return isPlainObject(target);
  if (typeof template === "number") return typeof target === "number" && Number.isFinite(target);
  return typeof target === typeof template;
}

function repairTemplateObject({ template, target, path, changes, scope }) {
  const targetObject = isPlainObject(target) ? target : {};
  const output = {};
  const currentPath = pathText(path) === "$" ? "" : pathText(path);
  for (const [key, defaultValue] of Object.entries(template)) {
    const childPath = [...path, key];
    if (!Object.prototype.hasOwnProperty.call(targetObject, key)) {
      output[key] = clone(defaultValue);
      recordChange(changes, childPath, CONFIG_REPAIR_ACTION.ADD_DEFAULT, "missing_defaulted_node");
      continue;
    }
    const targetValue = targetObject[key];
    if (!matchesTemplateType(defaultValue, targetValue)) {
      output[key] = clone(defaultValue);
      recordChange(changes, childPath, CONFIG_REPAIR_ACTION.RESET_TO_DEFAULT, "invalid_node_type");
      continue;
    }
    if (!isPlainObject(defaultValue)) {
      output[key] = clone(targetValue);
      continue;
    }
    const collectionEntry = OPEN_COLLECTION_PATHS.has(currentPath)
      ? repairCollectionEntry({
          collectionPath: currentPath,
          template: defaultValue,
          target: targetValue,
          path: childPath,
          changes,
        })
      : null;
    output[key] =
      collectionEntry === null
        ? repairTemplateObject({
            template: defaultValue,
            target: targetValue,
            path: childPath,
            changes,
            scope,
          })
        : collectionEntry;
  }

  const optionalRootContracts = CONFIG_OPTIONAL_ROOT_CONTRACTS[scope] || {};
  for (const [key, targetValue] of Object.entries(targetObject)) {
    const childPath = [...path, key];
    if (Object.prototype.hasOwnProperty.call(output, key)) continue;
    if (
      path.length === 0 &&
      optionalRootContracts[key]?.policy === CONFIG_NODE_POLICY.USER_OPTIONAL
    ) {
      const repaired = repairContractNode({
        contract: optionalRootContracts[key].contract,
        target: targetValue,
        path: childPath,
        changes,
      });
      if (repaired !== REMOVE_NODE) output[key] = repaired;
      continue;
    }
    if (OPEN_COLLECTION_PATHS.has(currentPath)) {
      const repaired = repairCollectionEntry({
        collectionPath: currentPath,
        target: targetValue,
        path: childPath,
        changes,
      });
      if (repaired !== REMOVE_NODE) output[key] = repaired;
      continue;
    }
    recordChange(changes, childPath, CONFIG_REPAIR_ACTION.REMOVE_UNSUPPORTED, "unsupported_node");
  }
  return output;
}

function removePath(root, path, changes = null) {
  const parts = path.split(".").filter(Boolean);
  let node = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    node = isPlainObject(node?.[parts[index]]) ? node[parts[index]] : null;
    if (!node) return;
  }
  const key = parts.at(-1);
  if (!node || !Object.prototype.hasOwnProperty.call(node, key)) return;
  delete node[key];
  if (!Array.isArray(changes)) return;
  recordChange(
    changes,
    parts,
    CONFIG_REPAIR_ACTION.REMOVE_SCOPE_FORBIDDEN,
    "system_owned_node_in_user_config",
  );
}

function valueAt(root, path) {
  let node = root;
  for (const key of path) node = isPlainObject(node) ? node[key] : undefined;
  return node;
}

function setValueAt(root, path, value) {
  let node = root;
  for (const key of path.slice(0, -1)) {
    if (!isPlainObject(node[key])) node[key] = {};
    node = node[key];
  }
  node[path.at(-1)] = value;
}

function providerSupportsReference(provider, requirement) {
  if (!isPlainObject(provider) || !validatesContract(provider, MODEL_PROVIDER_CONFIG_CONTRACT)) {
    return false;
  }
  if (provider.enabled === false) return false;
  if (requirement === "conversation") return provider.used_for_conversation !== false;
  if (requirement.startsWith("parse:")) {
    return supportsModelMultimodalParsing(provider, [requirement.slice("parse:".length)]);
  }
  if (requirement.startsWith("generate:")) {
    return supportsModelMultimodalGeneration(provider, [requirement.slice("generate:".length)]);
  }
  return true;
}

function restoreProviderReferenceDefaults({ document, template, alias, requirement, changes }) {
  const provider = document.providers?.[alias];
  const providerTemplate = template.providers?.[alias];
  if (!isPlainObject(provider) || !isPlainObject(providerTemplate)) return;
  const relativePaths = [["enabled"]];
  if (requirement === "conversation") relativePaths.push(["used_for_conversation"]);
  if (requirement.startsWith("parse:")) relativePaths.push(["multimodal_parsing"]);
  if (requirement.startsWith("generate:")) relativePaths.push(["multimodal_generation"]);
  for (const relativePath of relativePaths) {
    const defaultValue = valueAt(providerTemplate, relativePath);
    if (defaultValue === undefined) continue;
    if (JSON.stringify(valueAt(provider, relativePath)) === JSON.stringify(defaultValue)) continue;
    setValueAt(provider, relativePath, clone(defaultValue));
    recordChange(
      changes,
      ["providers", alias, ...relativePath],
      CONFIG_REPAIR_ACTION.RESET_TO_DEFAULT,
      "invalid_default_model_capability",
    );
  }
}

function collectReferenceRules(document) {
  const rules = [
    { path: ["default_provider"], requirement: "conversation" },
    { path: ["tools", "web_search", "responses_api", "model"], requirement: "model" },
    { path: ["tools", "request_help", "help_model"], requirement: "model" },
    { path: ["plugins", "workflow", "semanticModel"], requirement: "model" },
  ];
  for (const modality of ["audio", "document", "image", "video"]) {
    rules.push({
      path: ["multimodal", "parsing", "default_models", modality],
      requirement: `parse:${modality}`,
    });
  }
  rules.push({
    path: ["multimodal", "generation", "default_models", "image"],
    requirement: "generate:image",
  });
  for (const key of Object.keys(document?.scenarios?.definitions || {})) {
    rules.push({ path: ["scenarios", "definitions", key, "model"], requirement: "model" });
  }
  for (const key of Object.keys(document?.plugins?.harness?.stepModels || {})) {
    rules.push({ path: ["plugins", "harness", "stepModels", key], requirement: "model" });
  }
  return rules;
}

function repairModelReferences(document, template, changes) {
  const providers = isPlainObject(document.providers) ? document.providers : {};
  const templateProviders = isPlainObject(template.providers) ? template.providers : {};
  for (const rule of collectReferenceRules(document)) {
    const alias = valueAt(document, rule.path);
    if (typeof alias !== "string" || !alias) continue;
    if (providerSupportsReference(providers[alias], rule.requirement)) continue;
    const fallback = valueAt(template, rule.path);
    if (
      typeof fallback !== "string" ||
      !fallback ||
      !providerSupportsReference(templateProviders[fallback], rule.requirement)
    ) {
      throw new TypeError(`config template has no valid model reference at ${pathText(rule.path)}`);
    }
    restoreProviderReferenceDefaults({
      document,
      template,
      alias: fallback,
      requirement: rule.requirement,
      changes,
    });
    if (!providerSupportsReference(providers[fallback], rule.requirement)) {
      throw new TypeError(`config repair cannot restore model reference at ${pathText(rule.path)}`);
    }
    setValueAt(document, rule.path, fallback);
    recordChange(
      changes,
      rule.path,
      CONFIG_REPAIR_ACTION.RESET_TO_DEFAULT,
      "invalid_model_reference",
    );
  }
}

export function repairConfigDocument({
  scope = CONFIG_DOCUMENT_SCOPE.GLOBAL,
  template = {},
  target = {},
} = {}) {
  if (!VALID_SCOPES.has(scope)) throw new TypeError(`unsupported config document scope: ${scope}`);
  if (!isPlainObject(template)) throw new TypeError("config repair template must be an object");
  const currentTemplate = migrateConfigFileToCurrentProtocol(template);
  const sourceTarget = isPlainObject(target) ? target : {};
  const currentTarget = migrateConfigFileToCurrentProtocol(sourceTarget);
  const changes = [];
  if (!isPlainObject(target)) {
    recordChange(changes, [], CONFIG_REPAIR_ACTION.RESET_TO_DEFAULT, "invalid_document_type");
  }
  if (JSON.stringify(sourceTarget) !== JSON.stringify(currentTarget)) {
    recordChange(changes, [], CONFIG_REPAIR_ACTION.MIGRATE_PROTOCOL, "outdated_protocol");
  }
  const scopedTemplate = clone(currentTemplate);
  const scopedTarget = clone(currentTarget);
  if (scope !== CONFIG_DOCUMENT_SCOPE.GLOBAL) {
    for (const path of listConfigNodePathsByPolicy({
      policy: CONFIG_NODE_POLICY.SYSTEM_OWNED,
      representation: CONFIG_PATH_REPRESENTATION.PERSISTED,
    })) {
      removePath(scopedTemplate, path);
      removePath(scopedTarget, path, changes);
    }
  }
  const document = repairTemplateObject({
    template: scopedTemplate,
    target: scopedTarget,
    path: [],
    changes,
    scope,
  });
  repairModelReferences(document, scopedTemplate, changes);
  return Object.freeze({
    document,
    report: Object.freeze({ changed: changes.length > 0, changes: Object.freeze(changes) }),
  });
}
