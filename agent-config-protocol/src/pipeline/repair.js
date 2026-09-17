/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_PROVIDER_CONFIG_CONTRACT } from "@noobot/model-protocol";
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

function validatesScalar(value, contract = {}, enforceValueConstraints = true) {
  if (!validatesScalarType(value, contract)) return false;
  if (!enforceValueConstraints) return true;
  const type = contract.type;
  if (type === "string" && contract.nonEmpty && !value.trim()) return false;
  if (Array.isArray(contract.values) && !contract.values.includes(value)) return false;
  if (typeof value === "number" && contract.minimum !== undefined && value < contract.minimum)
    return false;
  if (typeof value === "number" && contract.maximum !== undefined && value > contract.maximum)
    return false;
  return true;
}

function validatesContract(value, contract = {}, enforceValueConstraints = true) {
  if (Array.isArray(contract.oneOf)) {
    return contract.oneOf.some((variant) =>
      validatesContract(value, variant, enforceValueConstraints),
    );
  }
  if (!validatesScalar(value, contract, enforceValueConstraints)) return false;
  if (contract.type === "array" && contract.items) {
    return value.every((item) => validatesContract(item, contract.items, enforceValueConstraints));
  }
  if (contract.type !== "object") return true;
  const properties = isPlainObject(contract.properties) ? contract.properties : {};
  for (const key of contract.required || []) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
    if (!validatesContract(value[key], properties[key], enforceValueConstraints)) return false;
  }
  for (const [key, child] of Object.entries(value)) {
    if (properties[key]) {
      if (!validatesContract(child, properties[key], enforceValueConstraints)) return false;
      continue;
    }
    if (contract.additionalProperties === true) continue;
    if (!isPlainObject(contract.additionalProperties)) return false;
    if (!validatesContract(child, contract.additionalProperties, enforceValueConstraints))
      return false;
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

function repairDeclaredContractProperties({
  contract,
  properties,
  templateObject,
  valueObject,
  target,
  path,
  changes,
  scope,
  enforceValueConstraints,
}) {
  const output = {};
  for (const [key, childContract] of Object.entries(properties)) {
    const child = repairContractNode({
      contract: childContract,
      template: templateObject[key],
      valueTemplate: valueObject[key],
      target: target[key],
      path: [...path, key],
      changes,
      scope,
      enforceValueConstraints,
    });
    if (child !== REMOVE_NODE) output[key] = child;
  }
  return output;
}

function repairTemplateAdditionalProperties({
  contract,
  properties,
  templateObject,
  valueObject,
  target,
  output,
  path,
  changes,
  scope,
  enforceValueConstraints,
}) {
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
        scope,
        enforceValueConstraints,
      });
      if (repaired !== REMOVE_NODE) output[key] = repaired;
      continue;
    }
    throw new TypeError(
      `config value source contains unsupported node: ${pathText([...path, key])}`,
    );
  }
}

function repairTargetAdditionalProperties({
  contract,
  properties,
  target,
  output,
  path,
  changes,
  scope,
  enforceValueConstraints,
}) {
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
        scope,
        enforceValueConstraints,
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
}

