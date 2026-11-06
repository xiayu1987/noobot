/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  CONFIG_DOCUMENT_SCOPE,
  CONFIG_NODE_POLICY,
  CONFIG_REPAIR_ACTION,
} from "../contract/repair.js";
import { migrateConfigFileToCurrentProtocol } from "./migration.js";
import { isPlainObject, setConfigOwnProperty } from "../utils.js";
import {
  CONFIG_STRUCTURE,
  CONFIG_STRUCTURE_KIND,
  CONFIG_STRUCTURE_PLACEHOLDER,
  listStructureModelReferences,
  structureAllowsScope,
} from "../contract/config-structure.js";
import { createConfigValueSource } from "../contract/config-values.js";
import { requireToolBindingConfig } from "@noobot/model-protocol";

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
  return validatesObjectContract(value, contract, enforceValueConstraints);
}

function validatesObjectContract(value, contract, enforceValueConstraints) {
  const properties = isPlainObject(contract.properties) ? contract.properties : {};
  for (const key of contract.required || []) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
    if (!validatesContract(value[key], properties[key], enforceValueConstraints)) return false;
  }
  for (const [key, child] of Object.entries(value)) {
    const childContract = Object.hasOwn(properties, key) ? properties[key] : undefined;
    if (childContract && !validatesContract(child, childContract, enforceValueConstraints))
      return false;
    if (childContract) continue;
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
    if (child !== REMOVE_NODE) setConfigOwnProperty(output, key, child);
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
    if (Object.hasOwn(properties, key)) continue;
    if (contract.additionalProperties === true) {
      setConfigOwnProperty(
        output,
        key,
        repairOpenProperty({ target, key, template: child, path, changes }),
      );
      continue;
    }
    if (!isPlainObject(contract.additionalProperties)) {
      throw new TypeError(
        `config value source contains unsupported node: ${pathText([...path, key])}`,
      );
    }
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
    if (repaired !== REMOVE_NODE) setConfigOwnProperty(output, key, repaired);
  }
}

function repairOpenProperty({ target, key, template, path, changes }) {
  if (Object.prototype.hasOwnProperty.call(target, key)) return clone(target[key]);
  recordChange(changes, [...path, key], CONFIG_REPAIR_ACTION.ADD_DEFAULT, "missing_defaulted_node");
  return clone(template);
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
    if (Object.hasOwn(properties, key) || Object.hasOwn(output, key)) continue;
    if (contract.additionalProperties === true) {
      setConfigOwnProperty(output, key, clone(child));
      continue;
    }
    if (!isPlainObject(contract.additionalProperties)) {
      recordChange(
        changes,
        [...path, key],
        CONFIG_REPAIR_ACTION.REMOVE_UNSUPPORTED,
        "unsupported_node",
      );
      continue;
    }
    const repaired = repairContractNode({
      contract: contract.additionalProperties,
      target: child,
      path: [...path, key],
      changes,
      scope,
      enforceValueConstraints,
    });
    if (repaired !== REMOVE_NODE) setConfigOwnProperty(output, key, repaired);
  }
}

