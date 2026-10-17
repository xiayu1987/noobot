/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject } from "../utils.js";
import { text, isFunction } from "@noobot/shared/value";

export const BUILTIN_SCENARIO_KEYS = Object.freeze(["full", "programming", "text"]);
export const PROGRAMMING_SCENARIO_KEY = "programming";
const TEXT_SCENARIO_KEY = "text";

export const PROGRAMMING_REQUIRED_TOOL_NAMES = Object.freeze([
  "read_file",
  "write_file",
  "search",
  "patch_file",
  "execute_script",
  "execute_native_script",
  "multimodal_generate",
  "multimodal_parse",
]);
export const PROGRAMMING_AUXILIARY_TOOL_NAMES = Object.freeze([
  "access_connector",
  "user_interaction",
  "task_summary",
  "task_check",
  "help",
  "do_search_web",
]);
export const PROGRAMMING_TOOL_NAMES = Object.freeze([
  ...PROGRAMMING_REQUIRED_TOOL_NAMES,
  ...PROGRAMMING_AUXILIARY_TOOL_NAMES,
]);

export const BUILTIN_SCENARIOS = Object.freeze({
  default: "full",
  definitions: Object.freeze({
    full: Object.freeze({
      tools: Object.freeze(["*"]),
      context: Object.freeze(["*"]),
      services: Object.freeze(["*"]),
      mcpServers: Object.freeze(["*"]),
    }),
    programming: Object.freeze({
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

function assertTranslate(translate, caller) {
  if (!isFunction(translate)) {
    throw new TypeError(`${caller} requires an explicit translate function`);
  }
}

function localizeScenarioEntry(scenarioKey, entry, { locale, translate }) {
  if (!BUILTIN_SCENARIO_KEYS.includes(scenarioKey)) return entry;
  const nameKey = `scenarios.${scenarioKey}.name`;
  const descriptionKey = `scenarios.${scenarioKey}.description`;
  return {
    ...entry,
    name: translate(nameKey, locale, nameKey),
    description: translate(descriptionKey, locale, descriptionKey),
  };
}

export function localizeBuiltinScenarios(scenarios, { locale = "", translate } = {}) {
  assertTranslate(translate, "localizeBuiltinScenarios");
  const source = isPlainObject(scenarios) ? scenarios : BUILTIN_SCENARIOS;
  const definitions = cloneJson(source.definitions || {});
  for (const scenarioKey of BUILTIN_SCENARIO_KEYS) {
    if (!definitions[scenarioKey]) continue;
    definitions[scenarioKey] = localizeScenarioEntry(scenarioKey, definitions[scenarioKey], {
      locale,
      translate,
    });
  }
  return { default: source.default, definitions };
}

export function localizeScenarioProfile(scenarioProfile, { locale = "", translate } = {}) {
  assertTranslate(translate, "localizeScenarioProfile");
  if (!isPlainObject(scenarioProfile)) return {};
  return localizeScenarioEntry(String(scenarioProfile.key || ""), scenarioProfile, {
    locale,
    translate,
  });
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeScenarioKey(value = "") {
  const key = text(value);
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
