/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

const DEFAULT_WORKSPACE_ROOT = "../workspace";
const DEFAULT_TEMPLATE_PATH = "../user-template/default-user";
const DEFAULT_SUPER_ADMIN_USER_ID = "admin";
const DEFAULT_SUPER_ADMIN_CONNECT_CODE = "change-your-connect-code";
const MODEL_FORMAT_VALUES = new Set(["dashscope", "openai_compatible"]);
const CONFIG_SYNC_SKIP_TOP_LEVEL_KEYS = new Set([
  "workspace_root",
  "workspace_template_path",
  "streaming",
  "super_admin",
]);

const BUILTIN_CONFIG_PRUNE_PATHS = Object.freeze([
  ["memory_max_items"],
  ["memoryMaxItems"],
  ["max_tool_loop_turns"],
  ["maxToolLoopTurns"],
  ["run_timeout_ms"], // legacyKeys prune
  ["runTimeoutMs"],
  ["context", "main_model_recent_window"],
  ["context", "mainModelRecentWindow"],
  ["context", "main_model_recent_limit"],
  ["context", "mainModelRecentLimit"],
  ["session", "recent_message_limit"],
  ["session", "recentMessageLimit"],
  ["attachments", "max_file_count"],
  ["attachments", "maxFileCount"],
  ["attachments", "max_file_size_bytes"],
  ["attachments", "maxFileSizeBytes"],
  ["attachments", "max_total_size_bytes"],
  ["attachments", "maxTotalSizeBytes"],
  ["attachments", "allowed_extensions"],
  ["attachments", "allowedExtensions"],
  ["attachments", "allowed_mime_types"],
  ["attachments", "allowedMimeTypes"],
  ["tools", "delegate_task_async", "wait_timeout_ms"],
  ["tools", "delegate_task_async", "waitTimeoutMs"],
  ["tools", "delegate_task_async", "max_sub_agent_depth"],
  ["tools", "delegate_task_async", "maxSubAgentDepth"],
  ["tools", "delegate_task_async", "poll_interval_ms"],
  ["tools", "delegate_task_async", "pollIntervalMs"],
  ["tools", "wait_async_task_result", "poll_interval_ms"],
  ["tools", "wait_async_task_result", "pollIntervalMs"],
  ["tools", "process_content_task", "max_tool_loop_turns"],
  ["tools", "process_content_task", "maxToolLoopTurns"],
  ["tools", "execute_script", "script_timeout_ms"],
  ["tools", "execute_script", "scriptTimeoutMs"],
  ["tools", "process_connector_tool", "max_tool_loop_turns"],
  ["tools", "process_connector_tool", "maxToolLoopTurns"],
  ["tools", "access_connector", "command_file", "max_bytes"],
  ["tools", "access_connector", "command_file", "maxBytes"],
  ["tools", "access_connector", "command_file", "allowed_extensions"],
  ["tools", "access_connector", "command_file", "allowedExtensions"],
  ["tools", "task_summary", "phase_summary_loop_turns"],
  ["tools", "task_summary", "phaseSummaryLoopTurns"],
  ["tools", "task_summary", "phase_summary_message_chars_threshold"],
  ["tools", "task_summary", "phaseSummaryMessageCharsThreshold"],
  ["tools", "task_summary", "max_tool_loop_turns"],
  ["tools", "task_summary", "maxToolLoopTurns"],
  ["tools", "request_help", "help_prompt_loop_turns"],
  ["tools", "request_help", "helpPromptLoopTurns"],
  ["tools", "request_help", "tool_failure_help_count"],
  ["tools", "request_help", "toolFailureHelpCount"],
  ["plugins", "workflow", "timeout_ms"],
  ["plugins", "workflow", "timeoutMs"],
  ["plugins", "workflow", "maxAutoTransitions"],
  ["plugins", "workflow", "maxParallelNodeAgents"],
  ["plugins", "workflow", "miniRunnerMaxTurns"],
  ["plugins", "workflow", "contextWindowRecentMessageLimit"],
  ["plugins", "harness", "miniRunnerMaxTurns"],
  ["plugins", "harness", "contextWindowRecentMessageLimit"],
  ["openvscode", "start_timeout_ms"],
  ["openvscode", "startTimeoutMs"],
  ["openvscode", "idle_timeout_ms"],
  ["openvscode", "idleTimeoutMs"],
]);
const CONFIG_TEXT_BILINGUAL_PAIRS = [
  {
    zh: "目录映射配置示例：source 与 target 同时非空才会生效；不配置或留空 source 则不映射",
    en: "Mount config example: only effective when both source and target are non-empty; no mount is applied when source is omitted or empty.",
  },
  { zh: "全能", en: "All-round" },
  {
    zh: "通用情景：不限制工具和上下文，按任务需要自主选择能力。",
    en: "General scenario: no tool/context restrictions, capabilities are chosen based on task needs.",
  },
  { zh: "编程", en: "Programming" },
  { zh: "文本", en: "Text" },
  {
    zh: "优先分析代码结构，再构建完整上下文后执行修改与验证。",
    en: "Prioritize code structure analysis, then build full context before making changes and verification.",
  },
  { zh: "擅长通用对话、多模态推理", en: "Strong at general conversation and multimodal reasoning." },
  { zh: "擅长图片生成", en: "Strong at image generation." },
  { zh: "擅长通用对话、快速响应", en: "Strong at general conversation with fast responses." },
  { zh: "多模态理解", en: "Multimodal understanding." },
  { zh: "优先用于补充实时或外部网页信息，先检索再回答。", en: "Use for real-time/external web info; search first, then answer." },
  { zh: "搜索网页", en: "Search web pages" },
  { zh: "返回可引用的检索结果摘要与来源。", en: "Return citable result summaries with sources." },
  { zh: "searx实例地址", en: "SearX instance address" },
  { zh: "用于天气类查询，优先返回结构化天气信息。", en: "Use for weather queries, preferably returning structured weather data." },
  { zh: "天气查询", en: "Weather query" },
  { zh: "输入城市名，返回当前与未来天气。", en: "Input a city name to return current and forecast weather." },
  { zh: "提供 12306购票信息查询等服务", en: "Provides 12306 ticket information query and related services." },
  { zh: "用于铁路票务查询场景，先说明查询条件再调用。", en: "For railway ticket queries: state conditions first, then call the service." },
];
const CONFIG_TEXT_TO_EN = new Map(CONFIG_TEXT_BILINGUAL_PAIRS.map((pair) => [pair.zh, pair.en]));
const CONFIG_TEXT_TO_ZH = new Map(CONFIG_TEXT_BILINGUAL_PAIRS.map((pair) => [pair.en, pair.zh]));

