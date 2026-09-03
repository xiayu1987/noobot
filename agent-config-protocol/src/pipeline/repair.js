/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MODEL_PROVIDER_CONFIG_CONTRACT,
  resolveDefaultModelLibraryProvider,
  resolveModelLibraryProvider,
  resolveModelLibraryProviderByModel,
  supportsModelMultimodalGeneration,
  supportsModelMultimodalParsing,
} from "@noobot/model-protocol";
import {
  CONFIG_DOCUMENT_SCOPE,
  CONFIG_NODE_POLICY,
  CONFIG_REPAIR_ACTION,
} from "../contract/repair.js";
import { migrateConfigFileToCurrentProtocol } from "./migration.js";
import { isPlainObject } from "../utils.js";
import {
  CONFIG_STRUCTURE,
  CONFIG_STRUCTURE_KIND,
  CONFIG_STRUCTURE_PLACEHOLDER,
  listStructureModelReferences,
  structureAllowsScope,
} from "../contract/config-structure.js";
import { createConfigValueSource } from "../contract/config-values.js";

const REMOVE_NODE = Symbol("remove_config_node");
const VALID_SCOPES = new Set(Object.values(CONFIG_DOCUMENT_SCOPE));

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function pathText(path) {
  return path.length ? path.join(".") : "$";
}

function validatesScalarType(value, contract = {}) {
  const type = contract.type;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isPlainObject(value);
  if (type === "number" && (typeof value !== "number" || !Number.isFinite(value))) return false;
  if (type === "integer" && !Number.isInteger(value)) return false;
  if (!["number", "integer"].includes(type) && typeof value !== type) return false;
  return true;
}

