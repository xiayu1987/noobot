/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveModelFinalMessages,
} from "@noobot/context-protocol/window-reducer";
import { normalizeMessageForModelRuntime } from "./session-execution-engine-utils.js";
import { emitModelContextTrace } from "../../observability/model-context-trace-emitter.js";
import { summarizeDiagnosticBlocks, summarizeDiagnosticMessages } from "@noobot/context-protocol/context-diagnostics";
import { MODEL_CONTEXT_PROTOCOL_VERSION } from "@noobot/context-protocol/agent-context-schema";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";

const PLUGIN_DEEP_MERGE_KEYS = new Set([
  "stepModels",
  "capabilityModelByPurpose",
  "capabilityToolAllowlistByPurpose",
  "acceptance",
  "review",
]);

function requireAuthoritativeMessageBlocks(ctx = {}) {
  const modelContext = ctx?.modelContext;
  if (Number(modelContext?.protocolVersion) !== MODEL_CONTEXT_PROTOCOL_VERSION) {
    throw new Error(`resolveModelMessages requires modelContext protocolVersion=${MODEL_CONTEXT_PROTOCOL_VERSION}`);
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

  createResolveModelMessages({ pluginOptions = {} } = {}) {
    void pluginOptions;
    return ({ ctx = {}, purpose = "" } = {}) => {
      const blocks = requireAuthoritativeMessageBlocks(ctx);
      const resolved = resolveModelFinalMessages({
        systemMessages: normalizeMessagesForModelRuntime(resolveBlockMessages(blocks, "system")),
        historyMessages: normalizeMessagesForModelRuntime(resolveBlockMessages(blocks, "history")),
        incrementalMessages: normalizeMessagesForModelRuntime(resolveBlockMessages(blocks, "incremental")),
        historyLimit: TURN_THRESHOLDS.session.mainModelHistoryRoundLimit,
      });
      emitModelContextTrace(ctx?.agentContext?.bindings?.runtime || null, "resolve_model_messages", {
        purpose: String(purpose || "").trim(),
        blockSource: "ctx.modelContext.messageBlocks",
        blocks: summarizeDiagnosticBlocks(blocks),
        resolvedMessages: summarizeDiagnosticMessages(resolved.messages),
      });
      return resolved.messages;
    };
  }

}
