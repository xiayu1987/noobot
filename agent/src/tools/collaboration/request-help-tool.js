/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { filePath as path } from "@noobot/path-resolver";
import { z } from "zod";
import { mergeConfig } from "../../config/index.js";
import { resolveDefaultModelSpec, resolveModelSpecByName } from "../../models/index.js";
import { TASK_STATUS } from "../../bot/async/constants.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { invokeServiceHandler } from "../../integrations/services/index.js";
import {
  getRuntimeFromAgentContext,
  getSystemRuntimeFromRuntime,
} from "../../context/agent-context-accessor.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { TOOL_NAME } from "../constants/index.js";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";

export const REQUEST_HELP_TOOL_NAME = TOOL_NAME.REQUEST_HELP;
const DEFAULT_HELP_SERVICES = [];
const DEFAULT_QUERY_KEY = "q";
const DEFAULT_SEARCH_ENDPOINT = "search";
const TOOL_RESULT_STATUS = Object.freeze({
  COMPLETED: TASK_STATUS.COMPLETED,
  PARTIAL: TASK_STATUS.PARTIAL,
  FAILED: TASK_STATUS.FAILED,
});
const PROMISE_STATUS = Object.freeze({
  FULFILLED: TASK_STATUS.FULFILLED,
  REJECTED: TASK_STATUS.REJECTED,
});
const MEMORY_PATHS = Object.freeze({
  MEMORY_DIR: "memory",
  LONG_MEMORY: "long-memory.md",
  LONG_MEMORY_METADATA: "long-memory/metadata.md",
  SHORT_MEMORY: "short-memory.json",
  LONG_MEMORY_MODEL: "long-memory-model.md",
  EXPERIENCE_MODEL: "experience-model.md",
  EXPERIENCE_DIR: "experience",
  DAILY_SUMMARY_DIR: "daily_summary",
  WEEKLY_SUMMARY_DIR: "weekly_summary",
  MONTHLY_SUMMARY_DIR: "monthly_summary",
  YEARLY_SUMMARY_DIR: "yearly_summary",
});
const HELP_HINTS = Object.freeze({
  EXPERIENCE: "Use read_file/list tools to inspect memory paths for experience help.",
});
const REQUEST_HELP_TYPES = Object.freeze({
  ALL: "all_help",
  MODEL: "model_help",
  WEB_SEARCH: "web_search_help",
  EXPERIENCE: "experience_help",
});

function normalizeName(value = "") {
  return String(value || "").trim();
}

function normalizeRequestType(value = "") {
  const normalized = normalizeName(value);
  if (!normalized) return REQUEST_HELP_TYPES.ALL;
  if (Object.values(REQUEST_HELP_TYPES).includes(normalized)) return normalized;
  return REQUEST_HELP_TYPES.ALL;
}

function isEnabled(config = {}) {
  return config?.enabled !== false;
}

function resolveHelpConfig(agentContext = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const effectiveConfig = mergeConfig(runtime?.globalConfig || {}, runtime?.userConfig || {});
  const toolConfig =
    effectiveConfig?.tools?.[REQUEST_HELP_TOOL_NAME] &&
    typeof effectiveConfig.tools[REQUEST_HELP_TOOL_NAME] === "object"
      ? effectiveConfig.tools[REQUEST_HELP_TOOL_NAME]
      : {};
  return { runtime, effectiveConfig, toolConfig };
}

function normalizeHelpServiceList(toolConfig = {}) {
  const configured = toolConfig?.help_services ?? toolConfig?.helpServices ?? DEFAULT_HELP_SERVICES;
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
      const endpointName = normalizeName(item?.endpointName ?? item?.endpoint_name ?? "");
      const customParam = normalizeName(item?.custom_param ?? item?.customParam ?? "");
      const queryKey = normalizeName(item?.query_key ?? item?.queryKey ?? DEFAULT_QUERY_KEY);
      const queryString =
        item?.queryString &&
        typeof item.queryString === "object" &&
        !Array.isArray(item.queryString)
          ? item.queryString
          : {};
      return {
        serviceName,
        endpointName,
        customParam,
        queryKey: queryKey || DEFAULT_QUERY_KEY,
        queryString,
      };
    })
    .filter((item) => item.serviceName);
}

function pickEndpointName(serviceCfg = {}, preferred = "") {
  const configured = normalizeName(preferred);
  const endpoints =
    serviceCfg?.endpoints && typeof serviceCfg.endpoints === "object" ? serviceCfg.endpoints : {};
  if (!Object.keys(endpoints).length) return "";
  if (configured && endpoints[configured]) return configured;
  if (endpoints[DEFAULT_SEARCH_ENDPOINT]) return DEFAULT_SEARCH_ENDPOINT;
  return String(Object.keys(endpoints)[0] || "").trim();
}

