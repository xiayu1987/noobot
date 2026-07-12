/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import process from "node:process";
import readline from "node:readline/promises";
import {
  DEFAULT_SUPER_ADMIN_CONNECT_CODE,
  DEFAULT_SUPER_ADMIN_USER_ID,
  DEFAULT_TEMPLATE_PATH,
  DEFAULT_WORKSPACE_ROOT,
} from "./constants.js";
import { normalizeModelFormat } from "./cli.js";
import { normalizeSetupLocale, resolveConfigLanguage, t } from "./i18n.js";

export function validateCollectedAnswers(raw = {}) {
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

export function resolveDefaultSetupLocale(cliOptions = {}) {
  return normalizeSetupLocale(
    cliOptions.lang || process.env.NOOBOT_SETUP_LANG || process.env.NOOBOT_LANG || process.env.LANG,
    "zh",
  );
}

export function collectAnswersFromEnv(cliOptions = {}) {
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

export async function askInteractiveQuestions(cliOptions = {}) {
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

export async function resolveInitializationAnswers({ cliOptions = {} } = {}) {
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
