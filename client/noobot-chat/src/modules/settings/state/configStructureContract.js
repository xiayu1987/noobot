/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  CONFIG_DOCUMENT_SCOPE,
  CONFIG_STRUCTURE,
  CONFIG_STRUCTURE_KIND,
  isConfigNodeUserEditable,
} from "@noobot/agent-config-protocol";
import { MODEL_PROVIDER_CONFIG_VALUE_TYPE } from "@noobot/model-protocol";

export { CONFIG_STRUCTURE_KIND };

export const CONFIG_FORM_NODE_KIND = Object.freeze({
  OBJECT: "object",
  COLLECTION: "collection",
  ARRAY: "array",
  RAW: "raw",
  STRING: "string",
  ENUM: "enum",
  BOOLEAN: "boolean",
  INTEGER: "integer",
  NUMBER: "number",
  STRING_LIST: "string_list",
  ENUM_LIST: "enum_list",
});

const VALUE_TYPE_TO_STRUCTURE_KIND = Object.freeze({
  [MODEL_PROVIDER_CONFIG_VALUE_TYPE.OBJECT]: CONFIG_STRUCTURE_KIND.OBJECT,
  [MODEL_PROVIDER_CONFIG_VALUE_TYPE.ARRAY]: CONFIG_STRUCTURE_KIND.ARRAY,
  [MODEL_PROVIDER_CONFIG_VALUE_TYPE.STRING]: CONFIG_STRUCTURE_KIND.STRING,
  [MODEL_PROVIDER_CONFIG_VALUE_TYPE.BOOLEAN]: CONFIG_STRUCTURE_KIND.BOOLEAN,
  [MODEL_PROVIDER_CONFIG_VALUE_TYPE.INTEGER]: CONFIG_STRUCTURE_KIND.INTEGER,
  [MODEL_PROVIDER_CONFIG_VALUE_TYPE.NUMBER]: CONFIG_STRUCTURE_KIND.NUMBER,
});

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function enumValues(node) {
  return Array.isArray(node?.values) ? node.values.map(String).filter(Boolean) : [];
}

function scalarKind(structureKind, options) {
  if (structureKind === CONFIG_STRUCTURE_KIND.STRING) {
    return options.length ? CONFIG_FORM_NODE_KIND.ENUM : CONFIG_FORM_NODE_KIND.STRING;
  }
  if (structureKind === CONFIG_STRUCTURE_KIND.BOOLEAN) return CONFIG_FORM_NODE_KIND.BOOLEAN;
  if (structureKind === CONFIG_STRUCTURE_KIND.INTEGER) return CONFIG_FORM_NODE_KIND.INTEGER;
  if (structureKind === CONFIG_STRUCTURE_KIND.NUMBER) return CONFIG_FORM_NODE_KIND.NUMBER;
  return CONFIG_FORM_NODE_KIND.RAW;
}

const DELEGATED_META_KEYS = Object.freeze([
  "group",
  "familyScope",
  "itemType",
  "access",
  "scopes",
  "policy",
  "optionsField",
]);

function delegatedMeta(spec) {
  const meta = {};
  for (const key of DELEGATED_META_KEYS) {
    if (spec?.[key] !== undefined) meta[key] = spec[key];
  }
  return meta;
}

function fromDelegatedSpec(spec, inheritedMeta = {}) {
  const structureKind = VALUE_TYPE_TO_STRUCTURE_KIND[spec?.type];
  if (!structureKind) return null;
  const meta = { ...delegatedMeta(spec), ...inheritedMeta };
  if (structureKind === CONFIG_STRUCTURE_KIND.OBJECT) {
    if (!isPlainObject(spec.properties)) {
      return { kind: CONFIG_STRUCTURE_KIND.OBJECT, open: true, ...meta };
    }
    return {
      kind: CONFIG_STRUCTURE_KIND.OBJECT,
      fields: spec.properties,
      requiredFields: Array.isArray(spec.required) ? spec.required : [],
      delegated: true,
      ...meta,
    };
  }
  if (structureKind === CONFIG_STRUCTURE_KIND.ARRAY) {
    return {
      kind: CONFIG_STRUCTURE_KIND.ARRAY,
      item: isPlainObject(spec.items) ? spec.items : {},
      delegated: true,
      ...meta,
    };
  }
  return {
    kind: structureKind,
    values: spec.values,
    nonEmpty: spec.nonEmpty === true,
    minimum: spec.minimum,
    maximum: spec.maximum,
    delegated: true,
    ...meta,
  };
}

