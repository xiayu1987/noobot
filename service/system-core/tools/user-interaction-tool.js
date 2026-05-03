/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { toToolJsonResult } from "./tool-json-result.js";
import { pickToolText, resolveToolLocale, tTool } from "./tool-i18n.js";

function getRuntime(agentContext) {
  return agentContext?.runtime || {};
}

function tUserInteraction(runtime = {}, key = "", params = {}) {
  const locale = resolveToolLocale(runtime);
  const dict = {
    contentRequired: {
      "zh-CN": "交互内容/content required",
      "en-US": "interaction content/content required",
    },
    invalidFieldsPayload: {
      "zh-CN": `字段 payload 无效: ${String(params.reason || "").trim()}`,
      "en-US": `invalid fields payload: ${String(params.reason || "").trim()}`,
    },
    sensitiveFieldsBlocked: {
      "zh-CN": "存在敏感字段，如果是数据库或者终端请用 process_connector_tool 连接器连接",
      "en-US": "Sensitive fields detected. For database or terminal access, use process_connector_tool connectors.",
    },
    bridgeMissing: {
      "zh-CN": "用户交互桥接不可用",
      "en-US": "user interaction bridge missing",
    },
    cancelled: {
      "zh-CN": "已取消",
      "en-US": "cancelled",
    },
    invalidResponseObject: {
      "zh-CN": "交互返回对象无效",
      "en-US": "invalid interaction response object",
    },
    missingRequiredField: {
      "zh-CN": `缺少必填字段: ${String(params.key || "").trim()}`,
      "en-US": `missing required field: ${String(params.key || "").trim()}`,
    },
  };
  return pickToolText({ locale, dict, key, params });
}

const SENSITIVE_FIELD_KEYWORDS = [
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
  "auth",
  "authorization",
  "bearer",
  "cookie",
  "session",
  "api_key",
  "apikey",
  "app_key",
  "app_secret",
  "access_key",
  "access_token",
  "refresh_token",
  "private_key",
  "public_key",
  "ssh_key",
  "client_secret",
  "client_id",
  "credential",
  "credentials",
  "connection_string",
  "dsn",
  "jdbc",
  "uri",
  "conn_str",
  "密钥",
  "密码",
  "口令",
  "私钥",
  "公钥",
  "连接串",
  "连接字符串",
  "数据库连接",
  "令牌",
  "凭证",
];

function normalizeSensitiveText(input = "") {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function canonicalSensitiveText(input = "") {
  return normalizeSensitiveText(input).replace(/[_-]+/g, "");
}

function containsRelation(left = "", right = "") {
  const normalizedLeft = String(left || "").trim();
  const normalizedRight = String(right || "").trim();
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    if (Math.min(normalizedLeft.length, normalizedRight.length) >= 4) return true;
  }
  return false;
}