const TEXT = {
  zh: {
    chooseLanguage: "请选择引导语言",
    chooseLanguageHint: "可输入 1/2 或 zh/en",
    chooseFormat: "请选择对话模型 format",
    chooseFormatHint: "可输入 1/2 或 dashscope/openai_compatible",
    invalidLanguage: "语言仅支持 zh 或 en，已使用默认 zh。",
    requiredField: "该项必填，请重新输入。",
    invalidInput: "输入不合法，请重试。",
    stepWorkspaceRoot: "第一步：workspace_root",
    stepWorkspaceTemplatePath: "第二步：workspace_template_path",
    stepModelFormat: "第三步：对话模型 format (dashscope 或 openai_compatible)",
    stepModelName: "第三步：模型名 model",
    stepApiKey: "第三步：api_key",
    stepBaseUrl: "第三步：base_url",
    stepSuperAdminUserId: "第四步：super_admin.user_id",
    stepSuperAdminConnectCode: "第四步：super_admin.connect_code",
    defaultSuffix: " (默认: {value})",
    errWorkspaceRootRequired: "workspace_root 不能为空",
    errWorkspaceTemplatePathRequired: "workspace_template_path 不能为空",
    errFormatInvalid: "format 仅支持 dashscope 或 openai_compatible",
    errModelRequired: "model 不能为空",
    errApiKeyRequired: "api_key 不能为空",
    errBaseUrlRequired: "base_url 不能为空",
    errSuperAdminUserIdRequired: "super_admin.user_id 不能为空",
    errSuperAdminConnectCodeRequired: "super_admin.connect_code 不能为空",
    errMissingEnvHint:
      "当前为非交互模式，请设置环境变量：NOOBOT_MODEL_FORMAT NOOBOT_MODEL_NAME NOOBOT_MODEL_API_KEY NOOBOT_MODEL_BASE_URL（可选: NOOBOT_WORKSPACE_ROOT NOOBOT_WORKSPACE_TEMPLATE_PATH NOOBOT_SUPER_ADMIN_USER_ID NOOBOT_SUPER_ADMIN_CONNECT_CODE NOOBOT_SETUP_LANG）",
    warnTemplateMissing:
      "[project-launcher] 警告: 模板目录缺少 config.json/config.example.json，已跳过模板与用户配置同步: {path}",
    logLanguageSynced: "[project-launcher] 已按语言同步配置: {language}",
    logInitDone: "[project-launcher] 初始化完成，已生成 global.config.json 并同步模板配置。",
    labelTemplateConfig: "模板配置",
    labelTargetConfig: "目标配置",
    labelGlobalExample: "global.config.example.json",
    labelGlobalConfig: "global.config.json",
  },
  en: {
    chooseLanguage: "Choose setup language",
    chooseLanguageHint: "Input 1/2 or zh/en",
    chooseFormat: "Choose model format",
    chooseFormatHint: "Input 1/2 or dashscope/openai_compatible",
    invalidLanguage: "Language only supports zh or en, fallback to zh.",
    requiredField: "This field is required, please try again.",
    invalidInput: "Invalid input, please retry.",
    stepWorkspaceRoot: "Step 1: workspace_root",
    stepWorkspaceTemplatePath: "Step 2: workspace_template_path",
    stepModelFormat: "Step 3: model format (dashscope or openai_compatible)",
    stepModelName: "Step 3: model name",
    stepApiKey: "Step 3: api_key",
    stepBaseUrl: "Step 3: base_url",
    stepSuperAdminUserId: "Step 4: super_admin.user_id",
    stepSuperAdminConnectCode: "Step 4: super_admin.connect_code",
    defaultSuffix: " (default: {value})",
    errWorkspaceRootRequired: "workspace_root is required",
    errWorkspaceTemplatePathRequired: "workspace_template_path is required",
    errFormatInvalid: "format must be dashscope or openai_compatible",
    errModelRequired: "model is required",
    errApiKeyRequired: "api_key is required",
    errBaseUrlRequired: "base_url is required",
    errSuperAdminUserIdRequired: "super_admin.user_id is required",
    errSuperAdminConnectCodeRequired: "super_admin.connect_code is required",
    errMissingEnvHint:
      "Non-interactive mode detected. Please set env vars: NOOBOT_MODEL_FORMAT NOOBOT_MODEL_NAME NOOBOT_MODEL_API_KEY NOOBOT_MODEL_BASE_URL (optional: NOOBOT_WORKSPACE_ROOT NOOBOT_WORKSPACE_TEMPLATE_PATH NOOBOT_SUPER_ADMIN_USER_ID NOOBOT_SUPER_ADMIN_CONNECT_CODE NOOBOT_SETUP_LANG)",
    warnTemplateMissing:
      "[project-launcher] Warning: template path missing config.json/config.example.json, skipped template/user sync: {path}",
    logLanguageSynced: "[project-launcher] Language synchronized to configs: {language}",
    logInitDone: "[project-launcher] Initialization completed: global.config.json created and template sync done.",
    labelTemplateConfig: "Template config",
    labelTargetConfig: "Target config",
    labelGlobalExample: "global.config.example.json",
    labelGlobalConfig: "global.config.json",
  },
};

function t(locale = "zh", key = "", params = {}) {
  const dict = TEXT[locale] || TEXT.zh;
  let content = String(dict[key] || TEXT.zh[key] || key || "");
  for (const [k, v] of Object.entries(params || {})) {
    content = content.replaceAll(`{${k}}`, String(v ?? ""));
  }
  return content;
}

function isPlainObject(input) {
  return input !== null && typeof input === "object" && !Array.isArray(input);
}

function deepClone(input) {
  return JSON.parse(JSON.stringify(input));
}

function hasOwnProperty(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeSetupLocale(input = "", fallback = "zh") {
  const value = String(input || "").trim().toLowerCase();
  if (!value) return fallback;
  if (["zh", "zh-cn", "zh_cn"].includes(value)) return "zh";
  if (["en", "en-us", "en_us"].includes(value)) return "en";
  return fallback;
}

function resolveConfigLanguage(setupLocale = "zh") {
  return setupLocale === "en" ? "en-US" : "zh-CN";
}

function resolveTextLocaleFromConfigLanguage(configLanguage = "") {
  return String(configLanguage || "").trim().toLowerCase().startsWith("en") ? "en" : "zh";
}

function localizeConfigTextValue(value, targetLocale = "zh") {
  if (typeof value !== "string") return value;
  if (targetLocale === "en") return CONFIG_TEXT_TO_EN.get(value) || value;
  return CONFIG_TEXT_TO_ZH.get(value) || value;
}

function localizeConfigTextTree(input, targetLocale = "zh") {
  if (typeof input === "string") return localizeConfigTextValue(input, targetLocale);
  if (Array.isArray(input)) {
    return input.map((item) => localizeConfigTextTree(item, targetLocale));
  }
  if (!isPlainObject(input)) return input;
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = localizeConfigTextTree(value, targetLocale);
  }
  return output;
}