function normalizeContractObject({
  contract,
  properties,
  templateObject,
  valueObject,
  output,
  normalizationFallback,
  path,
  changes,
  scope,
  enforceValueConstraints,
}) {
  const isModelProviderContract =
    contract === MODEL_PROVIDER_CONFIG_CONTRACT ||
    contract.agentConfigContract === "model_provider";
  if (isModelProviderContract) {
    if (!enforceValueConstraints) return output;
    for (const [key, childContract] of Object.entries(properties)) {
      const optionsField = childContract.optionsField;
      if (!optionsField || output[key] === undefined) continue;
      const options = Array.isArray(valueObject[optionsField])
        ? valueObject[optionsField]
        : Array.isArray(templateObject[optionsField])
          ? templateObject[optionsField]
          : [];
      if (!options.length || options.includes(output[key])) continue;
      const fallback = options.includes(valueObject[key]) ? valueObject[key] : options[0];
      output[key] = clone(fallback);
      recordChange(
        changes,
        [...path, key],
        CONFIG_REPAIR_ACTION.RESET_TO_DEFAULT,
        "invalid_option_value",
      );
    }
    return output;
  }
  if (typeof contract.normalize !== "function") return output;

  const normalized = contract.normalize(
    { ...templateObject, ...output },
    {
      ...normalizationFallback,
      ...valueObject,
    },
  );
  for (const [key, value] of Object.entries(normalized)) {
    const childContract = properties[key];
    if (childContract && !structureAllowsScope(childContract, scope)) continue;
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

function repairContractNode({
  contract,
  template,
  valueTemplate = template,
  target,
  path,
  changes,
  normalizationFallback = {},
  scope = CONFIG_DOCUMENT_SCOPE.GLOBAL,
  enforceValueConstraints = true,
}) {
  if (!structureAllowsScope(contract, scope)) {
    if (target !== undefined) {
      recordChange(changes, path, CONFIG_REPAIR_ACTION.REMOVE_SCOPE_FORBIDDEN, "scope_forbidden");
    }
    return REMOVE_NODE;
  }
  if (target === undefined) {
    if (valueTemplate === undefined) return REMOVE_NODE;
    recordChange(changes, path, CONFIG_REPAIR_ACTION.ADD_DEFAULT, "missing_defaulted_node");
    return clone(valueTemplate);
  }
  if (Array.isArray(contract.oneOf)) {
    const variant = contract.oneOf.find((item) =>
      validatesContract(target, item, enforceValueConstraints),
    );
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
      scope,
      enforceValueConstraints,
    });
  }
  if (!validatesScalar(target, contract, enforceValueConstraints)) {
    return repairInvalidNode({
      template: valueTemplate,
      path,
      changes,
      reason: "invalid_node_value",
    });
  }
  if (contract.type === "array") {
    if (
      !contract.items ||
      target.every((item) => validatesContract(item, contract.items, enforceValueConstraints))
    ) {
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

  const templateObject = isPlainObject(template) ? template : {};
  const valueObject = isPlainObject(valueTemplate) ? valueTemplate : {};
  const properties = isPlainObject(contract.properties) ? contract.properties : {};
  const repairContext = {
    contract,
    properties,
    templateObject,
    valueObject,
    target,
    path,
    changes,
    scope,
    enforceValueConstraints,
  };
  const output = repairDeclaredContractProperties(repairContext);
  repairTemplateAdditionalProperties({ ...repairContext, output });
  repairTargetAdditionalProperties({ ...repairContext, output });
  return normalizeContractObject({
    ...repairContext,
    output,
    normalizationFallback,
  });
}

function repairStructureNode({ node, target, path, values, scope, changes }) {
  if (!structureAllowsScope(node, scope)) {
    if (target !== undefined) {
      recordChange(changes, path, CONFIG_REPAIR_ACTION.REMOVE_SCOPE_FORBIDDEN, "scope_forbidden");
    }
    return REMOVE_NODE;
  }
  const optional = node.policy === CONFIG_NODE_POLICY.USER_OPTIONAL;

  if (node.delegatedContract) {
    const providerValues = values.resolveProviderValues(path.at(-1));
    return repairContractNode({
      contract: node.delegatedContract,
      template: providerValues.template,
      valueTemplate: providerValues.template,
      target,
      path,
      changes,
      scope,
      enforceValueConstraints: providerValues.exactLibraryMatch,
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

function providerReferenceExists(provider) {
  return (
    isPlainObject(provider) && typeof provider.model === "string" && Boolean(provider.model.trim())
  );
}

function collectReferenceRules(document) {
  const rules = [];
  for (const { path, requirement } of listStructureModelReferences()) {
    const placeholderIndex = path.indexOf(CONFIG_STRUCTURE_PLACEHOLDER);
    if (placeholderIndex < 0) {
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
    if (providerReferenceExists(providers[alias])) continue;
    const fallback = values.resolve(rule.path);
    if (typeof fallback !== "string" || !fallback) {
      throw new TypeError(`config value source has no model reference at ${pathText(rule.path)}`);
    }
    if (!providerReferenceExists(providers[fallback])) {
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
  baseValues = {},
  target = {},
} = {}) {
  if (!VALID_SCOPES.has(scope)) throw new TypeError(`unsupported config document scope: ${scope}`);
  if (!isPlainObject(baseValues)) {
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
    baseValues: migrateConfigFileToCurrentProtocol(baseValues),
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