function isSensitiveField(field = {}) {
  const texts = [
    normalizeSensitiveText(field?.name || ""),
    normalizeSensitiveText(field?.displayName || ""),
    normalizeSensitiveText(field?.description || ""),
  ];
  const canonicalTexts = texts.map((item) => canonicalSensitiveText(item));
  const merged = texts.join(" ");
  const sensitivePatterns = [
    /\b(api|access|refresh|bearer|auth|session)[_\s-]?(key|token|secret)\b/i,
    /\b(connection|conn|database|db)[_\s-]?(string|url|uri|dsn)\b/i,
    /\b(private|public|ssh|client)[_\s-]?key\b/i,
    /(密码|口令|密钥|私钥|公钥|连接串|连接字符串|凭证|令牌)/,
  ];
  if (sensitivePatterns.some((pattern) => pattern.test(merged))) return true;
  return texts.some((text, index) =>
    SENSITIVE_FIELD_KEYWORDS.some((keyword) => {
      const normalizedKeyword = normalizeSensitiveText(keyword);
      const canonicalKeyword = canonicalSensitiveText(keyword);
      return (
        text.includes(normalizedKeyword) ||
        canonicalTexts[index].includes(canonicalKeyword) ||
        containsRelation(text, normalizedKeyword) ||
        containsRelation(canonicalTexts[index], canonicalKeyword)
      );
    }),
  );
}
export function createUserInteractionTool({ agentContext }) {
  const runtime = getRuntime(agentContext);
  const bridge = runtime.userInteractionBridge || null;
  const systemRuntime = runtime.systemRuntime || {};
  const dialogProcessId = String(systemRuntime.dialogProcessId || "").trim();
  const sessionId = String(systemRuntime.sessionId || "").trim();
  const fieldSchema = z.object({
    name: z.string().min(1).describe(tTool(runtime, "tools.user_interaction.fieldName")),
    displayName: z
      .string()
      .min(1)
      .describe(tTool(runtime, "tools.user_interaction.fieldDisplayName")),
    required: z.boolean().describe(tTool(runtime, "tools.user_interaction.fieldRequired")),
    description: z
      .string()
      .optional()
      .default("")
      .describe(tTool(runtime, "tools.user_interaction.fieldDescription")),
  });

  const fieldsPayloadSchema = z.object({
    fields: z
      .array(fieldSchema)
      .default([])
      .describe(tTool(runtime, "tools.user_interaction.fieldFields")),
  });

  const userInteractionTool = new DynamicStructuredTool({
    name: "user_interaction",
    description: tTool(runtime, "tools.user_interaction.description"),
    schema: z.object({
      content: z
        .string()
        .min(1)
        .describe(tTool(runtime, "tools.user_interaction.fieldContent")),
      fields: z
        .union([z.string(), fieldsPayloadSchema])
        .optional()
        .describe(tTool(runtime, "tools.user_interaction.fieldFieldsPayload")),
    }),
    func: async ({ content, fields }) => {
      if (!bridge?.requestUserInteraction) {
        return toToolJsonResult("user_interaction", {
          ok: false,
          error: tUserInteraction(runtime, "bridgeMissing"),
        });
      }

      const interactionContent = String(content || "").trim();
      if (!interactionContent) {
        return toToolJsonResult("user_interaction", {
          ok: false,
          error: tUserInteraction(runtime, "contentRequired"),
        });
      }

      let normalizedFieldsPayload = { fields: [] };
      try {
        const parsedFields =
          typeof fields === "string" && String(fields || "").trim()
            ? JSON.parse(fields)
            : fields || {};
        normalizedFieldsPayload = fieldsPayloadSchema.parse(parsedFields || {});
      } catch (error) {
        return toToolJsonResult("user_interaction", {
          ok: false,
          error: tUserInteraction(runtime, "invalidFieldsPayload", {
            reason: error?.message || String(error),
          }),
        });
      }

      const hasSensitiveFields = (normalizedFieldsPayload.fields || []).some(
        isSensitiveField,
      );
      if (hasSensitiveFields) {
        return toToolJsonResult("user_interaction", {
          ok: false,
          error: tUserInteraction(runtime, "sensitiveFieldsBlocked"),
        });
      }

      const result = await bridge.requestUserInteraction({
        content: interactionContent,
        fields: normalizedFieldsPayload.fields || [],
        dialogProcessId,
        requireEncryption: false,
        sessionId,
        toolName: "user_interaction",
      });

      if (
        result &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        result.confirmed === false
      ) {
        return toToolJsonResult("user_interaction", {
          ok: true,
          confirmed: false,
          cancelled: true,
          response: String(result?.response || tUserInteraction(runtime, "cancelled")),
        });
      }

      if (normalizedFieldsPayload.fields?.length) {
        if (!result || typeof result !== "object" || Array.isArray(result)) {
          return toToolJsonResult("user_interaction", {
            ok: false,
            error: tUserInteraction(runtime, "invalidResponseObject"),
          });
        }
        const requiredFields = normalizedFieldsPayload.fields
          .filter((item) => Boolean(item?.required))
          .map((item) => String(item?.name || "").trim())
          .filter(Boolean);
        for (const key of requiredFields) {
          if (!String(result?.[key] ?? "").trim()) {
            return toToolJsonResult("user_interaction", {
              ok: false,
              error: tUserInteraction(runtime, "missingRequiredField", { key }),
            });
          }
        }
        return toToolJsonResult("user_interaction", {
          ok: true,
          confirmed: true,
          ...(result || {}),
        });
      }

      return toToolJsonResult("user_interaction", {
        ok: true,
        confirmed: true,
        response: String(result?.response || ""),
      });
    },
  });

  return [userInteractionTool];
}
