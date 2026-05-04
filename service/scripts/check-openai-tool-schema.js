/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { buildTools } from "../system-core/tools/index.js";
import { createConnectorChannelTools } from "../system-core/tools/connectors/connector-channel-tools.js";
import {
  loadGlobalConfig,
  resolveConfigSecrets,
  sanitizeUserConfig,
} from "../system-core/config/index.js";
import { resolveDefaultModelSpec, resolveModelSpecByName } from "../system-core/model/index.js";

function parseArgs(argv = []) {
  const out = {
    userId: "admin",
    live: false,
    model: "",
  };
  for (let argIndex = 0; argIndex < argv.length; argIndex += 1) {
    const arg = String(argv[argIndex] || "").trim();
    if (arg === "--live") {
      out.live = true;
      continue;
    }
    const hasValueFlag = ["--userId", "--model"].includes(arg);
    if (!hasValueFlag) continue;
    const value = String(argv[argIndex + 1] || "").trim();
    if (arg === "--userId") out.userId = value || out.userId;
    else if (arg === "--model") out.model = value;
    argIndex += 1;
  }
  return out;
}

async function readJsonSafe(filePath = "", fallback = {}) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeConfigParams(input = {}) {
  const rawValues =
    input?.values && typeof input.values === "object" ? input.values : {};
  return Object.fromEntries(
    Object.entries(rawValues)
      .map(([paramKey, paramValue]) => [
        String(paramKey || "").trim(),
        String(paramValue ?? "").trim(),
      ])
      .filter(([paramKey]) => Boolean(paramKey)),
  );
}

function mergeConfigParamsWithFallback(systemParams = {}, userParams = {}) {
  const base = {
    ...(systemParams && typeof systemParams === "object" ? systemParams : {}),
  };
  const userSource = userParams && typeof userParams === "object" ? userParams : {};
  for (const [paramKey, rawValue] of Object.entries(userSource)) {
    const normalizedKey = String(paramKey || "").trim();
    if (!normalizedKey) continue;
    const normalizedValue = String(rawValue ?? "").trim();
    if (!normalizedValue) continue;
    base[normalizedKey] = normalizedValue;
  }
  return base;
}

function dedupeToolsByName(tools = []) {
  return Array.from(
    new Map(
      (Array.isArray(tools) ? tools : []).map((tool) => [
        String(tool?.name || "").trim(),
        tool,
      ]),
    ).values(),
  ).filter((tool) => String(tool?.name || "").trim());
}

function createMinimalAgentContext({ userId = "", globalConfig = {}, userConfig = {} } = {}) {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const dialogProcessId = "22222222-2222-4222-8222-222222222222";
  return {
    userId,
    runtime: {
      userId,
      globalConfig,
      userConfig,
      sharedTools: {},
      systemRuntime: {
        userId,
        sessionId,
        rootSessionId: sessionId,
        parentSessionId: "",
        caller: "user",
        dialogProcessId,
        config: {
          allowUserInteraction: true,
          selectedConnectors: {},
          maxToolLoopTurns: 4,
        },
      },
    },
    payload: {
      tools: {
        registry: [],
      },
    },
  };
}

function resolveModelSpecAllowDisabled({
  modelName = "",
  globalConfig = {},
  userConfig = {},
} = {}) {
  const input = String(modelName || "").trim();
  if (!input) return null;
  const globalProviders =
    globalConfig?.providers && typeof globalConfig.providers === "object"
      ? globalConfig.providers
      : {};
  const userProviders =
    userConfig?.providers && typeof userConfig.providers === "object"
      ? userConfig.providers
      : {};
  const mergedProviders = { ...globalProviders };
  for (const [alias, spec] of Object.entries(userProviders)) {
    mergedProviders[alias] = {
      ...(globalProviders?.[alias] && typeof globalProviders[alias] === "object"
        ? globalProviders[alias]
        : {}),
      ...(spec && typeof spec === "object" ? spec : {}),
    };
  }
  if (mergedProviders?.[input] && typeof mergedProviders[input] === "object") {
    return { alias: input, ...mergedProviders[input] };
  }
  const hitByModel = Object.entries(mergedProviders).find(
    ([, spec]) => String(spec?.model || "").trim() === input,
  );
  if (hitByModel) {
    const [alias, spec] = hitByModel;
    return { alias, ...spec };
  }
  return null;
}

