/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject, text } from "@noobot/shared/value";

const CONNECTOR_FIELD_KINDS = new Set(["text", "number", "boolean", "workspace_path"]);
const CONNECTOR_IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export const connectorField = (
  name,
  { required = false, secret = false, kind = "text", defaultValue } = {},
) => {
  const normalizedName = text(name);
  const normalizedKind = text(kind);
  if (!normalizedName) throw new TypeError("connector field name is required");
  if (!CONNECTOR_FIELD_KINDS.has(normalizedKind)) {
    throw new TypeError(`connector field kind is invalid: ${normalizedKind}`);
  }
  return Object.freeze({
    name: normalizedName,
    required,
    secret,
    kind: normalizedKind,
    ...(defaultValue === undefined ? {} : { defaultValue }),
  });
};

export function connectorOperation(
  name,
  { description = "", inputSchema = { type: "object", properties: {} } } = {},
) {
  const normalizedName = text(name);
  const normalizedDescription = text(description);
  if (!CONNECTOR_IDENTIFIER_PATTERN.test(normalizedName)) {
    throw new TypeError(`connector operation name is invalid: ${normalizedName}`);
  }
  if (!normalizedDescription) {
    throw new TypeError(`connector operation description is required: ${normalizedName}`);
  }
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
    throw new TypeError(`connector operation inputSchema is invalid: ${normalizedName}`);
  }
  if (inputSchema.type !== "object") {
    throw new TypeError(
      `connector operation inputSchema must describe an object: ${normalizedName}`,
    );
  }
  return Object.freeze({
    name: normalizedName,
    description: normalizedDescription,
    inputSchema: Object.freeze(structuredClone(inputSchema)),
  });
}

function normalizeConnectorType(value = "") {
  const normalized = text(value);
  return CONNECTOR_IDENTIFIER_PATTERN.test(normalized) ? normalized : "";
}

export function createConnectorInstanceDefinition(input = {}) {
  const instanceType = text(input.instanceType);
  const type = normalizeConnectorType(input.type);
  const subType = normalizeConnectorType(input.subType);
  if (!instanceType || !type || !subType) {
    throw new TypeError("connector instanceType, type and subType are required");
  }
  const operations = (input.operations || []).map((item) =>
    connectorOperation(item?.name, {
      description: item?.description,
      inputSchema: item?.inputSchema,
    }),
  );
  if (!operations.length) throw new TypeError("connector instance operations are required");
  const operationNames = operations.map((item) => item.name);
  if (new Set(operationNames).size !== operationNames.length) {
    throw new TypeError("connector instance operations must have unique names");
  }
  const fields = [...(input.fields || [])].map((item) => connectorField(item?.name, item));
  const fieldNames = fields.map((item) => text(item?.name));
  if (fieldNames.some((name) => !name) || new Set(fieldNames).size !== fieldNames.length) {
    throw new TypeError("connector instance fields must have unique names");
  }
  return Object.freeze({
    instanceType,
    type,
    subType,
    displayName: String(input.displayName || subType).trim(),
    fields: Object.freeze(fields),
    operations: Object.freeze(operations),
  });
}

export function normalizeConnectorParameters(definition, parameters = {}) {
  if (!definition) throw new TypeError("connector definition is required");
  const source = isPlainObject(parameters) ? parameters : {};
  const normalized = {};
  for (const definitionField of definition.fields) {
    const rawValue = source[definitionField.name] ?? definitionField.defaultValue;
    if (rawValue === undefined || rawValue === null || rawValue === "") {
      if (definitionField.required)
        throw new TypeError(`connector parameter is required: ${definitionField.name}`);
      continue;
    }
    if (definitionField.kind === "number") {
      const numberValue = Number(rawValue);
      if (!Number.isFinite(numberValue) || numberValue <= 0)
        throw new TypeError(
          `connector parameter must be a positive number: ${definitionField.name}`,
        );
      normalized[definitionField.name] = numberValue;
    } else if (definitionField.kind === "boolean") {
      normalized[definitionField.name] = rawValue === true || rawValue === "true";
    } else {
      normalized[definitionField.name] = definitionField.secret
        ? String(rawValue)
        : String(rawValue).trim();
    }
  }
  return Object.freeze(normalized);
}

export function projectConnectorInstanceDefinition(definition = {}) {
  return Object.freeze({
    instanceType: text(definition.instanceType),
    type: normalizeConnectorType(definition.type),
    subType: text(definition.subType),
    displayName: text(definition.displayName),
    fields: Object.freeze([...(definition.fields || [])]),
    operations: Object.freeze([...(definition.operations || [])]),
  });
}
