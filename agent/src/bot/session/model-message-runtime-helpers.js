/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveMainModelFinalMessages,
} from "../../session/utils/context-window-normalizer.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { normalizeMessageForModelRuntime } from "./session-execution-engine-utils.js";
import { emitModelContextTrace, summarizeDiagnosticBlocks, summarizeDiagnosticMessages } from "../../context/runtime-state/context-diagnostics.js";

const PLUGIN_DEEP_MERGE_KEYS = new Set([
  "stepModels",
  "capabilityModelByPurpose",
  "capabilityToolAllowlistByPurpose",
  "acceptance",
  "review",
]);

function requireAuthoritativeMessageBlocks(ctx = {}) {
  const modelContext = ctx?.modelContext;
  if (Number(modelContext?.protocolVersion) !== 1) {
    throw new Error("resolveModelMessages requires context protocol modelContext v1");
  }
  const blocks = modelContext?.messageBlocks;
  if (!blocks || typeof blocks !== "object" || Array.isArray(blocks)) {
    throw new Error("resolveModelMessages requires authoritative modelContext.messageBlocks");
  }
  return blocks;
}

function resolveBlockMessages(blocks = null, blockName = "") {
  if (Array.isArray(blocks?.[blockName])) return blocks[blockName];
  return [];
}

function normalizeMessagesForModelRuntime(messages = []) {
  return messages
    .map((item) => normalizeMessageForModelRuntime(item))
    .filter(Boolean);
}

export class ModelMessageRuntimeHelpers {
  constructor({ session = null } = {}) {
    this.session = session;
  }

  mergePluginOptions(...items) {
    return items.reduce((acc, item) => {
      if (!item || typeof item !== "object") return acc;
      const next = { ...acc };
      for (const [key, value] of Object.entries(item)) {
        if (
          PLUGIN_DEEP_MERGE_KEYS.has(key) &&
          value &&
          typeof value === "object" &&
          !Array.isArray(value)
        ) {
          next[key] = {
            ...(next[key] && typeof next[key] === "object" && !Array.isArray(next[key])
              ? next[key]
              : {}),
            ...value,
          };
          continue;
        }
        next[key] = value;
      }
      return next;
    }, {});
  }

  createResolveModelMessages({
    agentPluginOptions = {},
    botPluginOptions = {},
  } = {}) {
    void agentPluginOptions;
    void botPluginOptions;
    return ({ ctx = {}, purpose = "" } = {}) => {
      const blocks = requireAuthoritativeMessageBlocks(ctx);
      const resolved = resolveMainModelFinalMessages({
        systemMessages: normalizeMessagesForModelRuntime(resolveBlockMessages(blocks, "system")),
        historyMessages: normalizeMessagesForModelRuntime(resolveBlockMessages(blocks, "history")),
        incrementalMessages: normalizeMessagesForModelRuntime(resolveBlockMessages(blocks, "incremental")),
      });
      emitModelContextTrace(getRuntimeFromAgentContext(ctx?.agentContext || ctx?.runtimeAgentContext || {}), "resolve_model_messages", {
        purpose: String(purpose || "").trim(),
        blockSource: "ctx.modelContext.messageBlocks",
        blocks: summarizeDiagnosticBlocks(blocks),
        resolvedMessages: summarizeDiagnosticMessages(resolved.messages),
      });
      return resolved.messages;
    };
  }

}
