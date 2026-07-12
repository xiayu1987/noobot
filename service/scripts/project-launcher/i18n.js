/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "./utils.js";

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

export function t(locale = "zh", key = "", params = {}) {
  const dict = TEXT[locale] || TEXT.zh;
  let content = String(dict[key] || TEXT.zh[key] || key || "");
  for (const [k, v] of Object.entries(params || {})) {
    content = content.replaceAll(`{${k}}`, String(v ?? ""));
  }
  return content;
}

export function normalizeSetupLocale(input = "", fallback = "zh") {
  const value = String(input || "").trim().toLowerCase();
  if (!value) return fallback;
  if (["zh", "zh-cn", "zh_cn"].includes(value)) return "zh";
  if (["en", "en-us", "en_us"].includes(value)) return "en";
  return fallback;
}

export function resolveConfigLanguage(setupLocale = "zh") {
  return setupLocale === "en" ? "en-US" : "zh-CN";
}

export function resolveTextLocaleFromConfigLanguage(configLanguage = "") {
  return String(configLanguage || "").trim().toLowerCase().startsWith("en") ? "en" : "zh";
}

export function localizeConfigTextValue(value, targetLocale = "zh") {
  if (typeof value !== "string") return value;
  if (targetLocale === "en") return CONFIG_TEXT_TO_EN.get(value) || value;
  return CONFIG_TEXT_TO_ZH.get(value) || value;
}

export function localizeConfigTextTree(input, targetLocale = "zh") {
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
