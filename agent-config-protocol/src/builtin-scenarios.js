/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject } from "./utils.js";

export const BUILTIN_SCENARIO_KEYS = Object.freeze(["full", "programming", "text"]);
export const PROGRAMMING_SCENARIO_KEY = "programming";
export const TEXT_SCENARIO_KEY = "text";

export const PROGRAMMING_REQUIRED_TOOL_NAMES = Object.freeze([
  "read_file",
  "write_file",
  "search",
  "patch_file",
  "execute_script",
  "multimodal_generate",
  "multimodal_parse",
]);
export const PROGRAMMING_AUXILIARY_TOOL_NAMES = Object.freeze([
  "user_interaction",
  "task_summary",
  "task_check",
  "request_help",
  "web_search",
]);
export const PROGRAMMING_TOOL_NAMES = Object.freeze([
  ...PROGRAMMING_REQUIRED_TOOL_NAMES,
  ...PROGRAMMING_AUXILIARY_TOOL_NAMES,
]);

export const BUILTIN_SCENARIOS = Object.freeze({
  default: "full",
  definitions: Object.freeze({
    full: Object.freeze({
      name: "全能",
      description: "通用情景：不限制工具和上下文，按任务需要自主选择能力。",
      tools: Object.freeze(["*"]),
      context: Object.freeze(["*"]),
      services: Object.freeze(["*"]),
      mcpServers: Object.freeze(["*"]),
    }),
    programming: Object.freeze({
      name: "编程",
      description:
        "编程情景：先 search/read_file 确认真实内容，再用 patch_file 修改；优先精确上下文补丁，避免手算 unified diff 行数；补丁失败后重新读取再改，必要时用 write_file。",
      model: "",
      tools: PROGRAMMING_TOOL_NAMES,
      context: Object.freeze([
        "scenario",
        "system_runtime",
        "base_prompt",
        "long_memory",
        "services",
        "mcp_servers",
      ]),
      services: Object.freeze([]),
      mcpServers: Object.freeze([]),
    }),
    text: Object.freeze({
      name: "文本",
      description: "文本情景：适合写作、改写、摘要、翻译与内容整理。",
      model: "",
      tools: PROGRAMMING_TOOL_NAMES,
      context: Object.freeze([
        "scenario",
        "system_runtime",
        "base_prompt",
        "long_memory",
        "services",
        "mcp_servers",
      ]),
      services: Object.freeze([]),
      mcpServers: Object.freeze([]),
    }),
  }),
});

export const BUILTIN_SCENARIO_I18N_KEYS = Object.freeze({
  full: Object.freeze({
    name: "scenarios.full.name",
    description: "scenarios.full.description",
  }),
  programming: Object.freeze({
    name: "scenarios.programming.name",
    description: "scenarios.programming.description",
  }),
  text: Object.freeze({
    name: "scenarios.text.name",
    description: "scenarios.text.description",
  }),
});

export function localizeBuiltinScenarios(scenarios, { locale = "", translate } = {}) {
  if (typeof translate !== "function") {
    throw new TypeError("localizeBuiltinScenarios requires an explicit translate function");
  }
  const source = isPlainObject(scenarios) ? scenarios : BUILTIN_SCENARIOS;
  const definitions = cloneJson(source.definitions || {});
  for (const scenarioKey of BUILTIN_SCENARIO_KEYS) {
    const definition = definitions[scenarioKey];
    const keys = BUILTIN_SCENARIO_I18N_KEYS[scenarioKey];
    if (!definition || !keys) continue;
    definition.name = translate(keys.name, locale, definition.name);
    definition.description = translate(keys.description, locale, definition.description);
  }
  return { default: source.default, definitions };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeScenarioKey(value = "") {
  const key = String(value || "").trim();
  return BUILTIN_SCENARIO_KEYS.includes(key) ? key : "";
}

function readScenarioModel(sourceScenarios = {}, scenarioKey = "") {
  const source = isPlainObject(sourceScenarios) ? sourceScenarios : {};
  const definitions = isPlainObject(source?.definitions) ? source.definitions : {};
  const scenario = isPlainObject(definitions?.[scenarioKey]) ? definitions[scenarioKey] : {};
  if (!Object.prototype.hasOwnProperty.call(scenario, "model")) {
    return undefined;
  }
  return typeof scenario.model === "string" ? scenario.model : undefined;
}

export function sanitizeScenarioConfig(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const out = {};
  const defaultScenario = normalizeScenarioKey(source?.default);
  if (defaultScenario) {
    out.default = defaultScenario;
  }
  const definitions = {};
  for (const scenarioKey of [PROGRAMMING_SCENARIO_KEY, TEXT_SCENARIO_KEY]) {
    const model = readScenarioModel(source, scenarioKey);
    if (model !== undefined) {
      definitions[scenarioKey] = { model };
    }
  }
  if (Object.keys(definitions).length > 0) {
    out.definitions = definitions;
  }
  return out;
}

export function resolveBuiltinScenarios(globalScenarios = {}, userScenarios = {}) {
  const builtinScenarios = BUILTIN_SCENARIOS;
  const globalSafe = sanitizeScenarioConfig(globalScenarios);
  const userSafe = sanitizeScenarioConfig(userScenarios);
  const definitions = cloneJson(builtinScenarios.definitions);
  for (const scenarioKey of [PROGRAMMING_SCENARIO_KEY, TEXT_SCENARIO_KEY]) {
    const globalModel = readScenarioModel(globalSafe, scenarioKey);
    const userModel = readScenarioModel(userSafe, scenarioKey);
    const model = userModel || globalModel;
    if (model !== undefined && model !== "") {
      definitions[scenarioKey] = {
        ...definitions[scenarioKey],
        model,
      };
    }
  }
  return {
    default: userSafe.default || globalSafe.default || builtinScenarios.default,
    definitions,
  };
}
