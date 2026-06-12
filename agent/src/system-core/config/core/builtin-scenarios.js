/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject } from "../../utils/shared-utils.js";
import { tSystem } from "noobot-i18n/agent/system-text";

export const BUILTIN_SCENARIO_KEYS = Object.freeze(["full", "programming"]);
export const PROGRAMMING_SCENARIO_KEY = "programming";

// 编程场景工具分两层维护，但对运行时输出为一个最终白名单：
// - required：代码任务安全推进的硬依赖，不能被 deny 策略移除。
// - auxiliary：编程任务常用辅助能力，仍受全局工具启用状态/服务配置约束。
// 用户配置不允许改这两组工具，只允许改 programming.model。
export const PROGRAMMING_REQUIRED_TOOL_NAMES = Object.freeze([
  "read_file",
  "write_file",
  "search",
  "patch_file",
  "execute_script",
]);
export const PROGRAMMING_AUXILIARY_TOOL_NAMES = Object.freeze([
  "task_summary",
  "request_help",
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
      description: "编程情景：处理代码时优先使用 search 定位、read_file 读取、patch_file 修改，必要时再用 write_file 写入/创建文件；保留代码修改所需的文件、符号、测试与失败尝试上下文。",
      model: "",
      tools: PROGRAMMING_TOOL_NAMES,
      context: Object.freeze([
        "scenario",
        "system_runtime",
        "base_prompt",
        "services",
        "mcp_servers",
      ]),
      services: Object.freeze(["web_search_service"]),
      mcpServers: Object.freeze([]),
    }),
  }),
});

const BUILTIN_SCENARIO_I18N_KEYS = Object.freeze({
  full: Object.freeze({
    name: "scenarios.full.name",
    description: "scenarios.full.description",
  }),
  programming: Object.freeze({
    name: "scenarios.programming.name",
    description: "scenarios.programming.description",
  }),
});

function localizeScenarioText(locale, key, fallback) {
  return tSystem(key, locale, fallback);
}

export function getBuiltinScenarios(locale) {
  return Object.freeze({
    default: BUILTIN_SCENARIOS.default,
    definitions: Object.freeze({
      full: Object.freeze({
        ...BUILTIN_SCENARIOS.definitions.full,
        name: localizeScenarioText(
          locale,
          BUILTIN_SCENARIO_I18N_KEYS.full.name,
          BUILTIN_SCENARIOS.definitions.full.name,
        ),
        description: localizeScenarioText(
          locale,
          BUILTIN_SCENARIO_I18N_KEYS.full.description,
          BUILTIN_SCENARIOS.definitions.full.description,
        ),
      }),
      programming: Object.freeze({
        ...BUILTIN_SCENARIOS.definitions.programming,
        name: localizeScenarioText(
          locale,
          BUILTIN_SCENARIO_I18N_KEYS.programming.name,
          BUILTIN_SCENARIOS.definitions.programming.name,
        ),
        description: localizeScenarioText(
          locale,
          BUILTIN_SCENARIO_I18N_KEYS.programming.description,
          BUILTIN_SCENARIOS.definitions.programming.description,
        ),
      }),
    }),
  });
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeScenarioKey(value = "") {
  const key = String(value || "").trim();
  return BUILTIN_SCENARIO_KEYS.includes(key) ? key : "";
}

function readProgrammingModel(sourceScenarios = {}) {
  const source = isPlainObject(sourceScenarios) ? sourceScenarios : {};
  const definitions = isPlainObject(source?.definitions) ? source.definitions : {};
  const programming = isPlainObject(definitions?.[PROGRAMMING_SCENARIO_KEY])
    ? definitions[PROGRAMMING_SCENARIO_KEY]
    : {};
  return String(programming?.model || "").trim();
}

export function sanitizeScenarioConfig(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const out = {};
  const defaultScenario = normalizeScenarioKey(source?.default);
  if (defaultScenario) {
    out.default = defaultScenario;
  }
  const programmingModel = readProgrammingModel(source);
  if (programmingModel) {
    out.definitions = {
      [PROGRAMMING_SCENARIO_KEY]: {
        model: programmingModel,
      },
    };
  }
  return out;
}

export function resolveBuiltinScenarios(globalScenarios = {}, userScenarios = {}, options = {}) {
  const builtinScenarios = getBuiltinScenarios(options?.locale);
  const globalSafe = sanitizeScenarioConfig(globalScenarios);
  const userSafe = sanitizeScenarioConfig(userScenarios);
  const definitions = cloneJson(builtinScenarios.definitions);
  const globalProgrammingModel = readProgrammingModel(globalSafe);
  const userProgrammingModel = readProgrammingModel(userSafe);
  const programmingModel = userProgrammingModel || globalProgrammingModel;
  if (programmingModel) {
    definitions[PROGRAMMING_SCENARIO_KEY] = {
      ...definitions[PROGRAMMING_SCENARIO_KEY],
      model: programmingModel,
    };
  }
  return {
    default: userSafe.default || globalSafe.default || builtinScenarios.default,
    definitions,
  };
}
