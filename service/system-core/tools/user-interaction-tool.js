/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { toToolJsonResult } from "./tool-json-result.js";

function getRuntime(agentContext) {
  return agentContext?.runtime || {};
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
const fieldSchema = z.object({
  name: z.string().min(1).describe("字段名（返回对象的 key）"),
  displayName: z.string().min(1).describe("字段显示名称"),
  required: z.boolean().describe("是否必填"),
  description: z.string().optional().default("").describe("字段说明"),
});

const fieldsPayloadSchema = z.object({
  fields: z.array(fieldSchema).default([]).describe("字段定义列表"),
});

export function createUserInteractionTool({ agentContext }) {
  const runtime = getRuntime(agentContext);
  const bridge = runtime.userInteractionBridge || null;
  const systemRuntime = runtime.systemRuntime || {};
  const dialogProcessId = String(systemRuntime.dialogProcessId || "").trim();
  const sessionId = String(systemRuntime.sessionId || "").trim();

  const userInteractionTool = new DynamicStructuredTool({
    name: "user_interaction",
    description:
      "当需要用户确认或补充信息时调用该工具。输入交互内容和字段定义，工具会等待前端用户填写并返回结果。连接器访问，数据库，终端，邮件等连接请求时禁止调用该工具",
    schema: z.object({
      content: z.string().min(1).describe("交互内容"),
      fields: z
        .union([z.string(), fieldsPayloadSchema])
        .optional()
        .describe("字段定义（对象或 JSON 字符串）"),
    }),
    func: async ({ content, fields }) => {
      if (!bridge?.requestUserInteraction) {
        return toToolJsonResult("user_interaction", {
          ok: false,
          error: "user interaction bridge missing",
        });
      }

      const interactionContent = String(content || "").trim();
      if (!interactionContent) {
        return toToolJsonResult("user_interaction", {
          ok: false,
          error: "交互内容/content required",
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
          error: `invalid 字段 payload: ${error?.message || String(error)}`,
        });
      }

      const hasSensitiveFields = (normalizedFieldsPayload.fields || []).some(
        isSensitiveField,
      );
      if (hasSensitiveFields) {
        return toToolJsonResult("user_interaction", {
          ok: false,
          error: "存在敏感字段，如果是数据库或者终端请用process_connector_tool连接器连接",
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
          response: String(result?.response || "cancelled"),
        });
      }

      if (normalizedFieldsPayload.fields?.length) {
        if (!result || typeof result !== "object" || Array.isArray(result)) {
          return toToolJsonResult("user_interaction", {
            ok: false,
            error: "invalid interaction response object",
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
              error: `missing required field: ${key}`,
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
