/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildDualLaneModelContext,
  MODEL_CONTEXT_LANE,
} from "@noobot/context-protocol/dual-lane-context";
import { normalizeMessageForModelRuntime } from "./session-execution-engine-utils.js";
import { emitModelContextTrace } from "../../observability/model-context-trace-emitter.js";
import { summarizeDiagnosticBlocks, summarizeDiagnosticMessages } from "@noobot/context-protocol/context-diagnostics";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";

const PLUGIN_DEEP_MERGE_KEYS = new Set([
  "stepModels",
  "capabilityModelByPurpose",
  "capabilityToolAllowlistByPurpose",
  "acceptance",
  "review",
]);

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
      const resolved = buildDualLaneModelContext({
        lane: MODEL_CONTEXT_LANE.PRIMARY,
        modelContext: ctx?.modelContext,
        projectPrimaryMessage: normalizeMessageForModelRuntime,
        primaryHistoryLimit: TURN_THRESHOLDS.session.mainModelHistoryRoundLimit,
      });
      emitModelContextTrace(ctx?.agentContext?.bindings?.runtime || null, "resolve_model_messages", {
        purpose: String(purpose || "").trim(),
        blockSource: "ctx.modelContext.messageBlocks",
        blocks: summarizeDiagnosticBlocks(ctx.modelContext.messageBlocks),
        resolvedMessages: summarizeDiagnosticMessages(resolved.messages),
      });
      return resolved.messages;
    };
  }

}