function validatesScalar(value, contract = {}) {
  if (!validatesScalarType(value, contract)) return false;
  const type = contract.type;
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

function repairContractNode({
  contract,
  template,
  valueTemplate = template,
  target,
  path,
  changes,
  normalizationFallback = {},
}) {
  if (target === undefined) {
    if (valueTemplate === undefined) return REMOVE_NODE;
    recordChange(changes, path, CONFIG_REPAIR_ACTION.ADD_DEFAULT, "missing_defaulted_node");
    return clone(valueTemplate);
  }
  if (Array.isArray(contract.oneOf)) {
    const variant = contract.oneOf.find((item) => validatesContract(target, item));
    if (!variant) {
      return repairInvalidNode({
        template: valueTemplate,
        path,
        changes,
        reason: "invalid_node_value",
      });
    }
    return repairContractNode({
      contract: variant,
      template,
      valueTemplate,
      target,
      path,
      changes,
    });
  }
  if (!validatesScalar(target, contract)) {
    return repairInvalidNode({
      template: valueTemplate,
      path,
      changes,
      reason: "invalid_node_value",
    });
  }
  if (contract.type === "array") {
    if (!contract.items || target.every((item) => validatesContract(item, contract.items))) {
      return clone(target);
    }
    return repairInvalidNode({
      template: valueTemplate,
      path,
      changes,
      reason: "invalid_array_item",
    });
  }
  if (contract.type !== "object") return clone(target);

  const output = {};
  const templateObject = isPlainObject(template) ? template : {};
  const valueObject = isPlainObject(valueTemplate) ? valueTemplate : {};
  const properties = isPlainObject(contract.properties) ? contract.properties : {};
  for (const [key, childContract] of Object.entries(properties)) {
    const child = repairContractNode({
      contract: childContract,
      template: templateObject[key],
      valueTemplate: valueObject[key],
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
        valueTemplate: valueObject[key],
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
  // A node's declared facts layer config over its template, then over the
  // library default, so repair always resolves to one declared answer instead
  // of inventing a value of its own.
  const shouldNormalizeModel =
    contract !== MODEL_PROVIDER_CONFIG_CONTRACT ||
    Object.keys({ ...templateObject, ...valueObject, ...output }).some((key) =>
      key.startsWith("reasoning_effort"),
    );
  const normalized =
    shouldNormalizeModel && typeof contract.normalize === "function"
      ? contract.normalize(output, {
          ...(contract === MODEL_PROVIDER_CONFIG_CONTRACT
            ? resolveDefaultModelLibraryProvider()
            : {}),
          ...normalizationFallback,
          ...valueObject,
        })
      : output;
  for (const [key, value] of Object.entries(normalized)) {
    if (JSON.stringify(output[key]) === JSON.stringify(value)) continue;
    output[key] = clone(value);
    recordChange(
      changes,
      [...path, key],
      CONFIG_REPAIR_ACTION.RESET_TO_DEFAULT,
      "normalized_contract_value",
    );
  }
  return output;
}

/**
 * Repair one node against the STRUCTURE contract. Structure decides what may
 * exist; the value source decides what stands in when the target's own value is
 * missing or invalid. Neither role is ever taken from the other.
 */
function repairStructureNode({ node, target, path, values, scope, changes }) {
  if (!structureAllowsScope(node, scope)) {
    if (target !== undefined) {
      recordChange(changes, path, CONFIG_REPAIR_ACTION.REMOVE_SCOPE_FORBIDDEN, "scope_forbidden");
    }
    return REMOVE_NODE;
  }
  const optional = node.policy === CONFIG_NODE_POLICY.USER_OPTIONAL;

  // A provider entry's fields belong to the model protocol, so its own contract
  // walker owns the entry and the model library owns its values.
  if (node.delegatedContract) {
    const providerValues = values.resolveProviderValues(path.at(-1));
    return repairContractNode({
      contract: node.delegatedContract,
      template: providerValues,
      valueTemplate: providerValues,
      target,
      path,
      changes,
    });
  }

  if (target === undefined) {
    if (optional) return REMOVE_NODE;
    if (!values.has(path)) return REMOVE_NODE;
    recordChange(changes, path, CONFIG_REPAIR_ACTION.ADD_DEFAULT, "missing_defaulted_node");
    return clone(values.resolve(path));
  }

  if (node.kind === CONFIG_STRUCTURE_KIND.COLLECTION) {
    if (!isPlainObject(target)) return resetFromValues({ path, values, changes, optional });
    const output = {};
    for (const [key, entryTarget] of Object.entries(target)) {
      const repaired = repairStructureNode({
        node: node.entry,
        target: entryTarget,
        path: [...path, key],
        values,
        scope,
        changes,
      });
      if (repaired !== REMOVE_NODE) output[key] = repaired;
    }
    // Entries the value source declares are restored when absent, so a
    // collection never silently loses a shipped entry.
    for (const key of collectionValueKeys({ node, path, values })) {
      if (Object.prototype.hasOwnProperty.call(output, key)) continue;
      const repaired = repairStructureNode({
        node: node.entry,
        target: undefined,
        path: [...path, key],
        values,
        scope,
        changes,
      });
      if (repaired !== REMOVE_NODE) output[key] = repaired;
    }
    return output;
  }

  if (node.kind === CONFIG_STRUCTURE_KIND.OBJECT) {
    if (!isPlainObject(target)) return resetFromValues({ path, values, changes, optional });
    if (node.open) return clone(target);
    const output = {};
    for (const [key, child] of Object.entries(node.fields)) {
      const repaired = repairStructureNode({
        node: child,
        target: target[key],
        path: [...path, key],
        values,
        scope,
        changes,
      });
      if (repaired !== REMOVE_NODE) output[key] = repaired;
    }
    for (const key of Object.keys(target)) {
      if (Object.prototype.hasOwnProperty.call(output, key)) continue;
      if (node.fields[key]) continue;
      recordChange(
        changes,
        [...path, key],
        CONFIG_REPAIR_ACTION.REMOVE_UNSUPPORTED,
        "unsupported_node",
      );
    }
    for (const key of node.requiredFields || []) {
      if (!Object.prototype.hasOwnProperty.call(output, key)) return REMOVE_NODE;
    }
    return output;
  }

  if (!validatesStructureLeaf(target, node)) {
    return resetFromValues({
      path,
      values,
      changes,
      optional,
      reason: validatesStructureLeafType(target, node) ? "invalid_node_value" : "invalid_node_type",
    });
  }
  return clone(target);
}

function resetFromValues({ path, values, changes, optional, reason = "invalid_node_value" }) {
  if (!values.has(path)) {
    recordChange(changes, path, CONFIG_REPAIR_ACTION.REMOVE_INVALID_OPTIONAL, reason);
    return REMOVE_NODE;
  }
  recordChange(changes, path, CONFIG_REPAIR_ACTION.RESET_TO_DEFAULT, reason);
  return clone(values.resolve(path));
}

function collectionValueKeys({ node, path, values }) {
  if (pathText(path) === "providers") return values.listProviderAliases();
  const declared = values.has(path) ? values.resolve(path) : null;
  return isPlainObject(declared) ? Object.keys(declared) : [];
}

function validatesStructureLeafType(value, node) {
  const { kind } = node;
  if (kind === CONFIG_STRUCTURE_KIND.ARRAY) {
    if (!Array.isArray(value)) return false;
    return node.item ? value.every((item) => validatesStructureLeaf(item, node.item)) : true;
  }
  if (kind === CONFIG_STRUCTURE_KIND.OBJECT) {
    if (!isPlainObject(value)) return false;
    if (node.open || node.delegatedContract) return true;
    return Object.entries(node.fields).every(
      ([key, child]) => value[key] === undefined || validatesStructureLeaf(value[key], child),
    );
  }
  if (kind === CONFIG_STRUCTURE_KIND.INTEGER) return Number.isInteger(value);
  if (kind === CONFIG_STRUCTURE_KIND.NUMBER)
    return typeof value === "number" && Number.isFinite(value);
  return typeof value === kind;
}

function validatesStructureLeaf(value, node) {
  const { kind } = node;
  if (!validatesStructureLeafType(value, node)) return false;
  if (kind === CONFIG_STRUCTURE_KIND.STRING && node.nonEmpty && !value.trim()) return false;
  if (Array.isArray(node.values) && !node.values.includes(value)) return false;
  if (typeof value === "number" && node.minimum !== undefined && value < node.minimum) return false;
  if (typeof value === "number" && node.maximum !== undefined && value > node.maximum) return false;
  return true;
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

function restoreProviderReferenceDefaults({ document, values, alias, requirement, changes }) {
  const provider = document.providers?.[alias];
  const providerTemplate = values.resolveProviderValues(alias);
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

/**
 * Expand the structure's declared model references onto this document, so a
 * reference path exists once in the contract rather than twice in code.
 */
function collectReferenceRules(document) {
  const rules = [];
  for (const { path, requirement } of listStructureModelReferences()) {
    const placeholderIndex = path.indexOf(CONFIG_STRUCTURE_PLACEHOLDER);
    if (placeholderIndex < 0) {
      // A collection declared as a reference has model aliases for values.
      const node = valueAt(document, path);
      if (isPlainObject(node)) {
        for (const key of Object.keys(node)) rules.push({ path: [...path, key], requirement });
        continue;
      }
      rules.push({ path: [...path], requirement });
      continue;
    }
    const parentPath = path.slice(0, placeholderIndex);
    const suffix = path.slice(placeholderIndex + 1);
    const parent = valueAt(document, parentPath);
    if (!isPlainObject(parent)) continue;
    for (const key of Object.keys(parent)) {
      rules.push({ path: [...parentPath, key, ...suffix], requirement });
    }
  }
  return rules;
}

function repairModelReferences(document, values, changes) {
  const providers = isPlainObject(document.providers) ? document.providers : {};
  for (const rule of collectReferenceRules(document)) {
    const alias = valueAt(document, rule.path);
    if (typeof alias !== "string" || !alias) continue;
    if (providerSupportsReference(providers[alias], rule.requirement)) continue;
    const fallback = values.resolve(rule.path);
    if (typeof fallback !== "string" || !fallback) {
      throw new TypeError(`config value source has no model reference at ${pathText(rule.path)}`);
    }
    restoreProviderReferenceDefaults({
      document,
      values,
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
  // `template` is retained as a compatibility alias for callers of the
  // original protocol.  It is deliberately folded into the value source;
  // structure is still always CONFIG_STRUCTURE.
  baseValues = undefined,
  template = undefined,
  // These two names were used by the early structural/value split prototype.
  // Accepting them keeps the protocol migration lossless without making them
  // part of the structure authority.
  structureTemplate = undefined,
  valueTemplate = undefined,
  overrideValues = null,
  target = {},
} = {}) {
  if (!VALID_SCOPES.has(scope)) throw new TypeError(`unsupported config document scope: ${scope}`);
  const suppliedBaseValues =
    baseValues !== undefined
      ? baseValues
      : valueTemplate !== undefined
        ? valueTemplate
        : template !== undefined
          ? template
          : {};
  if (!isPlainObject(suppliedBaseValues)) {
    throw new TypeError("config repair baseValues must be an object");
  }
  const sourceTarget = isPlainObject(target) ? target : {};
  const currentTarget = migrateConfigFileToCurrentProtocol(sourceTarget);
  const changes = [];
  if (!isPlainObject(target)) {
    recordChange(changes, [], CONFIG_REPAIR_ACTION.RESET_TO_DEFAULT, "invalid_document_type");
  }
  if (JSON.stringify(sourceTarget) !== JSON.stringify(currentTarget)) {
    recordChange(changes, [], CONFIG_REPAIR_ACTION.MIGRATE_PROTOCOL, "outdated_protocol");
  }
  const values = createConfigValueSource({
    baseValues: migrateConfigFileToCurrentProtocol(suppliedBaseValues),
    overrideValues: isPlainObject(overrideValues)
      ? migrateConfigFileToCurrentProtocol(overrideValues)
      : null,
  });
  const document = repairStructureNode({
    node: CONFIG_STRUCTURE,
    target: clone(currentTarget),
    path: [],
    values,
    scope,
    changes,
  });
  repairModelReferences(document === REMOVE_NODE ? {} : document, values, changes);
  return Object.freeze({
    document: document === REMOVE_NODE ? {} : document,
    report: Object.freeze({ changed: changes.length > 0, changes: Object.freeze(changes) }),
  });
}
