/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BACKEND_I18N } from "../../../i18n/backend-messages.js";
import { pickToolText } from "../../core/tool-i18n.js";
import { ConnectorType } from "../../constants/index.js";

function tConnectorField(locale = "zh-CN", key = "", params = {}) {
  return pickToolText({
    locale,
    dict: BACKEND_I18N,
    key: `connectors.fields.${String(key || "").trim()}`,
    params,
  });
}

function pickObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseOptionalObjectInput(inputValue = {}) {
  const source =
    typeof inputValue === "string"
      ? (() => {
          try {
            return JSON.parse(inputValue || "{}");
          } catch {
            return {};
          }
        })()
      : pickObject(inputValue);
  return pickObject(source);
}

function normalizeProvidedDefaults(defaultValuesInput = {}, allowedKeys = []) {
  const source = parseOptionalObjectInput(defaultValuesInput);
  const allowedKeySet = new Set(
    (Array.isArray(allowedKeys) ? allowedKeys : [])
      .map((key) => String(key || "").trim())
      .filter(Boolean),
  );
  const normalizedDefaults = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = String(rawKey || "").trim();
    if (!key || !allowedKeySet.has(key)) continue;
    if (key.toLowerCase() === "password") continue;
    const value = String(rawValue ?? "").trim();
    if (!value) continue;
    normalizedDefaults[key] = value;
  }
  return normalizedDefaults;
}

function databaseFields(databaseType = "", locale = "zh-CN") {
  if (databaseType === ConnectorType.DATABASE_ENGINE.SQLITE) {
    return [
      {
        name: "file_path",
        displayName: tConnectorField(locale, "sqliteFilePath"),
        required: true,
      },
    ];
  }
  return [
    { name: "host", displayName: tConnectorField(locale, "host"), required: true },
    { name: "port", displayName: tConnectorField(locale, "port"), required: false },
    {
      name: "username",
      displayName: tConnectorField(locale, "username"),
      required: true,
    },
    {
      name: "password",
      displayName: tConnectorField(locale, "password"),
      required: true,
    },
    {
      name: "database",
      displayName: tConnectorField(locale, "database"),
      required: true,
    },
  ];
}

function terminalFields(terminalType = "", locale = "zh-CN") {
  if (terminalType !== ConnectorType.TERMINAL_PROTOCOL.SSH) return [];
  return [
    {
      name: "host",
      displayName: tConnectorField(locale, "serverIpOrDomain"),
      required: true,
    },
    {
      name: "port",
      displayName: tConnectorField(locale, "portDefault22"),
      required: false,
    },
    {
      name: "username",
      displayName: tConnectorField(locale, "username"),
      required: true,
    },
    {
      name: "password",
      displayName: tConnectorField(locale, "password"),
      required: true,
    },
  ];
}

function emailFields(_emailType = "", locale = "zh-CN") {
  return [
    {
      name: "smtp_host",
      displayName: tConnectorField(locale, "smtpHost"),
      required: true,
    },
    {
      name: "smtp_port",
      displayName: tConnectorField(locale, "smtpPort"),
      required: false,
    },
    {
      name: "imap_host",
      displayName: tConnectorField(locale, "imapHost"),
      required: true,
    },
    {
      name: "imap_port",
      displayName: tConnectorField(locale, "imapPort"),
      required: false,
    },
    {
      name: "username",
      displayName: tConnectorField(locale, "emailAccount"),
      required: true,
    },
    {
      name: "password",
      displayName: tConnectorField(locale, "passwordOrAppPassword"),
      required: true,
    },
    {
      name: "from_email",
      displayName: tConnectorField(locale, "fromAddress"),
      required: false,
    },
  ];
}

function attachDefaultValuesToFields(fields = [], connectionInfo = {}) {
  const normalizedFields = Array.isArray(fields) ? fields : [];
  const normalizedConnectionInfo = pickObject(connectionInfo);
  return normalizedFields.map((fieldItem) => {
    const fieldName = String(fieldItem?.name || "").trim();
    if (!fieldName || fieldName === "password") return { ...fieldItem };
    const rawDefaultValue = normalizedConnectionInfo?.[fieldName];
    const defaultValue = String(rawDefaultValue ?? "").trim();
    if (!defaultValue) return { ...fieldItem };
    return {
      ...fieldItem,
      default_value: defaultValue,
      defaultValue,
    };
  });
}

function collectNonSensitiveDefaults(connectionInfo = {}) {
  const normalizedConnectionInfo = pickObject(connectionInfo);
  const defaults = {};
  for (const [key, value] of Object.entries(normalizedConnectionInfo)) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey || normalizedKey.toLowerCase() === "password") continue;
    const normalizedValue = String(value ?? "").trim();
    if (!normalizedValue) continue;
    defaults[normalizedKey] = normalizedValue;
  }
  return defaults;
}

function normalizeProvidedDatabaseDefaults(defaultValuesInput = {}) {
  return normalizeProvidedDefaults(defaultValuesInput, [
    "host",
    "port",
    "username",
    "database",
    "file_path",
    "database_type",
  ]);
}

function normalizeProvidedTerminalDefaults(defaultValuesInput = {}) {
  return normalizeProvidedDefaults(defaultValuesInput, [
    "host",
    "port",
    "username",
    "terminal_type",
  ]);
}

function normalizeProvidedEmailDefaults(defaultValuesInput = {}) {
  return normalizeProvidedDefaults(defaultValuesInput, [
    "smtp_host",
    "smtp_port",
    "smtp_secure",
    "imap_host",
    "imap_port",
    "imap_secure",
    "username",
    "from_email",
  ]);
}

function getMissingFieldNames(fields = [], connectionInfo = {}) {
  const info = pickObject(connectionInfo);
  return fields
    .filter((item) => item?.required)
    .map((item) => String(item?.name || "").trim())
    .filter(Boolean)
    .filter((key) => !String(info?.[key] ?? "").trim());
}

function alignFieldsWithConnectionInfo(
  fields = [],
  connectionInfo = {},
  locale = "zh-CN",
) {
  const normalizedFields = Array.isArray(fields) ? fields : [];
  const normalizedConnectionInfo = pickObject(connectionInfo);
  const fieldNameMap = {
    database_type: "databaseType",
    terminal_type: "terminalType",
    smtp_secure: "smtpSecure",
    imap_secure: "imapSecure",
  };
  const existingFieldNames = new Set(
    normalizedFields
      .map((fieldItem) => String(fieldItem?.name || "").trim())
      .filter(Boolean),
  );
  const appendedFields = [];
  for (const [rawKey, rawValue] of Object.entries(normalizedConnectionInfo)) {
    const fieldName = String(rawKey || "").trim();
    if (!fieldName || existingFieldNames.has(fieldName)) continue;
    if (fieldName.toLowerCase() === "password") continue;
    if (rawValue === null || rawValue === undefined) continue;
    const mappedFieldKey = String(fieldNameMap[fieldName] || "").trim();
    const displayName = mappedFieldKey
      ? tConnectorField(locale, mappedFieldKey)
      : fieldName;
    appendedFields.push({
      name: fieldName,
      displayName,
      required: false,
    });
  }
  return [...normalizedFields, ...appendedFields];
}

export {
  pickObject,
  parseOptionalObjectInput,
  databaseFields,
  terminalFields,
  emailFields,
  attachDefaultValuesToFields,
  collectNonSensitiveDefaults,
  normalizeProvidedDatabaseDefaults,
  normalizeProvidedTerminalDefaults,
  normalizeProvidedEmailDefaults,
  getMissingFieldNames,
  alignFieldsWithConnectionInfo,
};
