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
import { tTool } from "./tool-i18n.js";

function getServices(agentContext) {
  const globalConfig = agentContext?.runtime?.globalConfig || {};
  const userConfig = agentContext?.runtime?.userConfig || {};
  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  return effectiveConfig?.services || {};
}

function tService(agentContext = {}, key = "", params = {}) {
  return tTool(agentContext, `tools.service.${String(key || "").trim()}`, params);
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

function validateInput({ serviceName, endpointName, queryString, agentContext }) {
  const normalizedServiceName = normalizeName(serviceName);
  const normalizedEndpointName = normalizeName(endpointName);
  if (!normalizedServiceName) return tService(agentContext, "serviceNameRequired");
  if (!normalizedEndpointName) return tService(agentContext, "endpointNameRequired");
  if (
    queryString !== undefined &&
    (typeof queryString !== "object" || Array.isArray(queryString))
  ) {
    return tService(agentContext, "queryStringMustBeObject");
  }
  return "";
}

function validateCustomParam(customParam, agentContext) {
  if (customParam === undefined || customParam === null) return "";
  if (typeof customParam !== "string") {
    return tService(agentContext, "customParamMustBeString");
  }
  if (!String(customParam).trim()) return tService(agentContext, "customParamMustNotBeEmpty");
  return "";
}

export function createServiceTool({ agentContext }) {
  const callServiceTool = new DynamicStructuredTool({
    name: "call_service",
    description: tTool(agentContext, "tools.service.description"),
    schema: z.object({
      serviceName: z.string().describe(tTool(agentContext, "tools.service.fieldServiceName")),
      endpointName: z.string().describe(tTool(agentContext, "tools.service.fieldEndpointName")),
      custom_param: z
        .string()
        .optional()
        .describe(tTool(agentContext, "tools.service.fieldCustomParam")),
      queryString: z
        .object({})
        .loose()
        .optional()
        .describe(tTool(agentContext, "tools.service.fieldQueryString")),
      body: z.unknown().optional().describe(tTool(agentContext, "tools.service.fieldBody")),
    }),
    func: async ({ serviceName, endpointName, custom_param, queryString = {}, body }) => {
      const globalConfig = agentContext?.runtime?.globalConfig || {};
      const userId = String(
        agentContext?.userId ||
          agentContext?.runtime?.userId ||
          agentContext?.runtime?.systemRuntime?.userId ||
          "",
      ).trim();
      const inputErr = validateInput({
        serviceName,
        endpointName,
        queryString,
        agentContext,
      });
      if (inputErr) return jsonError({ error: inputErr });
      const customParamErr = validateCustomParam(custom_param, agentContext);
      if (customParamErr) return jsonError({ error: customParamErr });
      if (!userId) return jsonError({ error: tService(agentContext, "userIdMissing") });

      const normalizedServiceName = normalizeName(serviceName);
      const normalizedEndpointName = normalizeName(endpointName);
      const services = getServices(agentContext);
      const serviceCfg = services?.[normalizedServiceName];
      if (!serviceCfg) {
        return jsonError({
          error: tService(agentContext, "serviceNotFound", {
            serviceName: normalizedServiceName,
          }),
        });
      }
      if (!isServiceEnabled(serviceCfg)) {
        return jsonError({
          error: tService(agentContext, "serviceDisabled", {
            serviceName: normalizedServiceName,
          }),
        });
      }
      const endpointCfg = serviceCfg?.endpoints?.[normalizedEndpointName];
      if (!endpointCfg) {
        return jsonError({
          error: tService(agentContext, "endpointNotFound", {
            serviceName: normalizedServiceName,
            endpointName: normalizedEndpointName,
          }),
        });
      }
      const endpointUrl = String(endpointCfg.url || "").trim();
      if (!endpointUrl) {
        return jsonError({
          error: tService(agentContext, "endpointUrlMissing", {
            serviceName: normalizedServiceName,
            endpointName: normalizedEndpointName,
          }),
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
