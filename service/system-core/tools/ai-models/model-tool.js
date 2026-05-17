/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { recoverableToolError } from "../../error/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { ERROR_CODE } from "../../error/constants.js";
import { ToolName } from "../constants/index.js";

function getRuntime(agentContext) {
  return agentContext?.runtime || {};
}

function tModel(runtime = {}, key = "", params = {}) {
  const keyMap = {
    sessionContextMissing: "common.sessionContextMissing",
    modelNameRequired: "model.nameRequired",
    notConversationModel: "model.notConversationModel",
  };
  if (String(key || "").trim() === "modelNotFound") {
    return `${tTool(runtime, "model.enabledProviderModelNotFound")}: ${String(params.input || "").trim()}`;
  }
  return tTool(runtime, keyMap[String(key || "").trim()] || "", params);
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
    name: ToolName.SWITCH_MODEL,
    description: tTool(runtime, "tools.model.description"),
    schema: z.object({
      modelName: z.string().describe(tTool(runtime, "tools.model.fieldModelName")),
    }),
    func: async ({ modelName }) => {
      if (!runtime || !sessionId) {
        throw recoverableToolError(tModel(runtime, "sessionContextMissing"), {
          code: ERROR_CODE.RECOVERABLE_SESSION_CONTEXT_MISSING,
        });
      }
      const input = String(modelName || "").trim();
      if (!input) {
        throw recoverableToolError(tModel(runtime, "modelNameRequired"), {
          code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
        });
      }
      let alias = input;
      if (!allEnabledProviders[alias]) {
        const byModelName = Object.entries(allEnabledProviders).find(
          ([, v]) => String(v?.model || "") === input,
        );
        if (byModelName) alias = byModelName[0];
      }
      if (!allEnabledProviders[alias]) {
        throw recoverableToolError(
          tModel(runtime, "modelNotFound", { input }),
          {
            code: ERROR_CODE.RECOVERABLE_MODEL_NOT_FOUND,
          },
        );
      }
      if (!isConversationModel(allEnabledProviders[alias])) {
        throw recoverableToolError(
          tModel(runtime, "notConversationModel", { alias }),
          {
            code: ERROR_CODE.RECOVERABLE_MODEL_NOT_CONVERSATION,
          },
        );
      }
      runtime.runtimeModel = alias;
      try {
        const resolvedSessionId = String(
          runtime?.systemRuntime?.sessionId || sessionId || "",
        ).trim();
        if (
          runtime?.sessionManager &&
          typeof runtime.sessionManager.setSessionModelAlias === "function" &&
          String(runtime?.userId || "").trim() &&
          resolvedSessionId
        ) {
          await runtime.sessionManager.setSessionModelAlias({
            userId: String(runtime.userId || "").trim(),
            sessionId: resolvedSessionId,
            modelAlias: alias,
          });
        }
      } catch {
        // ignore persistence failures; runtime switch still applies to current turn
      }
      return toToolJsonResult(ToolName.SWITCH_MODEL, {
        ok: true,
        sessionId,
        modelAlias: alias,
        message: tTool(runtime, "tools.model.switchApplied"),
      });
    },
  });

  return [switchModelTool];
}
