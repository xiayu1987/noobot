/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MEMORY_DOCUMENT_KIND } from "../document.js";
import { BUILTIN_EXPERIENCE_FIELDS } from "./fields.js";
import { EXPERIENCE_STRUCTURE_FIELDS } from "./structure.js";

const {
  domain: DOMAIN_FIELD,
  new: NEW_DOMAIN_FIELD,
  category: CATEGORY_FIELD,
  subcategory: SUBCATEGORY_FIELD,
} = EXPERIENCE_STRUCTURE_FIELDS;

const STAGE_STRUCTURE = Object.freeze({
  daily: Object.freeze({
    documentKind: MEMORY_DOCUMENT_KIND.DAILY_SUMMARY,
    idPrefix: "D",
    parseErrorCode: "daily_patch_command_not_found",
    structureFields: Object.freeze({
      domain: DOMAIN_FIELD,
      new: NEW_DOMAIN_FIELD,
    }),
    requiredFields: Object.freeze(["domain"]),
  }),
  weekly: Object.freeze({
    documentKind: MEMORY_DOCUMENT_KIND.WEEKLY_SUMMARY,
    idPrefix: "W",
    parseErrorCode: "weekly_patch_command_not_found",
    structureFields: Object.freeze({ category: CATEGORY_FIELD }),
    requiredFields: Object.freeze(["category"]),
  }),
  monthly: Object.freeze({
    documentKind: MEMORY_DOCUMENT_KIND.MONTHLY_SUMMARY,
    idPrefix: "M",
    parseErrorCode: "monthly_patch_command_not_found",
    structureFields: Object.freeze({
      category: CATEGORY_FIELD,
      subcategory: SUBCATEGORY_FIELD,
    }),
    requiredFields: Object.freeze(["category", "subcategory"]),
    hasSubcategory: true,
    sourceLabel: "来源周",
  }),
  yearly: Object.freeze({
    documentKind: MEMORY_DOCUMENT_KIND.YEARLY_SUMMARY,
    idPrefix: "Y",
    parseErrorCode: "yearly_patch_command_not_found",
    structureFields: Object.freeze({
      category: CATEGORY_FIELD,
      subcategory: SUBCATEGORY_FIELD,
    }),
    requiredFields: Object.freeze(["category", "subcategory"]),
    hasSubcategory: true,
    sourceLabel: "来源月",
  }),
});

function requireStructure(stage) {
  const structure =
    STAGE_STRUCTURE[
      String(stage || "")
        .trim()
        .toLowerCase()
    ];
  if (!structure) throw new Error(`unknown experience patch schema: ${stage}`);
  return structure;
}

export function buildExperiencePatchSchema(stage, fields = BUILTIN_EXPERIENCE_FIELDS) {
  const structure = requireStructure(stage);
  const contentFields = fields?.[stage] || BUILTIN_EXPERIENCE_FIELDS[stage];
  const fieldMap = { ...structure.structureFields };
  for (const item of contentFields) {
    fieldMap[item.key] = Object.freeze({ key: item.key, type: "list" });
  }
  const { structureFields: _ignored, hasSubcategory, ...rest } = structure;
  return Object.freeze({
    ...rest,
    structureFields: structure.structureFields,
    contentFields,
    fieldMap: Object.freeze(fieldMap),
    subFields: hasSubcategory
      ? Object.freeze([SUBCATEGORY_FIELD.key, ...contentFields.map((item) => item.key)])
      : null,
    sections: Object.freeze(
      contentFields.map((item) => Object.freeze({ heading: `${item.title}：`, field: item.key })),
    ),
  });
}

export const EXPERIENCE_PATCH_SCHEMA = Object.freeze(
  Object.fromEntries(
    Object.keys(STAGE_STRUCTURE).map((stage) => [stage, buildExperiencePatchSchema(stage)]),
  ),
);

const DEFAULT_PROMPT_LABELS = Object.freeze({
  id: "integer",
  domain: "Domain",
  category: "Category",
  subcategory: "Subcategory",
  fieldPlaceholders: Object.freeze({}),
  itemPlaceholder: (label, index) => `${label} ${index}`,
});

export function renderExperiencePatchProtocol(
  stage,
  { fields = BUILTIN_EXPERIENCE_FIELDS, labels = {} } = {},
) {
  const key = String(stage || "")
    .trim()
    .toLowerCase();
  const schema = buildExperiencePatchSchema(key, fields);
  const text = { ...DEFAULT_PROMPT_LABELS, ...labels };
  const itemPlaceholder =
    typeof text.itemPlaceholder === "function"
      ? text.itemPlaceholder
      : DEFAULT_PROMPT_LABELS.itemPlaceholder;
  const structureToken = (field, example) =>
    field.type === "boolean"
      ? `${field.key}=${example ? "true" : "true|false"}`
      : `${field.key}="${text[field.key]}"`;
  const structure = (example) =>
    Object.values(schema.structureFields).map((field) => structureToken(field, example));
  const contents = schema.contentFields.map((item) => {
    const label = text.fieldPlaceholders?.[item.key] || item.title || item.key;
    return `${item.key}="${itemPlaceholder(label, 1)} || ${itemPlaceholder(label, 2)}"`;
  });
  return {
    protocol: [
      `ADD/UPDATE/DELETE ${schema.idPrefix}[${text.id}]`,
      ...structure(false),
      ...contents,
    ].join(" "),
    example: [`ADD ${schema.idPrefix}[1]`, ...structure(true), ...contents].join(" "),
    fieldGuide: schema.contentFields
      .map((item) => [`- ${item.key}`, item.title, item.description].filter(Boolean).join(" | "))
      .join("\n"),
  };
}
