/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tool } from "@langchain/core/tools";
import {
  assertToolExecution,
  createToolNameBinding,
  TOOL_DEFINITION_TEMPLATE,
  TOOL_MANUAL_PROVIDER,
} from "@noobot/model-protocol";
import { tToolManual } from "./tool-schema-i18n.js";
import {
  getToolNameBinding,
  runWithToolNameBinding,
} from "@noobot/model-protocol/tool-binding-scope-node";
import { mergeConfig, resolveToolBindings } from "@noobot/agent-config-protocol";

const DIRECT_TOOL_CONTEXT = Symbol("directToolContext");

export function resolveDirectToolNameBinding(runtime, tool, agentContext) {
  const context = agentContext ?? tool?.[DIRECT_TOOL_CONTEXT];
  if (!context) throw new TypeError("direct tool execution requires its tool context");
  return createDirectToolNameBinding(
    runtime,
    resolveToolBindings({
      sourceTools: context.bindings.tools,
      runConfig: runtime.runConfig,
    }),
  );
}

export function createDirectToolNameBinding(runtime, tools) {
  const config = mergeConfig(runtime.globalConfig, runtime.userConfig);
  return createToolNameBinding({
    tools,
    bindings: config.tools?.bindings,
  });
}

export function boundTool(run, fields, resolveBinding) {
  const result = tool((input, config) => {
    const binding = resolveBinding();
    assertToolExecution(binding, fields.name, result);
    return runWithToolNameBinding(binding, () => run(input, config));
  }, fields);
  return result;
}

export function structuredTool(runtime, run, fields, agentContext) {
  const result = boundTool(
    run,
    fields,
    () => getToolNameBinding() ?? resolveDirectToolNameBinding(runtime, result),
  );
  result[DIRECT_TOOL_CONTEXT] = agentContext;
  result[TOOL_DEFINITION_TEMPLATE] = true;
  result[TOOL_MANUAL_PROVIDER] = () => tToolManual(runtime, fields.name);
  return result;
}
