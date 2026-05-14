/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { mergeConfig } from "../../config/index.js";
import {
  createChatModel,
  createChatModelByName,
  resolveDefaultModelSpec,
  resolveModelSpecByName,
} from "../../model/index.js";
import { invokeServiceHandler } from "../../service-invoker/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";

export const REQUEST_HELP_TOOL_NAME = "request_help";
const DEFAULT_HELP_SERVICES = ["web_search_service"];

function normalizeName(value = "") {
  return String(value || "").trim();
}

function isEnabled(config = {}) {
  return config?.enabled !== false;
}

function resolveHelpConfig(agentContext = {}) {
  const runtime = agentContext?.runtime || {};
  const effectiveConfig = mergeConfig(
    runtime?.globalConfig || {},
    runtime?.userConfig || {},
  );
  const toolConfig =
    effectiveConfig?.tools?.[REQUEST_HELP_TOOL_NAME] &&
    typeof effectiveConfig.tools[REQUEST_HELP_TOOL_NAME] === "object"
      ? effectiveConfig.tools[REQUEST_HELP_TOOL_NAME]
      : {};
  return { runtime, effectiveConfig, toolConfig };
}

function normalizeHelpServiceList(toolConfig = {}) {
  const configured =
    toolConfig?.help_services ??
    toolConfig?.helpServices ??
    DEFAULT_HELP_SERVICES;
  if (!Array.isArray(configured)) return [];
  return configured
    .map((item) =>
      typeof item === "string" || typeof item === "number"
        ? { serviceName: normalizeName(item) }
        : item && typeof item === "object"
          ? item
          : null,
    )
    .filter(Boolean)
    .map((item = {}) => {
      const serviceName = normalizeName(
        item?.serviceName ?? item?.service_name ?? item?.name ?? "",
      );
      const endpointName = normalizeName(
        item?.endpointName ?? item?.endpoint_name ?? "",
      );
      const customParam = normalizeName(
        item?.custom_param ?? item?.customParam ?? "",
      );
      const queryKey = normalizeName(item?.query_key ?? item?.queryKey ?? "q");
      const queryString =
        item?.queryString && typeof item.queryString === "object" && !Array.isArray(item.queryString)
          ? item.queryString
          : {};
      return {
        serviceName,
        endpointName,
        customParam,
        queryKey: queryKey || "q",
        queryString,
      };
    })
    .filter((item) => item.serviceName);
}

function pickEndpointName(serviceCfg = {}, preferred = "") {
  const configured = normalizeName(preferred);
  const endpoints =
    serviceCfg?.endpoints && typeof serviceCfg.endpoints === "object"
      ? serviceCfg.endpoints
      : {};
  if (!Object.keys(endpoints).length) return "";
  if (configured && endpoints[configured]) return configured;
  if (endpoints.search) return "search";
  return String(Object.keys(endpoints)[0] || "").trim();
}

async function invokeOneHelpService({
  agentContext,
  globalConfig,
  userId,
  services,
  helpContent,
  configItem,
}) {
  const serviceName = normalizeName(configItem?.serviceName || "");
  const serviceCfg = services?.[serviceName];
  if (!serviceCfg) {
    return { serviceName, ok: false, error: `service not found: ${serviceName}` };
  }
  if (!isEnabled(serviceCfg)) {
    return { serviceName, ok: false, error: `service disabled: ${serviceName}` };
  }
  const endpointName = pickEndpointName(serviceCfg, configItem?.endpointName || "");
  if (!endpointName) {
    return {
      serviceName,
      ok: false,
      error: `endpoint not found: ${serviceName}`,
    };
  }
  const endpointCfg = serviceCfg?.endpoints?.[endpointName];
  const endpointUrl = normalizeName(endpointCfg?.url || "");
  if (!endpointCfg || !endpointUrl) {
    return {
      serviceName,
      endpointName,
      ok: false,
      error: `endpoint invalid: ${serviceName}.${endpointName}`,
    };
  }
  const queryString = {
    ...(configItem?.queryString || {}),
    [configItem?.queryKey || "q"]: helpContent,
  };
  try {
    const result = await invokeServiceHandler({
      agentContext,
      globalConfig,
      userId,
      serviceName,
      endpointName,
      serviceCfg,
      endpointCfg,
      customParam: normalizeName(configItem?.customParam || ""),
      queryString,
      body: {},
    });
    return {
      serviceName,
      endpointName,
      ok: true,
      result,
    };
  } catch (error) {
    return {
      serviceName,
      endpointName,
      ok: false,
      error: error?.message || String(error),
    };
  }
}

