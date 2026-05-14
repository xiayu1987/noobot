/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { mergeConfig } from "../../config/index.js";
import { invokeServiceHandler } from "../../service-invoker/index.js";
import { recoverableToolError } from "../../error/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";

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
        .record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean(), z.null()]),
        )
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
      if (inputErr) {
        throw recoverableToolError(inputErr, {
          code: "RECOVERABLE_INVALID_TOOL_INPUT",
        });
      }
      const customParamErr = validateCustomParam(custom_param, agentContext);
      if (customParamErr) {
        throw recoverableToolError(customParamErr, {
          code: "RECOVERABLE_INVALID_TOOL_INPUT",
        });
      }
      if (!userId) {
        throw recoverableToolError(tService(agentContext, "userIdMissing"), {
          code: "RECOVERABLE_RUNTIME_CONTEXT_MISSING",
        });
      }

      const normalizedServiceName = normalizeName(serviceName);
      const normalizedEndpointName = normalizeName(endpointName);
      const services = getServices(agentContext);
      const serviceCfg = services?.[normalizedServiceName];
      if (!serviceCfg) {
        throw recoverableToolError(
          tService(agentContext, "serviceNotFound", {
            serviceName: normalizedServiceName,
          }),
          { code: "RECOVERABLE_SERVICE_NOT_FOUND" },
        );
      }
      if (!isServiceEnabled(serviceCfg)) {
        throw recoverableToolError(
          tService(agentContext, "serviceDisabled", {
            serviceName: normalizedServiceName,
          }),
          { code: "RECOVERABLE_SERVICE_DISABLED" },
        );
      }
      const endpointCfg = serviceCfg?.endpoints?.[normalizedEndpointName];
      if (!endpointCfg) {
        throw recoverableToolError(
          tService(agentContext, "endpointNotFound", {
            serviceName: normalizedServiceName,
            endpointName: normalizedEndpointName,
          }),
          { code: "RECOVERABLE_ENDPOINT_NOT_FOUND" },
        );
      }
      const endpointUrl = String(endpointCfg.url || "").trim();
      if (!endpointUrl) {
        throw recoverableToolError(
          tService(agentContext, "endpointUrlMissing", {
            serviceName: normalizedServiceName,
            endpointName: normalizedEndpointName,
          }),
          { code: "RECOVERABLE_ENDPOINT_URL_MISSING" },
        );
      }
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
    },
  });

  return [callServiceTool];
}