function repairModelProviderOptions({
  contract,
  properties,
  valueObject,
  output,
  path,
  changes,
  enforceValueConstraints,
}) {
  if (contract.agentConfigContract !== "model_provider" || !enforceValueConstraints) return output;
  for (const [key, childContract] of Object.entries(properties)) {
    const optionsField = childContract.optionsField;
    if (!optionsField || output[key] === undefined) continue;
    const options = valueObject[optionsField];
    if (!Array.isArray(options)) {
      throw new TypeError(`model provider ${pathText(path)} requires ${optionsField} array`);
    }
    if (!options.length || options.includes(output[key])) continue;
    const fallback = options.includes(valueObject[key]) ? valueObject[key] : options[0];
    setConfigOwnProperty(output, key, clone(fallback));
    recordChange(
      changes,
      [...path, key],
      CONFIG_REPAIR_ACTION.RESET_TO_DEFAULT,
      "invalid_option_value",
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
    if (contract.type !== "object" || !isPlainObject(valueTemplate)) return clone(valueTemplate);
    return repairContractNode({
      contract,
      template,
      valueTemplate,
      target: {},
      path,
      changes,
      scope,
      enforceValueConstraints,
    });
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
  return repairModelProviderOptions({ ...repairContext, output });
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
    const declared = target === undefined && values.has(path) ? values.resolve(path) : undefined;
    if (declared !== undefined) {
      recordChange(changes, path, CONFIG_REPAIR_ACTION.ADD_DEFAULT, "missing_defaulted_node");
    }
    return repairContractNode({
      contract: node.delegatedContract,
      template: providerValues.template,
      valueTemplate: providerValues.template,
      target: declared === undefined ? target : clone(declared),
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
    return materializeFromValues({ node, path, values, scope, changes });
  }

  if (node.kind === CONFIG_STRUCTURE_KIND.COLLECTION) {
    if (!isPlainObject(target)) {
      return resetFromValues({ node, path, values, scope, changes });
    }
    return repairStructureCollection({ node, target, path, values, scope, changes });
  }

  if (node.kind === CONFIG_STRUCTURE_KIND.OBJECT) {
    if (!isPlainObject(target)) {
      return resetFromValues({ node, path, values, scope, changes });
    }
    if (node.open) return clone(target);
    return repairStructureObject({ node, target, path, values, scope, changes });
  }

  if (!validatesStructureLeaf(target, node)) {
    return resetFromValues({
      node,
      path,
      values,
      scope,
      changes,
      reason: validatesStructureLeafType(target, node) ? "invalid_node_value" : "invalid_node_type",
    });
  }
  return clone(target);
}

function repairStructureCollection({ node, target, path, values, scope, changes }) {
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
    if (repaired !== REMOVE_NODE) setConfigOwnProperty(output, key, repaired);
  }
  for (const key of collectionValueKeys({ path, values })) {
    if (Object.prototype.hasOwnProperty.call(output, key)) continue;
    const repaired = repairStructureNode({
      node: node.entry,
      target: undefined,
      path: [...path, key],
      values,
      scope,
      changes,
    });
    if (repaired !== REMOVE_NODE) setConfigOwnProperty(output, key, repaired);
  }
  return output;
}

function repairStructureObject({ node, target, path, values, scope, changes }) {
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
    if (repaired !== REMOVE_NODE) setConfigOwnProperty(output, key, repaired);
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

function isStructuredNode(node) {
  if (node.kind === CONFIG_STRUCTURE_KIND.COLLECTION) return true;
  return node.kind === CONFIG_STRUCTURE_KIND.OBJECT && !node.open;
}

function materializeFromValues({ node, path, values, scope, changes }) {
  if (!isStructuredNode(node)) return clone(values.resolve(path));
  if (pathText(path) === "providers") {
    return repairStructureNode({
      node,
      target: clone(values.resolve(path)),
      path,
      values,
      scope,
      changes,
    });
  }
  return repairStructureNode({ node, target: {}, path, values, scope, changes });
}

function resetFromValues({ node, path, values, scope, changes, reason = "invalid_node_value" }) {
  if (!values.has(path)) {
    recordChange(changes, path, CONFIG_REPAIR_ACTION.REMOVE_INVALID_OPTIONAL, reason);
    return REMOVE_NODE;
  }
  recordChange(changes, path, CONFIG_REPAIR_ACTION.RESET_TO_DEFAULT, reason);
  return materializeFromValues({ node, path, values, scope, changes });
}

function collectionValueKeys({ path, values }) {
  if (pathText(path) === "providers") return [];
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

function expandReferencePaths(document, { path }) {
  const placeholderIndex = path.indexOf(CONFIG_STRUCTURE_PLACEHOLDER);
  if (placeholderIndex >= 0) {
    const parentPath = path.slice(0, placeholderIndex);
    const parent = valueAt(document, parentPath);
    if (!isPlainObject(parent)) return [];
    const suffix = path.slice(placeholderIndex + 1);
    return Object.keys(parent).map((key) => [...parentPath, key, ...suffix]);
  }
  const node = valueAt(document, path);
  if (!isPlainObject(node)) return [[...path]];
  return Object.keys(node).map((key) => [...path, key]);
}

function collectReferencePaths(document) {
  return listStructureModelReferences().flatMap((rule) => expandReferencePaths(document, rule));
}

function repairModelReferences(document, values, changes, scope) {
  const providers = {
    ...(scope === CONFIG_DOCUMENT_SCOPE.USER ? values.resolve(["providers"]) : {}),
    ...document.providers,
  };
  for (const path of collectReferencePaths(document)) {
    const alias = valueAt(document, path);
    if (typeof alias !== "string" || !alias) continue;
    if (providerReferenceExists(providers[alias])) continue;
    const fallback = values.resolve(path);
    if (typeof fallback !== "string" || !fallback) {
      throw new TypeError(`config value source has no model reference at ${pathText(path)}`);
    }
    if (!providerReferenceExists(providers[fallback])) {
      throw new TypeError(`config repair cannot restore model reference at ${pathText(path)}`);
    }
    setValueAt(document, path, fallback);
    recordChange(changes, path, CONFIG_REPAIR_ACTION.RESET_TO_DEFAULT, "invalid_model_reference");
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
  requireToolBindingConfig(baseValues.tools?.bindings);
  const sourceTarget = isPlainObject(target) ? target : {};
  requireToolBindingConfig(sourceTarget.tools?.bindings);
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
  repairModelReferences(document === REMOVE_NODE ? {} : document, values, changes, scope);
  return Object.freeze({
    document: document === REMOVE_NODE ? {} : document,
    report: Object.freeze({ changed: changes.length > 0, changes: Object.freeze(changes) }),
  });
}
