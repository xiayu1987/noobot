/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const EXPERIENCE_PATCH_SCHEMA = Object.freeze({
  daily: Object.freeze({
    idPrefix: "D",
    parseErrorCode: "daily_patch_command_not_found",
    promptProtocol:
      'ADD/UPDATE/DELETE D[id] domain="domain" new=true|false experiences="experience 1 || experience 2" lessons="lesson 1 || lesson 2"',
    promptExample:
      'ADD D[1] domain="domain" new=true experiences="experience 1 || experience 2" lessons="lesson 1 || lesson 2"',
    fieldMap: Object.freeze({
      domain_name: Object.freeze({
        type: "sanitized",
        aliases: ["domain", "domain_name"],
      }),
      is_new_domain: Object.freeze({
        type: "boolean",
        aliases: ["new", "is_new", "is_new_domain"],
      }),
      experiences: Object.freeze({
        type: "list",
        aliases: ["experiences", "exp"],
      }),
      lessons: Object.freeze({
        type: "list",
        aliases: ["lessons", "lesson"],
      }),
    }),
    requiredFields: Object.freeze(["domain_name"]),
  }),
  weekly: Object.freeze({
    idPrefix: "W",
    parseErrorCode: "weekly_patch_command_not_found",
    promptProtocol:
      'ADD/UPDATE/DELETE W[id] category="category" experiences="experience 1 || experience 2" lessons="lesson 1 || lesson 2"',
    promptExample:
      'ADD W[1] category="category" experiences="experience 1 || experience 2" lessons="lesson 1 || lesson 2"',
    fieldMap: Object.freeze({
      category_name: Object.freeze({
        type: "sanitized",
        aliases: ["category", "category_name"],
      }),
      experiences: Object.freeze({
        type: "list",
        aliases: ["experiences", "exp"],
      }),
      lessons: Object.freeze({
        type: "list",
        aliases: ["lessons", "lesson"],
      }),
    }),
    requiredFields: Object.freeze(["category_name"]),
  }),
  monthly: Object.freeze({
    idPrefix: "M",
    parseErrorCode: "monthly_patch_command_not_found",
    promptProtocol:
      'ADD/UPDATE/DELETE M[id] category="category" subcategory="subcategory" patterns="pattern 1 || pattern 2" methodologies="method 1 || method 2"',
    promptExample:
      'ADD M[1] category="category" subcategory="subcategory" patterns="pattern 1 || pattern 2" methodologies="method 1 || method 2"',
    fieldMap: Object.freeze({
      category_name: Object.freeze({
        type: "sanitized",
        aliases: ["category", "category_name"],
      }),
      subcategory_name: Object.freeze({
        type: "sanitized",
        aliases: ["subcategory", "subcategory_name"],
      }),
      patterns: Object.freeze({
        type: "list",
        aliases: ["patterns", "pattern"],
      }),
      methodologies: Object.freeze({
        type: "list",
        aliases: ["methodologies", "methods"],
      }),
    }),
    requiredFields: Object.freeze(["category_name", "subcategory_name"]),
    subFields: Object.freeze(["subcategory_name", "patterns", "methodologies"]),
  }),
  yearly: Object.freeze({
    idPrefix: "Y",
    parseErrorCode: "yearly_patch_command_not_found",
    promptProtocol:
      'ADD/UPDATE/DELETE Y[id] category="category" subcategory="subcategory" principles="principle 1 || principle 2" reflections="reflection 1 || reflection 2"',
    promptExample:
      'ADD Y[1] category="category" subcategory="subcategory" principles="principle 1 || principle 2" reflections="reflection 1 || reflection 2"',
    fieldMap: Object.freeze({
      category_name: Object.freeze({
        type: "sanitized",
        aliases: ["category", "category_name"],
      }),
      subcategory_name: Object.freeze({
        type: "sanitized",
        aliases: ["subcategory", "subcategory_name"],
      }),
      yearly_principles: Object.freeze({
        type: "list",
        aliases: ["principles", "yearly_principles"],
      }),
      strategic_reflections: Object.freeze({
        type: "list",
        aliases: ["reflections", "strategic_reflections"],
      }),
    }),
    requiredFields: Object.freeze(["category_name", "subcategory_name"]),
    subFields: Object.freeze([
      "subcategory_name",
      "yearly_principles",
      "strategic_reflections",
    ]),
  }),
});

export function getExperiencePatchPromptMeta(key = "") {
  const normalizedKey = String(key || "").trim().toLowerCase();
  const schema = EXPERIENCE_PATCH_SCHEMA[normalizedKey] || null;
  return {
    protocol: String(schema?.promptProtocol || "").trim(),
    example: String(schema?.promptExample || "").trim(),
  };
}
