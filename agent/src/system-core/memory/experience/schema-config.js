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
      'ADD/UPDATE/DELETE D[整数ID] domain="领域" new=true|false experiences="经验1 || 经验2" lessons="教训1 || 教训2"',
    promptExample:
      'ADD D1 domain="编程" new=true experiences="先写测试 || 分层解耦" lessons="避免硬编码"',
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
      'ADD/UPDATE/DELETE W[整数ID] category="大类" experiences="经验1 || 经验2" lessons="教训1 || 教训2"',
    promptExample:
      'ADD W1 category="架构设计" experiences="先抽象后实现" lessons="避免过早优化"',
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
      'ADD/UPDATE/DELETE M[整数ID] category="大类" subcategory="小类" patterns="规律1 || 规律2" methodologies="方法1 || 方法2"',
    promptExample:
      'ADD M1 category="工程效率" subcategory="测试策略" patterns="回归频繁" methodologies="灰度+自动化"',
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
      'ADD/UPDATE/DELETE Y[整数ID] category="大类" subcategory="小类" principles="原则1 || 原则2" reflections="反思1 || 反思2"',
    promptExample:
      'ADD Y1 category="系统设计" subcategory="可靠性" principles="先观测再优化" reflections="容量评估要前置"',
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
