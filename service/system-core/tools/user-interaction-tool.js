/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

function getRuntime(agentContext) {
  return agentContext?.runtime || {};
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

  const userInteractionTool = new DynamicStructuredTool({
    name: "user_interaction",
    description:
      "当需要用户确认或补充信息时调用该工具。输入交互内容和字段定义，工具会等待前端用户填写并返回结果。",
    schema: z.object({
      content: z.string().min(1).describe("交互内容"),
      fields: z
        .union([z.string(), fieldsPayloadSchema])
        .optional()
        .describe("字段定义（对象或 JSON 字符串）"),
    }),
    func: async ({ content, fields }) => {
      if (!bridge?.requestUserInteraction) {
        return JSON.stringify({
          ok: false,
          error: "user interaction bridge missing",
        });
      }

      const interactionContent = String(content || "").trim();
      if (!interactionContent) {
        return JSON.stringify({
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
        return JSON.stringify({
          ok: false,
          error: `invalid 字段 payload: ${error?.message || String(error)}`,
        });
      }

      const result = await bridge.requestUserInteraction({
        content: interactionContent,
        fields: normalizedFieldsPayload.fields || [],
        dialogProcessId,
      });

      if (
        result &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        result.confirmed === false
      ) {
        return {
          confirmed: false,
          cancelled: true,
          response: String(result?.response || "cancelled"),
        };
      }

      if (normalizedFieldsPayload.fields?.length) {
        if (!result || typeof result !== "object" || Array.isArray(result)) {
          return JSON.stringify({
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
            return JSON.stringify({
              ok: false,
              error: `missing required field: ${key}`,
            });
          }
        }
        return result;
      }

      return {
        confirmed: true,
        response: String(result?.response || ""),
      };
    },
  });

  return [userInteractionTool];
}
