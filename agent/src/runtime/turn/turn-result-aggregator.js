/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function requireCanonicalTurnMessageStore(turnMessageStore = null) {
  if (
    !turnMessageStore ||
    typeof turnMessageStore.toArray !== "function" ||
    typeof turnMessageStore.updateWhere !== "function"
  ) {
    throw new Error("turn result requires the canonical currentTurnMessages store");
  }
  return turnMessageStore;
}

export function finalizeTurnMessagesBeforeReturn({
  turnMessageStore = null,
} = {}) {
  const canonicalStore = requireCanonicalTurnMessageStore(turnMessageStore);
  return canonicalStore.toArray();
}

export function buildLoopResult({
  output,
  assistantMessageId = "",
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
      assistantMessageId: String(assistantMessageId || "").trim(),
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
