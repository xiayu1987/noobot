/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeToolCalls } from "../../models/index.js";

export function createCapabilityToolBinding(adapted = {}) {
  const tools = Array.isArray(adapted.tools) ? adapted.tools : [];
  return {
    tools,
    options:
      adapted.bindOptions && typeof adapted.bindOptions === "object" ? adapted.bindOptions : {},
    toolMap: new Map(
      tools
        .map((tool) => [String(tool?.name || "").trim(), tool])
        .filter(([name]) => Boolean(name)),
    ),
  };
}

async function executeCapabilityTool({
  call,
  binding,
  allowPolicy,
  executeToolCall,
  execution,
  turn,
}) {
  if (!allowPolicy.allowAll && allowPolicy.allowSet.size && !allowPolicy.allowSet.has(call.name)) {
    return JSON.stringify({ ok: false, error: `tool not allowed: ${call.name}` });
  }
  const tool = binding.toolMap.get(call.name);
  if (!tool) return JSON.stringify({ ok: false, error: `tool not found: ${call.name}` });
  const result = await executeToolCall({ ...execution, call, tool, turn });
  return String(result?.toolResultText || "");
}

export async function runCapabilityToolTurns({
  invokeStep,
  messages,
  binding,
  allowPolicy,
  maxTurns,
  executeToolCall,
  execution,
  locale,
}) {
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const step = await invokeStep(messages, binding);
    const { output } = step.response;
    const { calls } = normalizeToolCalls(output);
    if (!calls.length) return step.complete();
    const turnMessages = [
      { role: "assistant", content: output.text, tool_calls: output.toolCalls },
    ];
    for (const call of calls) {
      turnMessages.push({
        role: "tool",
        tool_call_id: call.id || "",
        content: await executeCapabilityTool({
          call,
          binding,
          allowPolicy,
          executeToolCall,
          execution,
          turn,
        }),
      });
    }
    messages = [...messages, ...turnMessages];
  }
  const content =
    locale === "en-US"
      ? "Based on the above tool results, provide the final planning answer now."
      : "请基于以上工具结果，立即给出最终规划答案。";
  const finalStep = await invokeStep([{ role: "system", content }, ...messages]);
  return finalStep.complete();
}