function resolveNode(rawNode, delegated) {
  if (!isPlainObject(rawNode)) return null;
  if (delegated) return fromDelegatedSpec(rawNode);
  if (rawNode.delegatedContract) {
    return fromDelegatedSpec(rawNode.delegatedContract, delegatedMeta(rawNode));
  }
  return rawNode;
}

function formNodeBase(node, path, key, required) {
  return {
    path: path.join("."),
    key,
    itemType: node.itemType,
    access: node.access,
    required: required === true,
    group: typeof node.group === "string" ? node.group : "",
    familyScope: Array.isArray(node.familyScope) ? node.familyScope.map(String) : [],
    optionsField: typeof node.optionsField === "string" ? node.optionsField : "",
  };
}

function buildObjectNode(node, context, base) {
  if (node.open || !isPlainObject(node.fields)) {
    return { ...base, kind: CONFIG_FORM_NODE_KIND.RAW };
  }
  const requiredFields = new Set(Array.isArray(node.requiredFields) ? node.requiredFields : []);
  const children = Object.entries(node.fields)
    .map(([childKey, childRaw]) =>
      buildNode({
        rawNode: childRaw,
        path: [...context.path, childKey],
        key: childKey,
        scope: context.scope,
        required: requiredFields.has(childKey),
        delegated: node.delegated === true,
      }),
    )
    .filter(Boolean);
  return children.length ? { ...base, kind: CONFIG_FORM_NODE_KIND.OBJECT, children } : null;
}

function buildCollectionNode(node, context, base) {
  const entry = buildNode({
    rawNode: node.entry,
    path: [...context.path, "*"],
    key: "*",
    scope: context.scope,
    required: false,
    delegated: false,
  });
  return entry ? { ...base, kind: CONFIG_FORM_NODE_KIND.COLLECTION, entry } : null;
}

function buildArrayNode(node, context, base) {
  const itemRaw = node.item ?? node.items;
  const itemNode = resolveNode(itemRaw, node.delegated === true);
  const itemOptions = enumValues(itemNode);
  if (itemNode?.kind === CONFIG_STRUCTURE_KIND.STRING || !itemNode) {
    return {
      ...base,
      kind: itemOptions.length
        ? CONFIG_FORM_NODE_KIND.ENUM_LIST
        : CONFIG_FORM_NODE_KIND.STRING_LIST,
      options: itemOptions,
    };
  }
  const item = buildNode({
    rawNode: itemRaw,
    path: [...context.path, "#"],
    key: "#",
    scope: context.scope,
    required: false,
    delegated: node.delegated === true,
  });
  return item
    ? { ...base, kind: CONFIG_FORM_NODE_KIND.ARRAY, item }
    : { ...base, kind: CONFIG_FORM_NODE_KIND.RAW };
}

function buildScalarNode(node, base) {
  const options = enumValues(node);
  return {
    ...base,
    kind: scalarKind(node.kind, options),
    options,
    nonEmpty: node.nonEmpty === true,
    minimum: typeof node.minimum === "number" ? node.minimum : null,
    maximum: typeof node.maximum === "number" ? node.maximum : null,
    modelReference: typeof node.modelReference === "string" ? node.modelReference : "",
    documentReference: typeof node.documentReference === "string" ? node.documentReference : "",
  };
}

function buildNode(context) {
  const { rawNode, path, key, scope, required, delegated } = context;
  const node = resolveNode(rawNode, delegated);
  if (!node?.kind || (path.length && !isConfigNodeUserEditable(node, scope))) return null;
  const base = formNodeBase(node, path, key, required);
  if (node.kind === CONFIG_STRUCTURE_KIND.OBJECT) return buildObjectNode(node, context, base);
  if (node.kind === CONFIG_STRUCTURE_KIND.COLLECTION)
    return buildCollectionNode(node, context, base);
  if (node.kind === CONFIG_STRUCTURE_KIND.ARRAY) return buildArrayNode(node, context, base);
  return buildScalarNode(node, base);
}

export function buildConfigFormTree(scope = CONFIG_DOCUMENT_SCOPE.USER) {
  return buildNode({
    rawNode: CONFIG_STRUCTURE,
    path: [],
    key: "",
    scope,
    required: false,
    delegated: false,
  });
}

export const USER_CONFIG_FORM_TREE = Object.freeze(buildConfigFormTree(CONFIG_DOCUMENT_SCOPE.USER));

export const USER_CONFIG_SECTIONS = Object.freeze(
  (USER_CONFIG_FORM_TREE?.children || []).map((child) => Object.freeze(child)),
);
