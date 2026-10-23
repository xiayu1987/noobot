/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { DSL_PROTOCOL } from "./constants.js";
import { tWorkflow, WORKFLOW_I18N_KEYSET } from "../core/i18n.js";
import { text } from "@noobot/shared/value";

export const DSL_ERROR_MESSAGE = Object.freeze({
  EMPTY_TEXT: "EMPTY_TEXT",
  JSON_NOT_ALLOWED: "JSON_NOT_ALLOWED",
  MISSING_HEADER: "MISSING_HEADER",
  NO_NODE: "NO_NODE",
  NO_EDGE: "NO_EDGE",
  NODE_ID_REQUIRED: "NODE_ID_REQUIRED",
  NODE_ID_DUPLICATE: "NODE_ID_DUPLICATE",
  NODE_TYPE_INVALID: "NODE_TYPE_INVALID",
  EDGE_FROM_TO_REQUIRED: "EDGE_FROM_TO_REQUIRED",
  EDGE_CONDITION_UNSUPPORTED: "EDGE_CONDITION_UNSUPPORTED",
  EDGE_UNDEFINED_NODE: "EDGE_UNDEFINED_NODE",
  UNKNOWN_COMMAND: "UNKNOWN_COMMAND",
});

const DSL_ERROR_I18N_KEY_BY_CODE = Object.freeze({
  [DSL_ERROR_MESSAGE.EMPTY_TEXT]: WORKFLOW_I18N_KEYSET.DSL_ERROR.EMPTY_TEXT,
  [DSL_ERROR_MESSAGE.JSON_NOT_ALLOWED]: WORKFLOW_I18N_KEYSET.DSL_ERROR.JSON_NOT_ALLOWED,
  [DSL_ERROR_MESSAGE.MISSING_HEADER]: WORKFLOW_I18N_KEYSET.DSL_ERROR.MISSING_HEADER,
  [DSL_ERROR_MESSAGE.NO_NODE]: WORKFLOW_I18N_KEYSET.DSL_ERROR.NO_NODE,
  [DSL_ERROR_MESSAGE.NO_EDGE]: WORKFLOW_I18N_KEYSET.DSL_ERROR.NO_EDGE,
  [DSL_ERROR_MESSAGE.NODE_ID_REQUIRED]: WORKFLOW_I18N_KEYSET.DSL_ERROR.NODE_ID_REQUIRED,
  [DSL_ERROR_MESSAGE.NODE_ID_DUPLICATE]: WORKFLOW_I18N_KEYSET.DSL_ERROR.NODE_ID_DUPLICATE,
  [DSL_ERROR_MESSAGE.NODE_TYPE_INVALID]: WORKFLOW_I18N_KEYSET.DSL_ERROR.NODE_TYPE_INVALID,
  [DSL_ERROR_MESSAGE.EDGE_FROM_TO_REQUIRED]: WORKFLOW_I18N_KEYSET.DSL_ERROR.EDGE_FROM_TO_REQUIRED,
  [DSL_ERROR_MESSAGE.EDGE_CONDITION_UNSUPPORTED]:
    WORKFLOW_I18N_KEYSET.DSL_ERROR.EDGE_CONDITION_UNSUPPORTED,
  [DSL_ERROR_MESSAGE.EDGE_UNDEFINED_NODE]: WORKFLOW_I18N_KEYSET.DSL_ERROR.EDGE_UNDEFINED_NODE,
  [DSL_ERROR_MESSAGE.UNKNOWN_COMMAND]: WORKFLOW_I18N_KEYSET.DSL_ERROR.UNKNOWN_COMMAND,
});

export function normalizeDslLocale(input = "") {
  const value = text(input).toLowerCase();
  return value.startsWith("en") ? "en-US" : "zh-CN";
}

function resolveDslErrorPrefix(locale = "zh-CN") {
  const normalized = normalizeDslLocale(locale);
  return (
    tWorkflow(normalized, WORKFLOW_I18N_KEYSET.DSL_ERROR.PREFIX) ||
    tWorkflow("en-US", WORKFLOW_I18N_KEYSET.DSL_ERROR.PREFIX)
  ).trim();
}

export function dslMessage(key = "", { locale = "zh-CN", params = {} } = {}) {
  const normalized = normalizeDslLocale(locale);
  const i18nKey = text(DSL_ERROR_I18N_KEY_BY_CODE[key]);
  if (!i18nKey) return "";
  const resolvedParams = {
    header: DSL_PROTOCOL.HEADER,
    ...(params && typeof params === "object" ? params : {}),
  };
  const localized = tWorkflow(normalized, i18nKey, resolvedParams);
  if (localized) return localized;
  return tWorkflow("en-US", i18nKey, resolvedParams);
}

export function dslError(message = "", { locale = "zh-CN" } = {}) {
  return `${resolveDslErrorPrefix(locale)}: ${text(message)}`;
}

export function dslLineError(lineNo = 0, message = "", { locale = "zh-CN" } = {}) {
  const normalized = normalizeDslLocale(locale);
  const lineText =
    tWorkflow(normalized, WORKFLOW_I18N_KEYSET.DSL_ERROR.LINE_LABEL, { lineNo }) ||
    `line ${lineNo}`;
  return `${resolveDslErrorPrefix(locale)} (${lineText}): ${text(message)}`;
}

export function dslEdgeUndefinedNode(from = "", to = "", { locale = "zh-CN" } = {}) {
  return dslMessage(DSL_ERROR_MESSAGE.EDGE_UNDEFINED_NODE, {
    locale,
    params: {
      from: text(from),
      to: text(to),
    },
  });
}
