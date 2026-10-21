/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text, isFunction } from "@noobot/shared/value";

function requireCanonicalTurnMessageStore(turnMessageStore = null) {
  if (
    !turnMessageStore ||
    !isFunction(turnMessageStore.toArray) ||
    !isFunction(turnMessageStore.updateWhere)
  ) {
    throw new Error("turn result requires the canonical currentTurnMessages store");
  }
  return turnMessageStore;
}

export function finalizeTurnMessagesBeforeReturn({ turnMessageStore = null } = {}) {
  const canonicalStore = requireCanonicalTurnMessageStore(turnMessageStore);
  return canonicalStore.toArray();
}

export function buildLoopResult({
  output,
  modelMessageId = "",
  traces,
  loopState,
  turnTaskStore = null,
  turnMessageStore = null,
  modelMessages = [],
} = {}) {
  const finalTurnMessages = finalizeTurnMessagesBeforeReturn({
    modelMessages,
    turnMessageStore,
  });
  const modelLoopRound = Number(loopState?.systemRuntime?.modelLoopRound || 0);
  return {
    output,
    modelMessageId: text(modelMessageId),
    traces,
    turnMessages: finalTurnMessages,
    modelMessages: Array.isArray(modelMessages) ? modelMessages : [],
    modelLoopRound: Number.isFinite(modelLoopRound) && modelLoopRound > 0 ? modelLoopRound : 0,
    turnTasks: turnTaskStore
      ? turnTaskStore.toArray()
      : Array.isArray(loopState?.turnTasks)
        ? loopState.turnTasks
        : [],
  };
}