function parseCliOptions(argv = []) {
  const items = Array.isArray(argv) ? argv : [];
  const options = {
    nonInteractive: items.includes("--non-interactive"),
    lang: "",
  };

  for (let index = 0; index < items.length; index += 1) {
    const item = String(items[index] || "").trim();
    if (item.startsWith("--lang=")) {
      options.lang = item.slice("--lang=".length).trim();
      continue;
    }
    if (item === "--lang") {
      options.lang = String(items[index + 1] || "").trim();
      index += 1;
    }
  }

  return options;
}

function normalizeModelFormat(input = "") {
  const format = String(input || "").trim().toLowerCase();
  if (!format) return "";
  return MODEL_FORMAT_VALUES.has(format) ? format : "";
}


function deleteConfigPath(root = {}, segments = []) {
  if (!isPlainObject(root) || !Array.isArray(segments) || !segments.length) return;
  let node = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    node = node?.[segments[index]];
    if (!isPlainObject(node)) return;
  }
  delete node[segments[segments.length - 1]];
}

function pruneBuiltInConfigParams(payload = {}) {
  if (!isPlainObject(payload)) return payload;
  const output = deepClone(payload);
  for (const segments of BUILTIN_CONFIG_PRUNE_PATHS) {
    deleteConfigPath(output, segments);
  }
  for (const key of ["context", "session", "attachments", "openvscode"]) {
    if (isPlainObject(output[key]) && !Object.keys(output[key]).length) {
      delete output[key];
    }
  }
  return output;
}

function mergeIncremental({ template, target, pathDepth = 0, skipTopLevelKeys = new Set() } = {}) {
  if (Array.isArray(template)) {
    return target === undefined ? deepClone(template) : target;
  }
  if (!isPlainObject(template)) {
    return target === undefined ? template : target;
  }

  const output = isPlainObject(target) ? deepClone(target) : {};
  const targetObject = isPlainObject(target) ? target : {};

  for (const [key, templateValue] of Object.entries(template)) {
    if (pathDepth === 0 && skipTopLevelKeys.has(key)) continue;
    if (!hasOwnProperty(targetObject, key)) {
      output[key] = deepClone(templateValue);
      continue;
    }
    const targetValue = targetObject[key];
    if (isPlainObject(templateValue) && isPlainObject(targetValue)) {
      output[key] = mergeIncremental({
        template: templateValue,
        target: targetValue,
        pathDepth: pathDepth + 1,
        skipTopLevelKeys,
      });
      continue;
    }
    if (Array.isArray(templateValue) && Array.isArray(targetValue)) {
      output[key] = targetValue;
      continue;
    }
    output[key] = targetValue;
  }

  return output;
}

