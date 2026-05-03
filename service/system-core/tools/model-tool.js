/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { toToolJsonResult } from "./tool-json-result.js";
import { pickToolText, resolveToolLocale, tTool } from "./tool-i18n.js";

function getRuntime(agentContext) {
  return agentContext?.runtime || {};
}

function tModel(runtime = {}, key = "", params = {}) {
  const locale = resolveToolLocale(runtime);
  const dict = {
    sessionContextMissing: {
      "zh-CN": "会话上下文缺失",
      "en-US": "session context missing",
    },
    modelNameRequired: {
      "zh-CN": "modelName 必填",
      "en-US": "modelName required",
    },
    modelNotFound: {
      "zh-CN": `未找到可用模型或 provider: ${String(params.input || "").trim()}`,
      "en-US": `enabled provider/model not found: ${String(params.input || "").trim()}`,
    },
    notConversationModel: {
      "zh-CN": `该模型不支持会话切换: ${String(params.alias || "").trim()}`,
      "en-US": `model is not available for conversation switch: ${String(params.alias || "").trim()}`,
    },
  };
  return pickToolText({ locale, dict, key, params });
}

function isConversationModel(providerSpec = {}) {
  if (!providerSpec || typeof providerSpec !== "object") return false;
  const configuredValue = providerSpec.used_for_conversation;
  return configuredValue === undefined ? true : configuredValue === true;
}

export function createModelTool({
  agentContext,
  sessionId,
}) {
  const runtime = getRuntime(agentContext);
  const allEnabledProviders = runtime.allEnabledProviders || {};

  const switchModelTool = new DynamicStructuredTool({
    name: "switch_model",
    description: tTool(runtime, "tools.model.description"),
    schema: z.object({
      modelName: z.string().describe(tTool(runtime, "tools.model.fieldModelName")),
    }),
    func: async ({ modelName }) => {
      if (!runtime || !sessionId)
        return toToolJsonResult("switch_model", {
          ok: false,
          error: tModel(runtime, "sessionContextMissing"),
        });
      const input = String(modelName || "").trim();
      if (!input)
        return toToolJsonResult("switch_model", {
          ok: false,
          error: tModel(runtime, "modelNameRequired"),
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
          error: tModel(runtime, "modelNotFound", { input }),
        });
      }
      if (!isConversationModel(allEnabledProviders[alias])) {
        return toToolJsonResult("switch_model", {
          ok: false,
          error: tModel(runtime, "notConversationModel", { alias }),
        });
      }
      runtime.runtimeModel = alias;
      return toToolJsonResult("switch_model", {
        ok: true,
        sessionId,
        modelAlias: alias,
        message: tTool(runtime, "tools.model.switchApplied"),
      });
    },
  });

  return [switchModelTool];
}
