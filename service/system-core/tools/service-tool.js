/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { mergeConfig } from "../config/index.js";
import { invokeServiceHandler } from "../services/index.js";
import { toToolJsonResult } from "./tool-json-result.js";

function getServices(agentContext) {
  const globalConfig = agentContext?.runtime?.globalConfig || {};
  const userConfig = agentContext?.runtime?.userConfig || {};
  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  return effectiveConfig?.services || {};
}

function isServiceEnabled(serviceCfg) {
  return serviceCfg?.enabled !== false;
}

function normalizeName(value = "") {
  return String(value || "").trim();
}

function jsonError(payload = {}) {
  return toToolJsonResult("call_service", { ok: false, ...payload });
}

function validateInput({ serviceName, endpointName, queryString }) {
  const normalizedServiceName = normalizeName(serviceName);
  const normalizedEndpointName = normalizeName(endpointName);
  if (!normalizedServiceName) return "serviceName required";
  if (!normalizedEndpointName) return "endpointName required";
  if (
    queryString !== undefined &&
    (typeof queryString !== "object" || Array.isArray(queryString))
  ) {
    return "queryString must be an object";
  }
  return "";
}

function validateCustomParam(customParam) {
  if (customParam === undefined || customParam === null) return "";
  if (typeof customParam !== "string") return "custom_param must be a string";
  if (!String(customParam).trim()) return "custom_param must not be empty";
  return "";
}

export function createServiceTool({ agentContext }) {
  const callServiceTool = new DynamicStructuredTool({
    name: "call_service",
    description:
      "调用外部服务。必须传 serviceName 和 endpointName，可传 queryString/body/custom_param。",
    schema: z.object({
      serviceName: z.string().describe("服务名称，对应 services 下的 key"),
      endpointName: z.string().describe("端点名称，对应 services.<name>.endpoints 下的 key"),
      custom_param: z
        .string()
        .optional()
        .describe("额外自定义参数"),
      queryString: z
        .object({})
        .loose()
        .optional()
        .describe("查询参数对象，将拼接到 URL"),
      body: z.unknown().optional().describe("请求体内容"),
    }),
    func: async ({ serviceName, endpointName, custom_param, queryString = {}, body }) => {
      const globalConfig = agentContext?.runtime?.globalConfig || {};
      const userId = String(
        agentContext?.userId ||
          agentContext?.runtime?.userId ||
          agentContext?.runtime?.systemRuntime?.userId ||
          "",
      ).trim();
      const inputErr = validateInput({ serviceName, endpointName, queryString });
      if (inputErr) return jsonError({ error: inputErr });
      const customParamErr = validateCustomParam(custom_param);
      if (customParamErr) return jsonError({ error: customParamErr });
      if (!userId) return jsonError({ error: "userId missing in context" });

      const normalizedServiceName = normalizeName(serviceName);
      const normalizedEndpointName = normalizeName(endpointName);
      const services = getServices(agentContext);
      const serviceCfg = services?.[normalizedServiceName];
      if (!serviceCfg) {
        return jsonError({ error: `service not found: ${normalizedServiceName}` });
      }
      if (!isServiceEnabled(serviceCfg)) {
        return jsonError({ error: `service disabled: ${normalizedServiceName}` });
      }
      const endpointCfg = serviceCfg?.endpoints?.[normalizedEndpointName];
      if (!endpointCfg) {
        return jsonError({
          error: `endpoint not found: ${normalizedServiceName}.${normalizedEndpointName}`,
        });
      }
      const endpointUrl = String(endpointCfg.url || "").trim();
      if (!endpointUrl) {
        return jsonError({
          error: `endpoint url missing: ${normalizedServiceName}.${normalizedEndpointName}`,
        });
      }

      try {
        const result = await invokeServiceHandler({
          agentContext,
          globalConfig,
          userId,
          serviceName: normalizedServiceName,
          endpointName: normalizedEndpointName,
          serviceCfg,
          endpointCfg,
          customParam: String(custom_param || "").trim(),
          queryString,
          body,
        });
        const normalizedResult =
          result && typeof result === "object" && !Array.isArray(result)
            ? result
            : { data: result };
        return toToolJsonResult(
          "call_service",
          {
            ok: normalizedResult?.ok !== false,
            ...normalizedResult,
          },
          true,
        );
      } catch (error) {
        return jsonError({
          serviceName: normalizedServiceName,
          endpointName: normalizedEndpointName,
          error: error?.message || String(error),
        });
      }
    },
  });

  return [callServiceTool];
}