async function selectToolsInteractive(tools = []) {
  const source = Array.isArray(tools) ? tools : [];
  if (!source.length) return source;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return source;
  const toolNames = source.map((tool) => String(tool?.name || "").trim());
  console.log("[tool-schema-check] 可选工具：");
  toolNames.forEach((name, index) => {
    console.log(`${index + 1}. ${name}`);
  });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = String(
      await rl.question(
        "输入要测试的工具编号/名称（逗号分隔，直接回车=全部）：",
      ),
    )
      .trim()
      .toLowerCase();
    if (!answer) return source;
    const parts = answer
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const selectedNames = new Set();
    for (const part of parts) {
      const asNumber = Number(part);
      if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= toolNames.length) {
        selectedNames.add(toolNames[asNumber - 1]);
        continue;
      }
      const hit = toolNames.find((name) => name.toLowerCase() === part);
      if (hit) selectedNames.add(hit);
    }
    if (!selectedNames.size) return source;
    return source.filter((tool) => selectedNames.has(String(tool?.name || "").trim()));
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const rawGlobalConfig = await loadGlobalConfig(
    path.join(cwd, "config/global.config.json"),
  );
  const rawUserConfig = await readJsonSafe(
    path.join(cwd, `../workspace/${args.userId}/config.json`),
    {},
  );
  const workspaceConfigParamsRaw = await readJsonSafe(
    path.join(cwd, "../workspace/config-params.json"),
    {},
  );
  const userConfigParamsRaw = await readJsonSafe(
    path.join(cwd, `../workspace/${args.userId}/config-params.json`),
    {},
  );
  const workspaceConfigParams = normalizeConfigParams(workspaceConfigParamsRaw);
  const userConfigParams = normalizeConfigParams(userConfigParamsRaw);
  const globalConfigParams =
    rawGlobalConfig?.configParams && typeof rawGlobalConfig.configParams === "object"
      ? rawGlobalConfig.configParams
      : {};
  const mergedConfigParams = mergeConfigParamsWithFallback(
    mergeConfigParamsWithFallback(globalConfigParams, workspaceConfigParams),
    userConfigParams,
  );
  const globalConfig = resolveConfigSecrets(rawGlobalConfig, {
    configParams: mergedConfigParams,
    env: process.env,
  });
  const userConfig = {
    ...sanitizeUserConfig(
      resolveConfigSecrets(rawUserConfig, {
        configParams: mergedConfigParams,
        env: process.env,
      }),
    ),
    configParams: mergedConfigParams,
  };
  const agentContext = createMinimalAgentContext({
    userId: args.userId,
    globalConfig,
    userConfig,
  });
  const tools = await buildTools({ agentContext });
  const extraConnectorTools = createConnectorChannelTools({ agentContext });
  const mergedTools = dedupeToolsByName([...tools, ...extraConnectorTools]);
  const targetTools = await selectToolsInteractive(mergedTools);

  if (!targetTools.length) {
    console.log("[tool-schema-check] no tools matched");
    return;
  }

  const convertErrors = [];
  let convertedCount = 0;
  for (const tool of targetTools) {
    try {
      convertToOpenAITool(tool);
      convertedCount += 1;
    } catch (error) {
      convertErrors.push({
        name: String(tool?.name || ""),
        error: error?.message || String(error),
      });
    }
  }

  if (convertErrors.length) {
    console.error("[tool-schema-check] convert failed:");
    for (const item of convertErrors) {
      console.error(`- ${item.name}: ${item.error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`[tool-schema-check] convert pass: ${convertedCount}`);

  if (!args.live) {
    console.log("[tool-schema-check] skip live validation (use --live)");
    return;
  }

  let modelSpec = args.model
    ? resolveModelSpecByName({
        modelName: args.model,
        globalConfig,
        userConfig,
        fallbackToDefault: false,
      })
    : resolveDefaultModelSpec({ globalConfig, userConfig });
  if (!modelSpec && args.model) {
    modelSpec = resolveModelSpecAllowDisabled({
      modelName: args.model,
      globalConfig,
      userConfig,
    });
    if (modelSpec) {
      console.warn(
        `[tool-schema-check] warning: model "${args.model}" is disabled in providers, using it anyway for live validation`,
      );
    }
  }
  const resolvedApiKey = String(modelSpec?.api_key || "").trim();
  const resolvedBaseUrl = String(modelSpec?.base_url || "").trim();
  if (!modelSpec?.model || !resolvedApiKey) {
    console.error("[tool-schema-check] live check requires model+api_key");
    console.error(
      `[tool-schema-check] resolved model alias=${String(modelSpec?.alias || "")} model=${String(modelSpec?.model || "")}`,
    );
    console.error(
      `[tool-schema-check] resolved apiKey length=${resolvedApiKey.length} baseUrl=${resolvedBaseUrl || "(empty)"}`,
    );
    console.error(
      "[tool-schema-check] hint: set workspace/<user>/config-params.json values.OPENAI_API_KEY (or pass --apiKey)",
    );
    process.exitCode = 1;
    return;
  }

  const llm = new ChatOpenAI({
    model: String(modelSpec.model || ""),
    temperature: Number(modelSpec?.temperature ?? 0),
    streaming: false,
    apiKey: resolvedApiKey,
    ...(resolvedBaseUrl ? { configuration: { baseURL: resolvedBaseUrl } } : {}),
  });
  const liveErrors = [];
  for (const item of targetTools) {
    try {
      const toolName = String(item?.name || "").trim();
      const result = await llm
        .bindTools([item], { tool_choice: "auto" })
        .invoke([
          new HumanMessage(
            [
              "请调用工具完成测试。",
              `工具名：${toolName}`,
              "要求：必须发起一次 tool call；参数可使用最小可行占位值。",
            ].join("\n"),
          ),
        ]);
      const toolCalls = Array.isArray(result?.tool_calls) ? result.tool_calls : [];
      const hasExpectedToolCall = toolCalls.some(
        (call) => String(call?.name || "").trim() === toolName,
      );
      if (!hasExpectedToolCall) {
        throw new Error("model did not choose expected tool");
      }
      console.log(`[tool-schema-check] live pass: ${toolName}`);
    } catch (error) {
      const message = String(error?.message || error || "");
      liveErrors.push({ name: String(item?.name || ""), error: message });
      console.error(
        `[tool-schema-check] live fail: ${String(item?.name || "")} -> ${message}`,
      );
    }
  }

  if (liveErrors.length) {
    process.exitCode = 1;
    return;
  }
  console.log("[tool-schema-check] all live checks passed");
}

main().catch((error) => {
  console.error("[tool-schema-check] fatal:", error?.message || String(error));
  process.exitCode = 1;
});
