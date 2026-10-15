/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { createModelRequestExecutor } from "@noobot/model-runtime";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
import { buildTools } from "noobot-agent/tools";
import { sanitizeUserConfig } from "noobot-agent/config";
import {
  createConfigValueLookup,
  mergeConfigParamLayers,
  normalizeConfigParamsDocument,
  resolveConfigTemplates,
} from "@noobot/agent-config-protocol";
import { loadGlobalConfig } from "../src/config/core/global-config-loader.js";
import { createAgentContextEnvelope, createModelContext } from "@noobot/context-protocol";
import { createAgentExecutionScope } from "../src/context/agent-execution-scope.js";
import { resolveDefaultModelSpec, resolveModelSpecByName } from "noobot-agent/model";
import { text } from "@noobot/shared/value";

function parseArgs(argv = []) {
  const out = {
    userId: "admin",
    live: false,
    bindName: "",
    model: "",
    prompt: "",
    toolNames: [],
    globalConfigPath: "",
    workspaceRoot: "",
  };
  for (let argIndex = 0; argIndex < argv.length; argIndex += 1) {
    const arg = text(argv[argIndex]);
    if (arg === "--live") {
      out.live = true;
      continue;
    }
    const hasValueFlag = [
      "--userId",
      "--bind-name",
      "--model",
      "--prompt",
      "--tool",
      "--global-config-path",
      "--workspace-root",
    ].includes(arg);
    if (!hasValueFlag) continue;
    const value = text(argv[argIndex + 1]);
    if (arg === "--userId") out.userId = value || out.userId;
    else if (arg === "--bind-name") out.bindName = value;
    else if (arg === "--model") out.model = value;
    else if (arg === "--prompt") out.prompt = value;
    else if (arg === "--tool") {
      out.toolNames.push(
        ...value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      );
    } else if (arg === "--global-config-path") {
      out.globalConfigPath = value;
    } else if (arg === "--workspace-root") {
      out.workspaceRoot = value;
    }
    argIndex += 1;
  }
  return out;
}

function filterToolsByNames(tools = [], toolNames = []) {
  const requested = new Set(
    (Array.isArray(toolNames) ? toolNames : []).map((item) => text(item)).filter(Boolean),
  );
  if (!requested.size) return tools;
  return tools.filter((tool) => requested.has(text(tool?.name)));
}

function formatSchemaIssues(error) {
  const issues = Array.isArray(error?.issues) ? error.issues : [];
  if (!issues.length) return String(error?.message || error || "unknown schema error");
  return issues
    .map((issue) => {
      const fieldPath = Array.isArray(issue?.path) ? issue.path.join(".") : "";
      return `${fieldPath || "(root)"}: ${String(issue?.message || "invalid value")}`;
    })
    .join("; ");
}

async function assertToolCallMatchesSchema(tool, call) {
  if (!tool?.schema || typeof tool.schema.safeParseAsync !== "function") {
    throw new TypeError(`tool ${String(tool?.name || "(unknown)")} has no parseable schema`);
  }
  const parsed = await tool.schema.safeParseAsync(call?.args);
  if (parsed.success) return parsed.data;
  throw new Error(`model returned invalid tool arguments: ${formatSchemaIssues(parsed.error)}`);
}

function resolveScriptPaths({ globalConfigPath = "", workspaceRoot = "" } = {}) {
  if (!globalConfigPath) throw new TypeError("--global-config-path is required");
  if (!workspaceRoot) throw new TypeError("--workspace-root is required");
  return {
    resolvedWorkspaceRoot: path.resolve(process.cwd(), workspaceRoot),
    resolvedGlobalConfigPath: path.resolve(process.cwd(), globalConfigPath),
  };
}

async function readOptionalJson(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
  return JSON.parse(raw);
}

function dedupeToolsByName(tools = []) {
  return Array.from(
    new Map((Array.isArray(tools) ? tools : []).map((tool) => [text(tool?.name), tool])).values(),
  ).filter((tool) => text(tool?.name));
}

function createMinimalAgentContext({ userId = "", globalConfig = {}, userConfig = {} } = {}) {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const dialogProcessId = "22222222-2222-4222-8222-222222222222";
  const turnScopeId = "schema-check:turn";
  const messageId = "33333333-3333-4333-8333-333333333333";
  const runtime = {
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
        selectedConnectorIds: [],
        maxToolLoopTurns: 4,
      },
    },
  };
  const modelContext = createModelContext({
    messageBlocks: { system: [], history: [], incremental: [] },
    activeTurnIdentity: { dialogProcessId, turnScopeId },
  });
  const context = createAgentContextEnvelope({
    identity: {
      userId,
      sessionId,
      rootSessionId: sessionId,
      parentSessionId: "",
      dialogProcessId,
      turnScopeId,
      runId: "schema-check:run",
      messageId,
    },
    environment: {},
    execution: {},
    modelContext,
  });
  return createAgentExecutionScope({
    context,
    bindings: { runtime, tools: [] },
  });
}