function resolveHelpModelName({
  runtime = {},
  toolConfig = {},
  globalConfig = {},
  userConfig = {},
}) {
  const configuredHelpModel = normalizeName(
    toolConfig?.help_model ?? toolConfig?.helpModel ?? "",
  );
  if (configuredHelpModel) {
    const spec = resolveModelSpecByName({
      modelName: configuredHelpModel,
      globalConfig,
      userConfig,
      fallbackToDefault: false,
    });
    if (spec) return spec?.alias || spec?.model || configuredHelpModel;
  }
  const runtimeModel = normalizeName(runtime?.runtimeModel || "");
  if (runtimeModel) {
    const spec = resolveModelSpecByName({
      modelName: runtimeModel,
      globalConfig,
      userConfig,
      fallbackToDefault: false,
    });
    if (spec) return spec?.alias || spec?.model || runtimeModel;
  }
  const defaultSpec = resolveDefaultModelSpec({ globalConfig, userConfig });
  return defaultSpec?.alias || defaultSpec?.model || "";
}

async function invokeHelpModel({
  helpContent,
  runtime,
  toolConfig,
  globalConfig,
  userConfig,
}) {
  const modelName = resolveHelpModelName({
    runtime,
    toolConfig,
    globalConfig,
    userConfig,
  });
  const llm = modelName
    ? createChatModelByName(modelName, {
        globalConfig,
        userConfig,
        streaming: false,
      })
    : createChatModel({ globalConfig, userConfig, streaming: false });
  const response = await llm.invoke([new HumanMessage(helpContent)]);
  const content =
    typeof response?.content === "string"
      ? response.content
      : JSON.stringify(response?.content || "");
  return {
    modelName: modelName || "",
    content: String(content || "").trim(),
  };
}

export function createRequestHelpTool({ agentContext } = {}) {
  const runtime = agentContext?.runtime || {};
  const requestHelpTool = new DynamicStructuredTool({
    name: REQUEST_HELP_TOOL_NAME,
    description: tTool(runtime, "tools.request_help.description"),
    schema: z.object({
      helpContent: z.string().describe(tTool(runtime, "tools.request_help.fieldHelpContent")),
    }),
    func: async ({ helpContent }) => {
      const normalizedHelpContent = String(helpContent || "").trim();
      if (!normalizedHelpContent) {
        return toToolJsonResult(REQUEST_HELP_TOOL_NAME, {
          ok: false,
          error: tTool(runtime, "tools.request_help.helpContentRequired"),
        });
      }

      const { effectiveConfig, toolConfig } = resolveHelpConfig(agentContext);
      const globalConfig = runtime?.globalConfig || {};
      const userConfig = runtime?.userConfig || {};
      const userId = normalizeName(
        agentContext?.userId ||
          runtime?.userId ||
          runtime?.systemRuntime?.userId ||
          "",
      );
      const servicesConfig = effectiveConfig?.services || {};
      const helpServiceList = normalizeHelpServiceList(toolConfig);
      const shouldCallServices = Boolean(helpServiceList.length && userId);

      const servicePromise = shouldCallServices
        ? Promise.all(
            helpServiceList.map((configItem) =>
              invokeOneHelpService({
                agentContext,
                globalConfig,
                userId,
                services: servicesConfig,
                helpContent: normalizedHelpContent,
                configItem,
              }),
            ),
          )
        : Promise.resolve([]);
      const modelPromise = invokeHelpModel({
        helpContent: normalizedHelpContent,
        runtime,
        toolConfig,
        globalConfig,
        userConfig,
      });
      const [serviceSettled, modelSettled] = await Promise.allSettled([
        servicePromise,
        modelPromise,
      ]);
      const serviceResults =
        serviceSettled.status === "fulfilled" ? serviceSettled.value : [];
      const modelResult =
        modelSettled.status === "fulfilled"
          ? modelSettled.value
          : {
              modelName: "",
              content: "",
              error: modelSettled.reason?.message || String(modelSettled.reason || ""),
            };
      const serviceError =
        serviceSettled.status === "rejected"
          ? serviceSettled.reason?.message || String(serviceSettled.reason || "")
          : "";
      const hasServiceSuccess = serviceResults.some((item) => item?.ok === true);
      const hasModelSuccess = !modelResult?.error;
      const status =
        hasServiceSuccess || hasModelSuccess
          ? hasServiceSuccess && hasModelSuccess
            ? "completed"
            : "partial"
          : "failed";

      if (runtime?.systemRuntime && typeof runtime.systemRuntime === "object") {
        runtime.systemRuntime.toolConsecutiveFailureCount = 0;
      }

      return toToolJsonResult(
        REQUEST_HELP_TOOL_NAME,
        {
          ok: status !== "failed",
          status,
          helpContent: normalizedHelpContent,
          serviceResults,
          modelResult,
          ...(serviceError ? { serviceError } : {}),
        },
        true,
      );
    },
  });

  return [requestHelpTool];
}
