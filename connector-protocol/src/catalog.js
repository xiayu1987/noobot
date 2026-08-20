/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CONNECTOR_TYPE = Object.freeze({
  DATABASE: "database",
  TERMINAL: "terminal",
  EMAIL: "email",
});

const field = (name, { required = false, secret = false, kind = "text", defaultValue } = {}) =>
  Object.freeze({
    name,
    required,
    secret,
    kind,
    ...(defaultValue === undefined ? {} : { defaultValue }),
  });

export const CONNECTOR_CATALOG = Object.freeze([
  Object.freeze({
    type: CONNECTOR_TYPE.DATABASE,
    subType: "mysql",
    fields: Object.freeze([
      field("host", { required: true }),
      field("port", { kind: "number", defaultValue: 3306 }),
      field("username", { required: true }),
      field("password", { required: true, secret: true }),
      field("database", { required: true }),
    ]),
  }),
  Object.freeze({
    type: CONNECTOR_TYPE.DATABASE,
    subType: "postgres",
    fields: Object.freeze([
      field("host", { required: true }),
      field("port", { kind: "number", defaultValue: 5432 }),
      field("username", { required: true }),
      field("password", { required: true, secret: true }),
      field("database", { required: true }),
    ]),
  }),
  Object.freeze({
    type: CONNECTOR_TYPE.DATABASE,
    subType: "sqlite",
    fields: Object.freeze([field("file_path", { required: true, kind: "workspace_path" })]),
  }),
  Object.freeze({
    type: CONNECTOR_TYPE.TERMINAL,
    subType: "ssh",
    fields: Object.freeze([
      field("host", { required: true }),
      field("port", { kind: "number", defaultValue: 22 }),
      field("username", { required: true }),
      field("password", { required: true, secret: true }),
    ]),
  }),
  Object.freeze({
    type: CONNECTOR_TYPE.EMAIL,
    subType: "smtp_imap",
    fields: Object.freeze([
      field("smtp_host", { required: true }),
      field("smtp_port", { kind: "number", defaultValue: 587 }),
      field("smtp_secure", { kind: "boolean", defaultValue: false }),
      field("imap_host", { required: true }),
      field("imap_port", { kind: "number", defaultValue: 993 }),
      field("imap_secure", { kind: "boolean", defaultValue: true }),
      field("username", { required: true }),
      field("password", { required: true, secret: true }),
      field("from_email"),
    ]),
  }),
]);

const catalogIndex = new Map(
  CONNECTOR_CATALOG.map((item) => [`${item.type}:${item.subType}`, item]),
);

export function normalizeConnectorType(value = "") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return Object.values(CONNECTOR_TYPE).includes(normalized) ? normalized : "";
}

export function resolveConnectorDefinition(type = "", subType = "") {
  const normalizedType = normalizeConnectorType(type);
  const normalizedSubType = String(subType || "")
    .trim()
    .toLowerCase();
  return catalogIndex.get(`${normalizedType}:${normalizedSubType}`) || null;
}

export function normalizeConnectorSubType(type = "", subType = "") {
  return resolveConnectorDefinition(type, subType)?.subType || "";
}

export function normalizeConnectorParameters(definition, parameters = {}) {
  if (!definition) throw new TypeError("connector definition is required");
  const source =
    parameters && typeof parameters === "object" && !Array.isArray(parameters) ? parameters : {};
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

export function buildConnectorConnectionInfo({ type = "", subType = "", parameters = {} } = {}) {
  const normalizedType = normalizeConnectorType(type);
  const definition = resolveConnectorDefinition(normalizedType, subType);
  const normalizedParameters = normalizeConnectorParameters(definition, parameters);
  const typeField =
    normalizedType === CONNECTOR_TYPE.DATABASE
      ? "database_type"
      : normalizedType === CONNECTOR_TYPE.TERMINAL
        ? "terminal_type"
        : "email_type";
  return Object.freeze({ ...normalizedParameters, [typeField]: definition.subType });
}
