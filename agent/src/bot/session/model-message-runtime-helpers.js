/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildDualLaneModelContext,
  MODEL_CONTEXT_LANE,
} from "@noobot/context-protocol/assembly/dual-lane";
import { emitModelContextTrace } from "../../observability/model-context-trace-emitter.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import {
  summarizeDiagnosticBlocks,
  summarizeDiagnosticMessages,
} from "@noobot/context-protocol/assembly/diagnostics";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { text } from "@noobot/shared/value";

export class ModelMessageRuntimeHelpers {
  constructor({ session = null } = {}) {
    this.session = session;
  }

  createResolveModelMessages() {
    return ({ ctx = {}, purpose = "" } = {}) => {
      const resolved = buildDualLaneModelContext({
        lane: MODEL_CONTEXT_LANE.PRIMARY,
        modelContext: ctx?.modelContext,
        primaryHistoryLimit: TURN_THRESHOLDS.session.mainModelHistoryRoundLimit,
      });
      emitModelContextTrace(
        getRuntimeFromAgentContext(ctx.agentContext).eventListener,
        "resolve_model_messages",
        {
          purpose: text(purpose),
          blockSource: "ctx.modelContext.messageBlocks",
          blocks: summarizeDiagnosticBlocks(ctx.modelContext.messageBlocks),
          resolvedMessages: summarizeDiagnosticMessages(resolved.messages),
        },
      );
      return resolved.messages;
    };
  }
}