async function fileExists(filePath = "") {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonRelaxed(filePath = "", fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function readJsonStrict(filePath = "", label = "JSON") {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} parse failed: ${filePath} (${error?.message || String(error)})`);
  }
}

async function writeJson(filePath = "", payload = {}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function ensureModelProxyConfig({ serviceRoot } = {}) {
  const modelProxyRoot = path.resolve(serviceRoot, "../model-proxy");
  const examplePath = path.join(modelProxyRoot, "model-proxy.config.example.json");
  const configPath = path.join(modelProxyRoot, "model-proxy.config.json");

  if (await fileExists(configPath)) return;
  if (!(await fileExists(examplePath))) return;

  await copyFile(examplePath, configPath);
}

async function ensureAgentProxyConfig({ serviceRoot } = {}) {
  const agentProxyRoot = path.resolve(serviceRoot, "../agent-proxy");
  const examplePath = path.join(agentProxyRoot, "agent-proxy.config.example.json");
  const configPath = path.join(agentProxyRoot, "agent-proxy.config.json");

  if (await fileExists(configPath)) return;
  if (!(await fileExists(examplePath))) return;

  await copyFile(examplePath, configPath);
}

function normalizeProviderAlias(modelName = "") {
  const normalized = String(modelName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (!normalized) return "custom_model";
  return /^[0-9]/.test(normalized) ? `model_${normalized}` : normalized;
}

function resolveEnvNamesByFormat(format = "") {
  if (format === "dashscope") {
    return {
      apiKeyEnv: "DASHSCOPE_API_KEY",
      baseUrlEnv: "DASHSCOPE_API_ADDRESS",
    };
  }
  return {
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_API_ADDRESS",
  };
}

function buildProviderFromTemplate({
  providerTemplate,
  format,
  modelName,
  apiKeyVar,
  baseUrlVar,
  forceConversationDefaults = false,
} = {}) {
  const baseProvider = isPlainObject(providerTemplate)
    ? deepClone(providerTemplate)
    : {
        enabled: true,
        used_for_conversation: true,
        temperature: 0.7,
        max_tokens: 10000,
        multimodal_generation: {
          support_understanding: false,
          support_generation: {
            enabled: false,
            support_scope: [],
          },
        },
      };

  baseProvider.enabled = true;
  baseProvider.used_for_conversation = true;
  baseProvider.api_key = apiKeyVar;
  baseProvider.base_url = baseUrlVar;
  baseProvider.model = modelName;
  baseProvider.format = format;

  if (forceConversationDefaults) {
    baseProvider.multimodal_generation = {
      support_understanding: false,
      support_generation: {
        enabled: false,
        support_scope: [],
      },
    };
  }

  if (format === "dashscope") {
    if (!hasOwnProperty(baseProvider, "enable_thinking")) {
      baseProvider.enable_thinking = false;
    }
    if (!hasOwnProperty(baseProvider, "preserve_thinking")) {
      baseProvider.preserve_thinking = false;
    }
    if (!hasOwnProperty(baseProvider, "thinking_budget")) {
      baseProvider.thinking_budget = 0;
    }
    if (hasOwnProperty(baseProvider, "reasoning_effort")) {
      delete baseProvider.reasoning_effort;
    }
  }

  if (format === "openai_compatible" && !hasOwnProperty(baseProvider, "reasoning_effort")) {
    baseProvider.reasoning_effort = "low";
  }

  return baseProvider;
}

function resolveTemplateProvider(providers = {}, format = "") {
  const sourceProviders = isPlainObject(providers) ? providers : {};
  const matchedProvider = Object.values(sourceProviders).find(
    (provider) => String(provider?.format || "").trim() === format,
  );
  if (isPlainObject(matchedProvider)) return matchedProvider;
  const firstProvider = Object.values(sourceProviders).find((provider) => isPlainObject(provider));
  return isPlainObject(firstProvider) ? firstProvider : null;
}

const BUILTIN_SCENARIO_KEYS = new Set(["full", "programming", "text"]);

function normalizeBuiltinScenarioConfigForLauncher(scenarios = {}, { programmingModel = "" } = {}) {
  const source = isPlainObject(scenarios) ? scenarios : {};
  const defaultScenario = String(source.default || "full").trim();
  const definitions = isPlainObject(source.definitions) ? source.definitions : {};
  const programming = isPlainObject(definitions.programming) ? definitions.programming : {};
  const text = isPlainObject(definitions.text) ? definitions.text : {};
  const model = String(programmingModel || programming.model || "").trim();
  const textModel = String(programmingModel || text.model || "").trim();
  return {
    default: BUILTIN_SCENARIO_KEYS.has(defaultScenario) ? defaultScenario : "full",
    definitions: {
      programming: model ? { model } : {},
      text: textModel ? { model: textModel } : {},
    },
  };
}

function alignInitialModelReferences({
  globalConfig = {},
  providerAlias = "",
} = {}) {
  const alias = String(providerAlias || "").trim();
  if (!isPlainObject(globalConfig) || !alias) return globalConfig;

  if (isPlainObject(globalConfig.attachments)) {
    const attachmentModels = isPlainObject(globalConfig.attachments.attachment_models)
      ? { ...globalConfig.attachments.attachment_models }
      : null;
    if (attachmentModels) {
      for (const mediaTypeKey of ["audio", "video", "image"]) {
        if (hasOwnProperty(attachmentModels, mediaTypeKey)) {
          attachmentModels[mediaTypeKey] = alias;
        }
      }
      globalConfig.attachments = {
        ...globalConfig.attachments,
        attachment_models: attachmentModels,
      };
    }
  }

  if (isPlainObject(globalConfig.plugins) && isPlainObject(globalConfig.plugins.harness)) {
    const harness = { ...globalConfig.plugins.harness };
    if (isPlainObject(harness.stepModels)) {
      const nextStepModels = { ...harness.stepModels };
      for (const stepKey of Object.keys(nextStepModels)) {
        nextStepModels[stepKey] = alias;
      }
      harness.stepModels = nextStepModels;
    }
    if (isPlainObject(harness.capabilityModelByPurpose)) {
      const nextCapabilityMap = { ...harness.capabilityModelByPurpose };
      for (const purposeKey of Object.keys(nextCapabilityMap)) {
        nextCapabilityMap[purposeKey] = alias;
      }
      harness.capabilityModelByPurpose = nextCapabilityMap;
    }
    globalConfig.plugins = {
      ...globalConfig.plugins,
      harness,
    };
  }

  if (isPlainObject(globalConfig.plugins) && isPlainObject(globalConfig.plugins.workflow)) {
    globalConfig.plugins = {
      ...globalConfig.plugins,
      workflow: {
        ...globalConfig.plugins.workflow,
        semanticModel: alias,
      },
    };
  }

  if (isPlainObject(globalConfig.tools) && isPlainObject(globalConfig.tools.web_search)) {
    const webSearch = { ...globalConfig.tools.web_search };
    const responsesApi = isPlainObject(webSearch.responses_api)
      ? { ...webSearch.responses_api }
      : {};
    responsesApi.model = alias;
    webSearch.responses_api = responsesApi;
    globalConfig.tools = {
      ...globalConfig.tools,
      web_search: webSearch,
    };
  }

  globalConfig.scenarios = normalizeBuiltinScenarioConfigForLauncher(globalConfig.scenarios, {
    programmingModel: alias,
  });

  return globalConfig;
}

async function alignInitialModelReferencesForFile({
  filePath = "",
  providerAlias = "",
} = {}) {
  if (!filePath || !providerAlias) return;
  if (!(await fileExists(filePath))) return;
  const payload = await readJsonStrict(filePath, "config");
  if (!isPlainObject(payload)) return;
  const nextPayload = alignInitialModelReferences({
    globalConfig: deepClone(payload),
    providerAlias,
  });
  if (JSON.stringify(nextPayload) !== JSON.stringify(payload)) {
    await writeJson(filePath, nextPayload);
  }
}

function parseTemplateVariables(input, collector = new Set()) {
  if (typeof input === "string") {
    const pattern = /\$\{([A-Z0-9_]+)\}/g;
    let matched = pattern.exec(input);
    while (matched) {
      const key = String(matched[1] || "").trim();
      if (key) collector.add(key);
      matched = pattern.exec(input);
    }
    return collector;
  }
  if (Array.isArray(input)) {
    for (const item of input) parseTemplateVariables(item, collector);
    return collector;
  }
  if (isPlainObject(input)) {
    for (const value of Object.values(input)) parseTemplateVariables(value, collector);
  }
  return collector;
}

function validateCollectedAnswers(raw = {}) {
  const setupLocale = normalizeSetupLocale(raw.setupLocale, "zh");
  const workspaceRoot = String(raw.workspaceRoot || "").trim();
  const workspaceTemplatePath = String(raw.workspaceTemplatePath || "").trim();
  const format = normalizeModelFormat(raw.format);
  const modelName = String(raw.modelName || "").trim();
  const apiKey = String(raw.apiKey || "").trim();
  const baseUrl = String(raw.baseUrl || "").trim();
  const superAdminUserId = String(raw.superAdminUserId || "").trim();
  const superAdminConnectCode = String(raw.superAdminConnectCode || "").trim();

  if (!workspaceRoot) throw new Error(t(setupLocale, "errWorkspaceRootRequired"));
  if (!workspaceTemplatePath) throw new Error(t(setupLocale, "errWorkspaceTemplatePathRequired"));
  if (!format) throw new Error(t(setupLocale, "errFormatInvalid"));
  if (!modelName) throw new Error(t(setupLocale, "errModelRequired"));
  if (!apiKey) throw new Error(t(setupLocale, "errApiKeyRequired"));
  if (!baseUrl) throw new Error(t(setupLocale, "errBaseUrlRequired"));
  if (!superAdminUserId) throw new Error(t(setupLocale, "errSuperAdminUserIdRequired"));
  if (!superAdminConnectCode) throw new Error(t(setupLocale, "errSuperAdminConnectCodeRequired"));

  return {
    setupLocale,
    configLanguage: resolveConfigLanguage(setupLocale),
    workspaceRoot,
    workspaceTemplatePath,
    format,
    modelName,
    apiKey,
    baseUrl,
    superAdminUserId,
    superAdminConnectCode,
  };
}

function resolveDefaultSetupLocale(cliOptions = {}) {
  return normalizeSetupLocale(
    cliOptions.lang || process.env.NOOBOT_SETUP_LANG || process.env.NOOBOT_LANG || process.env.LANG,
    "zh",
  );
}

function collectAnswersFromEnv(cliOptions = {}) {
  const setupLocale = resolveDefaultSetupLocale(cliOptions);
  const raw = {
    setupLocale,
    workspaceRoot: process.env.NOOBOT_WORKSPACE_ROOT || DEFAULT_WORKSPACE_ROOT,
    workspaceTemplatePath: process.env.NOOBOT_WORKSPACE_TEMPLATE_PATH || DEFAULT_TEMPLATE_PATH,
    format: process.env.NOOBOT_MODEL_FORMAT || "openai_compatible",
    modelName: process.env.NOOBOT_MODEL_NAME || "",
    apiKey: process.env.NOOBOT_MODEL_API_KEY || "",
    baseUrl: process.env.NOOBOT_MODEL_BASE_URL || "",
    superAdminUserId: process.env.NOOBOT_SUPER_ADMIN_USER_ID || DEFAULT_SUPER_ADMIN_USER_ID,
    superAdminConnectCode:
      process.env.NOOBOT_SUPER_ADMIN_CONNECT_CODE || DEFAULT_SUPER_ADMIN_CONNECT_CODE,
  };
  return validateCollectedAnswers(raw);
}

async function askInteractiveQuestions(cliOptions = {}) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  async function ask({ locale = "zh", label, defaultValue = "", required = false, validator = null } = {}) {
    while (true) {
      const suffix = defaultValue ? t(locale, "defaultSuffix", { value: defaultValue }) : "";
      const answer = (await rl.question(`${label}${suffix}: `)).trim();
      const value = answer || String(defaultValue || "").trim();
      if (required && !value) {
        console.log(t(locale, "requiredField"));
        continue;
      }
      if (typeof validator === "function") {
        const validationResult = validator(value);
        if (validationResult !== true) {
          console.log(typeof validationResult === "string" ? validationResult : t(locale, "invalidInput"));
          continue;
        }
      }
      return value;
    }
  }

  async function askChoice({
    locale = "zh",
    title = "",
    hint = "",
    options = [],
    defaultValue = "",
  } = {}) {
    const normalizedOptions = (Array.isArray(options) ? options : []).map((item) => ({
      value: String(item?.value || "").trim(),
      label: String(item?.label || item?.value || "").trim(),
    })).filter((item) => item.value);
    const optionMap = new Map(normalizedOptions.map((item) => [item.value, item.value]));
    const indexMap = new Map(normalizedOptions.map((item, idx) => [String(idx + 1), item.value]));
    const defaultNormalized = String(defaultValue || "").trim();

    while (true) {
      console.log(`${title}:`);
      normalizedOptions.forEach((item, idx) => {
        const isDefault = item.value === defaultNormalized;
        console.log(`  ${idx + 1}) ${item.value}${isDefault ? " (default)" : ""} - ${item.label}`);
      });
      if (hint) console.log(`  ${hint}`);
      const rawAnswer = String(await rl.question("> ")).trim();
      const answer = rawAnswer || defaultNormalized;
      if (!answer) {
        console.log(t(locale, "requiredField"));
        continue;
      }
      const byIndex = indexMap.get(answer);
      if (byIndex) return byIndex;
      const normalizedAnswer = String(answer).trim();
      if (optionMap.has(normalizedAnswer)) return normalizedAnswer;
      console.log(t(locale, "invalidInput"));
    }
  }

  try {
    const initialLocale = resolveDefaultSetupLocale(cliOptions);
    const setupLocale = normalizeSetupLocale(
      await askChoice({
        locale: initialLocale,
        title: t(initialLocale, "chooseLanguage"),
        hint: t(initialLocale, "chooseLanguageHint"),
        options: [
          { value: "zh", label: "中文" },
          { value: "en", label: "English" },
        ],
        defaultValue: initialLocale || "zh",
      }),
      "zh",
    );

    const workspaceRoot = await ask({
      locale: setupLocale,
      label: t(setupLocale, "stepWorkspaceRoot"),
      defaultValue: DEFAULT_WORKSPACE_ROOT,
      required: true,
    });
    const workspaceTemplatePath = await ask({
      locale: setupLocale,
      label: t(setupLocale, "stepWorkspaceTemplatePath"),
      defaultValue: DEFAULT_TEMPLATE_PATH,
      required: true,
    });
    const format = await askChoice({
      locale: setupLocale,
      title: t(setupLocale, "chooseFormat"),
      hint: t(setupLocale, "chooseFormatHint"),
      options: [
        { value: "openai_compatible", label: "OpenAI-compatible API" },
        { value: "dashscope", label: "DashScope" },
      ],
      defaultValue: "openai_compatible",
    });
    const modelName = await ask({
      locale: setupLocale,
      label: t(setupLocale, "stepModelName"),
      required: true,
    });
    const apiKey = await ask({
      locale: setupLocale,
      label: t(setupLocale, "stepApiKey"),
      required: true,
    });
    const baseUrl = await ask({
      locale: setupLocale,
      label: t(setupLocale, "stepBaseUrl"),
      required: true,
    });
    const superAdminUserId = await ask({
      locale: setupLocale,
      label: t(setupLocale, "stepSuperAdminUserId"),
      defaultValue: DEFAULT_SUPER_ADMIN_USER_ID,
      required: true,
    });
    const superAdminConnectCode = await ask({
      locale: setupLocale,
      label: t(setupLocale, "stepSuperAdminConnectCode"),
      defaultValue: DEFAULT_SUPER_ADMIN_CONNECT_CODE,
      required: true,
    });

    return validateCollectedAnswers({
      setupLocale,
      workspaceRoot,
      workspaceTemplatePath,
      format,
      modelName,
      apiKey,
      baseUrl,
      superAdminUserId,
      superAdminConnectCode,
    });
  } finally {
    rl.close();
  }
}

async function resolveInitializationAnswers({ cliOptions = {} } = {}) {
  const nonInteractive = Boolean(cliOptions?.nonInteractive);
  const isInteractiveTerminal = process.stdin.isTTY && process.stdout.isTTY;

  if (nonInteractive || !isInteractiveTerminal) {
    try {
      return collectAnswersFromEnv(cliOptions);
    } catch (error) {
      const locale = resolveDefaultSetupLocale(cliOptions);
      throw new Error(`${error?.message || String(error)}\n${t(locale, "errMissingEnvHint")}`);
    }
  }

  return askInteractiveQuestions(cliOptions);
}

async function upsertConfigParams({
  workspaceRootAbsolutePath,
  entries = {},
  overwriteKeys = [],
} = {}) {
  const filePath = path.join(workspaceRootAbsolutePath, "config-params.json");
  const currentPayload = (await readJsonRelaxed(filePath, {})) || {};
  const values = isPlainObject(currentPayload?.values) ? { ...currentPayload.values } : {};
  const descriptions = isPlainObject(currentPayload?.descriptions)
    ? { ...currentPayload.descriptions }
    : {};
  const overwriteKeySet = new Set(
    (Array.isArray(overwriteKeys) ? overwriteKeys : [])
      .map((key) => String(key || "").trim().toUpperCase())
      .filter(Boolean),
  );

  for (const [key, value] of Object.entries(entries || {})) {
    const normalizedKey = String(key || "").trim().toUpperCase();
    if (!normalizedKey) continue;
    const incomingValue = String(value ?? "").trim();
    if (!hasOwnProperty(values, normalizedKey)) {
      values[normalizedKey] = incomingValue;
    } else if (overwriteKeySet.has(normalizedKey)) {
      // 仅允许用户本次录入变量覆盖已有值
      values[normalizedKey] = incomingValue;
    }
    if (!hasOwnProperty(descriptions, normalizedKey)) {
      descriptions[normalizedKey] = "";
    }
  }

  await writeJson(filePath, {
    values,
    descriptions,
  });
}

async function syncJsonFileIncremental({ templateFilePath, targetFilePath, skipTopLevelKeys = new Set(), locale = "zh" } = {}) {
  const templateJson = await readJsonStrict(templateFilePath, t(locale, "labelTemplateConfig"));
  if (!isPlainObject(templateJson)) return false;

  const targetExists = await fileExists(targetFilePath);
  const targetJson = targetExists
    ? await readJsonStrict(targetFilePath, t(locale, "labelTargetConfig"))
    : {};
  const merged = pruneBuiltInConfigParams(mergeIncremental({
    template: pruneBuiltInConfigParams(templateJson),
    target: pruneBuiltInConfigParams(targetJson),
    skipTopLevelKeys,
  }));

  if (!targetExists || JSON.stringify(targetJson) !== JSON.stringify(merged)) {
    await writeJson(targetFilePath, merged);
    return true;
  }
  return false;
}

async function collectWorkspaceUserIds({ workspaceRootAbsolutePath, superAdminUserId = "" } = {}) {
  const userIds = new Set();
  const workspaceDirUserIds = new Set();

  try {
    const entries = await readdir(workspaceRootAbsolutePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const userId = String(entry.name || "").trim();
      if (!userId) continue;
      workspaceDirUserIds.add(userId);
    }
  } catch {
    // ignore
  }

  // 仅同步已经初始化（目录已存在）的用户，不主动创建新用户目录
  for (const userId of workspaceDirUserIds) {
    userIds.add(userId);
  }

  const normalizedSuperAdminUserId = String(superAdminUserId || "").trim();
  if (normalizedSuperAdminUserId && workspaceDirUserIds.has(normalizedSuperAdminUserId)) {
    userIds.add(normalizedSuperAdminUserId);
  }

  const usersFilePath = path.join(workspaceRootAbsolutePath, "user.json");
  const usersPayload = await readJsonRelaxed(usersFilePath, {});
  const users = Array.isArray(usersPayload?.users) ? usersPayload.users : [];
  for (const userItem of users) {
    const userId = String(userItem?.userId || "").trim();
    if (userId && workspaceDirUserIds.has(userId)) {
      userIds.add(userId);
    }
  }

  return Array.from(userIds).sort((leftUserId, rightUserId) => leftUserId.localeCompare(rightUserId));
}

async function syncTemplateAndUserConfigs({
  workspaceRootAbsolutePath,
  workspaceTemplateAbsolutePath,
  superAdminUserId,
  locale = "zh",
} = {}) {
  await mkdir(workspaceTemplateAbsolutePath, { recursive: true });
  await mkdir(workspaceRootAbsolutePath, { recursive: true });

  const templateExamplePath = path.join(workspaceTemplateAbsolutePath, "config.example.json");
  const templateConfigPath = path.join(workspaceTemplateAbsolutePath, "config.json");
  const templateExampleExists = await fileExists(templateExamplePath);
  const templateConfigExists = await fileExists(templateConfigPath);
  const templateSeedPath = templateExampleExists
    ? templateExamplePath
    : templateConfigExists
      ? templateConfigPath
      : "";

  if (!templateSeedPath) {
    console.warn(t(locale, "warnTemplateMissing", { path: workspaceTemplateAbsolutePath }));
    return;
  }

  if (templateExampleExists) {
    await syncJsonFileIncremental({
      templateFilePath: templateExamplePath,
      targetFilePath: templateConfigPath,
      skipTopLevelKeys: CONFIG_SYNC_SKIP_TOP_LEVEL_KEYS,
      locale,
    });
  } else if (templateConfigExists) {
    await syncJsonFileIncremental({
      templateFilePath: templateConfigPath,
      targetFilePath: templateExamplePath,
      skipTopLevelKeys: CONFIG_SYNC_SKIP_TOP_LEVEL_KEYS,
      locale,
    });
  }

  const finalTemplateConfigExists = await fileExists(templateConfigPath);
  const finalTemplateExampleExists = await fileExists(templateExamplePath);
  const finalTemplateSeedPath = finalTemplateConfigExists
    ? templateConfigPath
    : finalTemplateExampleExists
      ? templateExamplePath
      : "";

  const userIds = await collectWorkspaceUserIds({
    workspaceRootAbsolutePath,
    superAdminUserId,
  });

  for (const userId of userIds) {
    const userBasePath = path.join(workspaceRootAbsolutePath, userId);
    await mkdir(userBasePath, { recursive: true });
    if (finalTemplateConfigExists) {
      await syncJsonFileIncremental({
        templateFilePath: templateConfigPath,
        targetFilePath: path.join(userBasePath, "config.json"),
        skipTopLevelKeys: CONFIG_SYNC_SKIP_TOP_LEVEL_KEYS,
        locale,
      });
    } else if (finalTemplateSeedPath) {
      await syncJsonFileIncremental({
        templateFilePath: finalTemplateSeedPath,
        targetFilePath: path.join(userBasePath, "config.json"),
        skipTopLevelKeys: CONFIG_SYNC_SKIP_TOP_LEVEL_KEYS,
        locale,
      });
    }
    if (finalTemplateExampleExists) {
      await syncJsonFileIncremental({
        templateFilePath: templateExamplePath,
        targetFilePath: path.join(userBasePath, "config.example.json"),
        skipTopLevelKeys: CONFIG_SYNC_SKIP_TOP_LEVEL_KEYS,
        locale,
      });
    } else if (finalTemplateSeedPath) {
      await syncJsonFileIncremental({
        templateFilePath: finalTemplateSeedPath,
        targetFilePath: path.join(userBasePath, "config.example.json"),
        skipTopLevelKeys: CONFIG_SYNC_SKIP_TOP_LEVEL_KEYS,
        locale,
      });
    }
  }
}

async function syncLanguageForFile(filePath = "", language = "", textLocale = "zh") {
  if (!filePath || !language) return;
  if (!(await fileExists(filePath))) return;
  const payload = await readJsonStrict(filePath, "config");
  if (!isPlainObject(payload)) return;
  const nextPayload = localizeConfigTextTree(deepClone(payload), textLocale);
  const preferences = isPlainObject(nextPayload.preferences) ? { ...nextPayload.preferences } : {};
  preferences.language = language;
  nextPayload.preferences = preferences;
  if (JSON.stringify(nextPayload) !== JSON.stringify(payload)) {
    await writeJson(filePath, nextPayload);
  }
}

async function syncLanguageAcrossTemplateAndUsers({
  workspaceRootAbsolutePath,
  workspaceTemplateAbsolutePath,
  superAdminUserId,
  language,
  locale = "zh",
} = {}) {
  if (!language) return;
  const textLocale = resolveTextLocaleFromConfigLanguage(language);
  const templateTargets = [
    path.join(workspaceTemplateAbsolutePath, "config.json"),
    path.join(workspaceTemplateAbsolutePath, "config.example.json"),
  ];
  for (const targetPath of templateTargets) {
    await syncLanguageForFile(targetPath, language, textLocale);
  }

  const userIds = await collectWorkspaceUserIds({
    workspaceRootAbsolutePath,
    superAdminUserId,
  });
  for (const userId of userIds) {
    await syncLanguageForFile(
      path.join(workspaceRootAbsolutePath, userId, "config.json"),
      language,
      textLocale,
    );
    await syncLanguageForFile(
      path.join(workspaceRootAbsolutePath, userId, "config.example.json"),
      language,
      textLocale,
    );
  }

  console.log(t(locale, "logLanguageSynced", { language }));
}

async function syncInitialModelReferencesAcrossTemplateAndUsers({
  workspaceRootAbsolutePath,
  workspaceTemplateAbsolutePath,
  superAdminUserId,
  providerAlias,
} = {}) {
  const normalizedProviderAlias = String(providerAlias || "").trim();
  if (!normalizedProviderAlias) return;

  const templateTargets = [
    path.join(workspaceTemplateAbsolutePath, "config.json"),
    path.join(workspaceTemplateAbsolutePath, "config.example.json"),
  ];
  for (const targetPath of templateTargets) {
    await alignInitialModelReferencesForFile({
      filePath: targetPath,
      providerAlias: normalizedProviderAlias,
    });
  }

  const userIds = await collectWorkspaceUserIds({
    workspaceRootAbsolutePath,
    superAdminUserId,
  });
  for (const userId of userIds) {
    await alignInitialModelReferencesForFile({
      filePath: path.join(workspaceRootAbsolutePath, userId, "config.json"),
      providerAlias: normalizedProviderAlias,
    });
    await alignInitialModelReferencesForFile({
      filePath: path.join(workspaceRootAbsolutePath, userId, "config.example.json"),
      providerAlias: normalizedProviderAlias,
    });
  }
}

async function collectTemplateParamKeys({ globalConfigPath, workspaceTemplateAbsolutePath } = {}) {
  const keys = new Set();
  if (await fileExists(globalConfigPath)) {
    const globalConfig = await readJsonRelaxed(globalConfigPath, {});
    parseTemplateVariables(globalConfig, keys);
  }
  const templateConfigPath = path.join(workspaceTemplateAbsolutePath, "config.json");
  const templateExamplePath = path.join(workspaceTemplateAbsolutePath, "config.example.json");
  if (await fileExists(templateConfigPath)) {
    const templateConfig = await readJsonRelaxed(templateConfigPath, {});
    parseTemplateVariables(templateConfig, keys);
  }
  if (await fileExists(templateExamplePath)) {
    const templateExample = await readJsonRelaxed(templateExamplePath, {});
    parseTemplateVariables(templateExample, keys);
  }
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}

async function ensureWorkspaceConfigParamsCatalog({
  workspaceRootAbsolutePath,
  globalConfigPath,
  workspaceTemplateAbsolutePath,
  explicitEntries = {},
} = {}) {
  const templateKeys = await collectTemplateParamKeys({
    globalConfigPath,
    workspaceTemplateAbsolutePath,
  });
  const entries = {};
  for (const key of templateKeys) {
    entries[key] = "";
  }
  for (const [key, value] of Object.entries(explicitEntries || {})) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) continue;
    entries[normalizedKey] = String(value ?? "").trim();
  }
  await upsertConfigParams({
    workspaceRootAbsolutePath,
    entries,
    overwriteKeys: Object.keys(explicitEntries || {}),
  });
}

async function initializeGlobalConfigWhenMissing({
  globalExamplePath,
  globalConfigPath,
  serviceRoot,
  cliOptions,
} = {}) {
  const answers = await resolveInitializationAnswers({ cliOptions });
  const globalExampleConfig = await readJsonStrict(
    globalExamplePath,
    t(answers.setupLocale, "labelGlobalExample"),
  );
  if (!isPlainObject(globalExampleConfig)) {
    throw new Error(`invalid global config example: ${globalExamplePath}`);
  }

  const providerAlias = normalizeProviderAlias(answers.modelName);
  const { apiKeyEnv, baseUrlEnv } = resolveEnvNamesByFormat(answers.format);
  const apiKeyTemplateValue = `\${${apiKeyEnv}}`;
  const baseUrlTemplateValue = `\${${baseUrlEnv}}`;

  const globalConfig = localizeConfigTextTree(deepClone(globalExampleConfig), answers.setupLocale);
  globalConfig.workspace_root = answers.workspaceRoot;
  globalConfig.workspace_template_path = answers.workspaceTemplatePath;
  globalConfig.super_admin = {
    user_id: answers.superAdminUserId,
    connect_code: answers.superAdminConnectCode,
  };
  const preferences = isPlainObject(globalConfig.preferences) ? { ...globalConfig.preferences } : {};
  preferences.language = answers.configLanguage;
  globalConfig.preferences = preferences;

  const providers = isPlainObject(globalConfig.providers) ? { ...globalConfig.providers } : {};
  const aliasExists = isPlainObject(providers[providerAlias]);
  const providerSeed = aliasExists
    ? providers[providerAlias]
    : resolveTemplateProvider(providers, answers.format);
  providers[providerAlias] = buildProviderFromTemplate({
    providerTemplate: providerSeed,
    format: answers.format,
    modelName: answers.modelName,
    apiKeyVar: apiKeyTemplateValue,
    baseUrlVar: baseUrlTemplateValue,
    forceConversationDefaults: !aliasExists,
  });

  globalConfig.providers = providers;
  globalConfig.default_provider = providerAlias;
  alignInitialModelReferences({
    globalConfig,
    providerAlias,
  });

  await writeJson(globalConfigPath, globalConfig);

  const workspaceRootAbsolutePath = path.resolve(serviceRoot, answers.workspaceRoot);
  const workspaceTemplateAbsolutePath = path.resolve(serviceRoot, answers.workspaceTemplatePath);

  await syncTemplateAndUserConfigs({
    workspaceRootAbsolutePath,
    workspaceTemplateAbsolutePath,
    superAdminUserId: answers.superAdminUserId,
    locale: answers.setupLocale,
  });

  await syncInitialModelReferencesAcrossTemplateAndUsers({
    workspaceRootAbsolutePath,
    workspaceTemplateAbsolutePath,
    superAdminUserId: answers.superAdminUserId,
    providerAlias,
  });

  await syncLanguageAcrossTemplateAndUsers({
    workspaceRootAbsolutePath,
    workspaceTemplateAbsolutePath,
    superAdminUserId: answers.superAdminUserId,
    language: answers.configLanguage,
    locale: answers.setupLocale,
  });

  await ensureWorkspaceConfigParamsCatalog({
    workspaceRootAbsolutePath,
    globalConfigPath,
    workspaceTemplateAbsolutePath,
    explicitEntries: {
      [apiKeyEnv]: answers.apiKey,
      [baseUrlEnv]: answers.baseUrl,
    },
  });

  console.log(t(answers.setupLocale, "logInitDone"));
}

async function syncWhenGlobalConfigExists({ globalExamplePath, globalConfigPath, serviceRoot } = {}) {
  const [globalExampleConfig, globalConfig] = await Promise.all([
    readJsonStrict(globalExamplePath, t("zh", "labelGlobalExample")),
    readJsonStrict(globalConfigPath, t("zh", "labelGlobalConfig")),
  ]);

  if (!isPlainObject(globalExampleConfig) || !isPlainObject(globalConfig)) return;

  const mergedGlobal = pruneBuiltInConfigParams(mergeIncremental({
    template: pruneBuiltInConfigParams(globalExampleConfig),
    target: pruneBuiltInConfigParams(globalConfig),
    skipTopLevelKeys: CONFIG_SYNC_SKIP_TOP_LEVEL_KEYS,
  }));

  const existingConfigLanguage = String(mergedGlobal?.preferences?.language || "").trim();
  const mergedGlobalLocalized = existingConfigLanguage
    ? localizeConfigTextTree(
        mergedGlobal,
        resolveTextLocaleFromConfigLanguage(existingConfigLanguage),
      )
    : mergedGlobal;

  if (JSON.stringify(globalConfig) !== JSON.stringify(mergedGlobalLocalized)) {
    await writeJson(globalConfigPath, mergedGlobalLocalized);
  }

  const workspaceRootRelative = String(
    mergedGlobalLocalized.workspace_root || DEFAULT_WORKSPACE_ROOT,
  );
  const workspaceTemplateRelative = String(
    mergedGlobalLocalized.workspace_template_path || DEFAULT_TEMPLATE_PATH,
  );

  const workspaceRootAbsolutePath = path.resolve(serviceRoot, workspaceRootRelative);
  const workspaceTemplateAbsolutePath = path.resolve(serviceRoot, workspaceTemplateRelative);

  await syncTemplateAndUserConfigs({
    workspaceRootAbsolutePath,
    workspaceTemplateAbsolutePath,
    superAdminUserId: String(mergedGlobalLocalized?.super_admin?.user_id || "").trim(),
    locale: normalizeSetupLocale(process.env.NOOBOT_SETUP_LANG || process.env.NOOBOT_LANG || process.env.LANG, "zh"),
  });

  await syncLanguageAcrossTemplateAndUsers({
    workspaceRootAbsolutePath,
    workspaceTemplateAbsolutePath,
    superAdminUserId: String(mergedGlobalLocalized?.super_admin?.user_id || "").trim(),
    language: String(mergedGlobalLocalized?.preferences?.language || "").trim(),
    locale: normalizeSetupLocale(process.env.NOOBOT_SETUP_LANG || process.env.NOOBOT_LANG || process.env.LANG, "zh"),
  });

  await ensureWorkspaceConfigParamsCatalog({
    workspaceRootAbsolutePath,
    globalConfigPath,
    workspaceTemplateAbsolutePath,
  });
}

async function runProjectLauncher() {
  const serviceRoot = process.cwd();
  const cliOptions = parseCliOptions(process.argv.slice(2));
  const globalConfigPath = path.resolve(serviceRoot, "./config/global.config.json");
  const globalExamplePath = path.resolve(serviceRoot, "./config/global.config.example.json");

  await ensureModelProxyConfig({ serviceRoot });
  await ensureAgentProxyConfig({ serviceRoot });

  if (!(await fileExists(globalConfigPath))) {
    await initializeGlobalConfigWhenMissing({
      globalExamplePath,
      globalConfigPath,
      serviceRoot,
      cliOptions,
    });
    return;
  }

  await syncWhenGlobalConfigExists({
    globalExamplePath,
    globalConfigPath,
    serviceRoot,
  });
}

await runProjectLauncher();
