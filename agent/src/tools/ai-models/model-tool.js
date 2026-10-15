/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { TOOL_NAME } from "../constants/index.js";
import { text } from "@noobot/shared/value";

function tModel(runtime = {}, key = "", params = {}) {
  const keyMap = {
    sessionContextMissing: "common.sessionContextMissing",
    modelNameRequired: "model.nameRequired",
    notConversationModel: "model.notConversationModel",
  };
  if (text(key) === "modelNotFound") {
    return `${tTool(runtime, "model.enabledProviderModelNotFound")}: ${text(params.input)}`;
  }
  return tTool(runtime, keyMap[text(key)] || "", params);
}

function isConversationModel(providerSpec = {}) {
  if (!providerSpec || typeof providerSpec !== "object") return false;
  const configuredValue = providerSpec.used_for_conversation;
  return configuredValue === undefined ? true : configuredValue === true;
}

export function createModelTool({ agentContext, sessionId }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const allEnabledProviders = runtime.allEnabledProviders || {};

  const switchModelTool = new DynamicStructuredTool({
    name: TOOL_NAME.SWITCH_MODEL,
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
      const input = text(modelName);
      if (!input) {
        throw recoverableToolError(tModel(runtime, "modelNameRequired"), {
          code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
        });
      }
      const alias = input;
      if (!allEnabledProviders[alias]) {
        throw recoverableToolError(tModel(runtime, "modelNotFound", { input }), {
          code: ERROR_CODE.RECOVERABLE_MODEL_NOT_FOUND,
        });
      }
      if (!isConversationModel(allEnabledProviders[alias])) {
        throw recoverableToolError(tModel(runtime, "notConversationModel", { alias }), {
          code: ERROR_CODE.RECOVERABLE_MODEL_NOT_CONVERSATION,
        });
      }
      const resolvedSessionId = text(runtime?.systemRuntime?.sessionId || sessionId);
      if (
        runtime?.sessionManager &&
        typeof runtime.sessionManager.setSessionModelAlias === "function" &&
        text(runtime?.userId) &&
        resolvedSessionId
      ) {
        await runtime.sessionManager.setSessionModelAlias({
          userId: text(runtime.userId),
          sessionId: resolvedSessionId,
          modelAlias: alias,
        });
      }
      runtime.runtimeModel = alias;
      return toToolJsonResult(TOOL_NAME.SWITCH_MODEL, {
        ok: true,
        sessionId,
        modelAlias: alias,
        message: tTool(runtime, "tools.model.switchApplied"),
      });
    },
  });

  return [switchModelTool];
}
