/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { toToolJsonResult } from "./tool-json-result.js";

function getRuntime(agentContext) {
  return agentContext?.runtime || {};
}

export function createModelTool({
  agentContext,
  sessionId,
}) {
  const runtime = getRuntime(agentContext);
  const allEnabledProviders = runtime.allEnabledProviders || {};

  const switchModelTool = new DynamicStructuredTool({
    name: "switch_model",
    description: "切换当前会话使用模型（传 provider 别名）。",
    schema: z.object({
      modelName: z.string().describe("provider 别名"),
    }),
    func: async ({ modelName }) => {
      if (!runtime || !sessionId)
        return toToolJsonResult("switch_model", {
          ok: false,
          error: "session context missing",
        });
      const input = String(modelName || "").trim();
      if (!input)
        return toToolJsonResult("switch_model", {
          ok: false,
          error: "modelName required",
        });
      let alias = input;
      if (!allEnabledProviders[alias]) {
        const byModelName = Object.entries(allEnabledProviders).find(
          ([, v]) => String(v?.model || "") === input,
        );
        if (byModelName) alias = byModelName[0];
      }
      if (!allEnabledProviders[alias]) {
        return toToolJsonResult("switch_model", {
          ok: false,
          error: `enabled provider/model not found: ${input}`,
        });
      }
      runtime.runtimeModel = alias;
      return toToolJsonResult("switch_model", {
        ok: true,
        sessionId,
        modelAlias: alias,
        message: "模型已切换，将在本轮后续调用生效",
      });
    },
  });

  return [switchModelTool];
}
