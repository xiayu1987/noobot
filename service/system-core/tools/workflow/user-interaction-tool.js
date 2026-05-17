/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { recoverableToolError } from "../../error/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { ERROR_CODE } from "../../error/constants.js";

function getRuntime(agentContext) {
  return agentContext?.runtime || {};
}

function tUserInteraction(runtime = {}, key = "", params = {}) {
  return tTool(runtime, `tools.user_interaction.${String(key || "").trim()}`, params);
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
        throw recoverableToolError(tUserInteraction(runtime, "bridgeMissing"), {
          code: ERROR_CODE.RECOVERABLE_USER_INTERACTION_BRIDGE_MISSING,
        });
      }

      const interactionContent = String(content || "").trim();
      if (!interactionContent) {
        throw recoverableToolError(tUserInteraction(runtime, "contentRequired"), {
          code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
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
        throw recoverableToolError(
          tUserInteraction(runtime, "invalidFieldsPayload", {
            reason: error?.message || String(error),
          }),
          { code: ERROR_CODE.RECOVERABLE_INVALID_TOOL_INPUT },
        );
      }

      const hasSensitiveFields = (normalizedFieldsPayload.fields || []).some(
        isSensitiveField,
      );
      if (hasSensitiveFields) {
        throw recoverableToolError(
          tUserInteraction(runtime, "sensitiveFieldsBlocked"),
          { code: ERROR_CODE.RECOVERABLE_SENSITIVE_FIELDS_BLOCKED },
        );
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
        throw recoverableToolError(tUserInteraction(runtime, "cancelled"), {
          code: ERROR_CODE.RECOVERABLE_USER_CANCELLED,
          details: {
            confirmed: false,
            cancelled: true,
            response: String(result?.response || tUserInteraction(runtime, "cancelled")),
          },
        });
      }

      if (normalizedFieldsPayload.fields?.length) {
        if (!result || typeof result !== "object" || Array.isArray(result)) {
          throw recoverableToolError(
            tUserInteraction(runtime, "invalidResponseObject"),
            { code: ERROR_CODE.RECOVERABLE_INVALID_RESPONSE_OBJECT },
          );
        }
        const requiredFields = normalizedFieldsPayload.fields
          .filter((item) => Boolean(item?.required))
          .map((item) => String(item?.name || "").trim())
          .filter(Boolean);
        for (const key of requiredFields) {
          if (!String(result?.[key] ?? "").trim()) {
            throw recoverableToolError(
              tUserInteraction(runtime, "missingRequiredField", { key }),
              {
                code: ERROR_CODE.RECOVERABLE_MISSING_REQUIRED_FIELD,
                details: { key },
              },
            );
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