function resolveModelSpecAllowDisabled({
  modelName = "",
  globalConfig = {},
  userConfig = {},
} = {}) {
  const input = text(modelName);
  if (!input) return null;
  const globalProviders =
    globalConfig?.providers && typeof globalConfig.providers === "object"
      ? globalConfig.providers
      : {};
  const userProviders =
    userConfig?.providers && typeof userConfig.providers === "object" ? userConfig.providers : {};
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
  return null;
}

async function selectToolsInteractive(tools = []) {
  const source = Array.isArray(tools) ? tools : [];
  if (!source.length) return source;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return source;
  const toolNames = source.map((tool) => text(tool?.name));
  console.log("[tool-schema-check] 可选工具：");
  toolNames.forEach((name, index) => {
    console.log(`${index + 1}. ${name}`);
  });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = String(
      await rl.question("输入要测试的工具编号/名称（逗号分隔，直接回车=全部）："),
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
    return source.filter((tool) => selectedNames.has(text(tool?.name)));
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { resolvedWorkspaceRoot, resolvedGlobalConfigPath } = resolveScriptPaths({
    globalConfigPath: args.globalConfigPath,
    workspaceRoot: args.workspaceRoot,
  });
  const rawGlobalConfig = await loadGlobalConfig(resolvedGlobalConfigPath);
  const rawUserConfig = await readOptionalJson(
    path.join(resolvedWorkspaceRoot, args.userId, "config.json"),
  );
  const workspaceConfigParamsRaw = await readOptionalJson(
    path.join(resolvedWorkspaceRoot, "config-params.json"),
  );
  const userConfigParamsRaw = await readOptionalJson(
    path.join(resolvedWorkspaceRoot, args.userId, "config-params.json"),
  );
  const workspaceConfigParams = normalizeConfigParamsDocument(workspaceConfigParamsRaw).values;
  const userConfigParams = normalizeConfigParamsDocument(userConfigParamsRaw).values;
  const mergedConfigParams = mergeConfigParamLayers(workspaceConfigParams, userConfigParams);
  const lookup = createConfigValueLookup(mergedConfigParams, process.env);
  const globalConfig = resolveConfigTemplates(rawGlobalConfig, {
    lookup,
  });
  const userConfig = sanitizeUserConfig(resolveConfigTemplates(rawUserConfig, { lookup }));
  const agentContext = createMinimalAgentContext({
    userId: args.userId,
    globalConfig,
    userConfig,
  });
  const tools = await buildTools({ agentContext });
  const mergedTools = dedupeToolsByName(tools);
  const requestedTools = filterToolsByNames(mergedTools, args.toolNames);
  const targetTools = args.toolNames.length
    ? requestedTools
    : await selectToolsInteractive(requestedTools);

  if (!targetTools.length) {
    console.log("[tool-schema-check] no tools matched");
    return;
  }
  if (args.bindName && targetTools.length !== 1) {
    console.error("[tool-schema-check] --bind-name requires exactly one selected tool");
    process.exitCode = 1;
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
  const resolvedApiKey = text(modelSpec?.api_key);
  const resolvedBaseUrl = text(modelSpec?.base_url);
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

  const modelPort = createModelRequestExecutor({
    credentialPort: {
      resolve: async () => resolvedApiKey,
    },
  });
  const liveErrors = [];
  for (const item of targetTools) {
    try {
      const toolName = text(item?.name);
      const boundTool = args.bindName
        ? Object.assign(Object.create(Object.getPrototypeOf(item)), item, { name: args.bindName })
        : item;
      const boundToolName = text(boundTool?.name);
      const displayName = boundToolName === toolName ? toolName : `${toolName} as ${boundToolName}`;
      const result = await modelPort.invoke({
        model: modelSpec,
        messages: [
          {
            role: "user",
            content:
              args.prompt ||
              [
                "请调用工具完成测试。",
                `工具名：${boundToolName}`,
                "要求：必须发起一次 tool call；参数可使用最小可行占位值。",
              ].join("\n"),
          },
        ],
        tools: [boundTool],
        options: {
          streaming: false,
          toolBinding: { tool_choice: "auto" },
        },
        invocation: {
          sessionId: "tool-schema-check",
          parentSessionId: "",
          dialogProcessId: "tool-schema-check",
          turnScopeId: `tool-schema-check:${toolName}`,
          runId: `tool-schema-check:${toolName}`,
          flow: "diagnostic.tool_schema",
          purpose: "live_tool_schema_validation",
          domain: "diagnostic",
          contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
        },
      });
      const toolCalls = result.output.toolCalls;
      const hasExpectedToolCall = toolCalls.some((call) => text(call?.name) === boundToolName);
      if (!hasExpectedToolCall) {
        throw new Error("model did not choose expected tool");
      }
      const expectedCall = toolCalls.find((call) => text(call?.name) === boundToolName);
      await assertToolCallMatchesSchema(item, expectedCall);
      console.log(`[tool-schema-check] live pass: ${displayName}`);
    } catch (error) {
      const message = String(error?.message || error || "");
      liveErrors.push({ name: String(item?.name || ""), error: message });
      const configuredName = String(item?.name || "");
      const displayName = args.bindName ? `${configuredName} as ${args.bindName}` : configuredName;
      console.error(`[tool-schema-check] live fail: ${displayName} -> ${message}`);
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