async function invokeOneHelpService({
  agentContext,
  runtime,
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
    [configItem?.queryKey || DEFAULT_QUERY_KEY]: helpContent,
  };
  try {
    const result = await invokeServiceHandler({
      agentContext,
      runtime,
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

function resolveHelpModelSpec({
  runtime = {},
  toolConfig = {},
  globalConfig = {},
  userConfig = {},
}) {
  const configuredHelpModel = normalizeName(toolConfig?.help_model ?? toolConfig?.helpModel ?? "");
  if (configuredHelpModel) {
    const spec = resolveModelSpecByName({
      modelName: configuredHelpModel,
      globalConfig,
      userConfig,
      fallbackToDefault: false,
    });
    if (!spec) throw new Error(`configured help model not found: ${configuredHelpModel}`);
    return spec;
  }
  const runtimeModel = normalizeName(runtime?.runtimeModel || "");
  if (runtimeModel) {
    const spec = resolveModelSpecByName({
      modelName: runtimeModel,
      globalConfig,
      userConfig,
      fallbackToDefault: false,
    });
    if (!spec) throw new Error(`runtime help model not found: ${runtimeModel}`);
    return spec;
  }
  const defaultSpec = resolveDefaultModelSpec({ globalConfig, userConfig });
  if (!defaultSpec) throw new Error("request help model is not configured");
  return defaultSpec;
}

async function invokeHelpModel({ helpContent, runtime, toolConfig, globalConfig, userConfig }) {
  const modelSpec = resolveHelpModelSpec({
    runtime,
    toolConfig,
    globalConfig,
    userConfig,
  });
  const modelPort = runtime?.modelPort;
  if (!modelPort || typeof modelPort.invoke !== "function") {
    throw new Error("request help requires runtime.modelPort");
  }
  const response = await modelPort.invoke({
    model: modelSpec,
    messages: [{ role: "user", content: helpContent }],
    options: {
      streaming: false,
      signal: runtime?.abortSignal || undefined,
    },
    invocation: {
      flow: "tool.request_help",
      purpose: "collaboration_help",
      domain: "collaboration",
      contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
    },
  });
  return {
    modelName: modelSpec.alias || modelSpec.model,
    content: response.output.text,
  };
}

function resolveMemoryHelpPaths(agentContext = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const basePath = normalizeName(
    agentContext?.context?.environment?.workspace?.basePath || runtime?.basePath || "",
  );
  if (!basePath) return {};
  const memoryDir = path.join(basePath, MEMORY_PATHS.MEMORY_DIR);
  return {
    basePath,
    memoryDir,
    longMemoryPath: path.join(memoryDir, MEMORY_PATHS.LONG_MEMORY),
    longMemoryMetadataPath: path.join(memoryDir, MEMORY_PATHS.LONG_MEMORY_METADATA),
    shortMemoryPath: path.join(memoryDir, MEMORY_PATHS.SHORT_MEMORY),
    longMemoryModelPath: path.join(memoryDir, MEMORY_PATHS.LONG_MEMORY_MODEL),
    experienceModelPath: path.join(memoryDir, MEMORY_PATHS.EXPERIENCE_MODEL),
    experienceDir: path.join(memoryDir, MEMORY_PATHS.EXPERIENCE_DIR),
    dailySummaryDir: path.join(memoryDir, MEMORY_PATHS.DAILY_SUMMARY_DIR),
    weeklySummaryDir: path.join(memoryDir, MEMORY_PATHS.WEEKLY_SUMMARY_DIR),
    monthlySummaryDir: path.join(memoryDir, MEMORY_PATHS.MONTHLY_SUMMARY_DIR),
    yearlySummaryDir: path.join(memoryDir, MEMORY_PATHS.YEARLY_SUMMARY_DIR),
  };
}

export function createRequestHelpTool({ agentContext } = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const requestHelpTool = new DynamicStructuredTool({
    name: REQUEST_HELP_TOOL_NAME,
    description: tTool(runtime, "tools.request_help.description"),
    schema: z.object({
      helpContent: z.string().describe(tTool(runtime, "tools.request_help.fieldHelpContent")),
      requestType: z
        .enum([
          REQUEST_HELP_TYPES.ALL,
          REQUEST_HELP_TYPES.MODEL,
          REQUEST_HELP_TYPES.WEB_SEARCH,
          REQUEST_HELP_TYPES.EXPERIENCE,
        ])
        .optional()
        .default(REQUEST_HELP_TYPES.ALL)
        .describe(tTool(runtime, "tools.request_help.fieldRequestType")),
    }),
    func: async ({ helpContent, requestType }) => {
      const normalizedHelpContent = String(helpContent || "").trim();
      const normalizedRequestType = normalizeRequestType(requestType);
      if (!normalizedHelpContent) {
        throw recoverableToolError(tTool(runtime, "tools.request_help.helpContentRequired"), {
          code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
        });
      }

      if (normalizedRequestType === REQUEST_HELP_TYPES.EXPERIENCE) {
        const memoryHelpPaths = resolveMemoryHelpPaths(agentContext);
        return toToolJsonResult(
          REQUEST_HELP_TOOL_NAME,
          {
            ok: true,
            status: TOOL_RESULT_STATUS.COMPLETED,
            requestType: normalizedRequestType,
            helpContent: normalizedHelpContent,
            hint: HELP_HINTS.EXPERIENCE,
            memoryHelpPaths,
          },
          true,
        );
      }

      const { effectiveConfig, toolConfig } = resolveHelpConfig(agentContext);
      const globalConfig = runtime?.globalConfig || {};
      const userConfig = runtime?.userConfig || {};
      const userId = normalizeName(
        agentContext?.userId || runtime?.userId || runtime?.systemRuntime?.userId || "",
      );
      const servicesConfig = effectiveConfig?.services || {};
      const helpServiceList = normalizeHelpServiceList(toolConfig);
      const shouldCallServices = Boolean(
        normalizedRequestType !== REQUEST_HELP_TYPES.MODEL && helpServiceList.length && userId,
      );
      const shouldCallModel = normalizedRequestType !== REQUEST_HELP_TYPES.WEB_SEARCH;

      if (normalizedRequestType === REQUEST_HELP_TYPES.WEB_SEARCH && !shouldCallServices) {
        throw recoverableToolError(tTool(runtime, "tools.request_help.webSearchHelpUnavailable"), {
          code: ERROR_CODE.RECOVERABLE_REQUEST_HELP_FAILED,
          details: {
            status: TOOL_RESULT_STATUS.FAILED,
            requestType: normalizedRequestType,
            configuredHelpServiceCount: helpServiceList.length,
          },
        });
      }

      const servicePromise = shouldCallServices
        ? Promise.all(
            helpServiceList.map((configItem) =>
              invokeOneHelpService({
                agentContext,
                runtime,
                globalConfig,
                userId,
                services: servicesConfig,
                helpContent: normalizedHelpContent,
                configItem,
              }),
            ),
          )
        : Promise.resolve([]);
      const modelPromise = shouldCallModel
        ? invokeHelpModel({
            helpContent: normalizedHelpContent,
            runtime,
            toolConfig,
            globalConfig,
            userConfig,
          })
        : Promise.resolve({
            modelName: "",
            content: "",
          });
      const [serviceSettled, modelSettled] = await Promise.allSettled([
        servicePromise,
        modelPromise,
      ]);
      const serviceResults =
        serviceSettled.status === PROMISE_STATUS.FULFILLED ? serviceSettled.value : [];
      const modelResult =
        modelSettled.status === PROMISE_STATUS.FULFILLED
          ? modelSettled.value
          : {
              modelName: "",
              content: "",
              error: modelSettled.reason?.message || String(modelSettled.reason || ""),
            };
      const serviceError =
        serviceSettled.status === PROMISE_STATUS.REJECTED
          ? serviceSettled.reason?.message || String(serviceSettled.reason || "")
          : "";
      const hasServiceSuccess = serviceResults.some((item) => item?.ok === true);
      const hasModelSuccess = shouldCallModel ? !modelResult?.error : false;
      const hasAnySuccess = shouldCallServices ? hasServiceSuccess : hasModelSuccess;
      const status = hasAnySuccess
        ? shouldCallServices && shouldCallModel
          ? hasServiceSuccess && hasModelSuccess
            ? TOOL_RESULT_STATUS.COMPLETED
            : TOOL_RESULT_STATUS.PARTIAL
          : TOOL_RESULT_STATUS.COMPLETED
        : TOOL_RESULT_STATUS.FAILED;
      const systemRuntime = getSystemRuntimeFromRuntime(runtime);
      systemRuntime.toolConsecutiveFailureCount = 0;

      if (status === TOOL_RESULT_STATUS.FAILED) {
        throw recoverableToolError(
          modelResult?.error || serviceError || tTool(runtime, "tools.request_help.requestFailed"),
          {
            code: ERROR_CODE.RECOVERABLE_REQUEST_HELP_FAILED,
            details: {
              status,
              requestType: normalizedRequestType,
              helpContent: normalizedHelpContent,
              serviceResults,
              modelResult,
              ...(serviceError ? { serviceError } : {}),
            },
          },
        );
      }

      return toToolJsonResult(
        REQUEST_HELP_TOOL_NAME,
        {
          ok: true,
          status,
          requestType: normalizedRequestType,
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
