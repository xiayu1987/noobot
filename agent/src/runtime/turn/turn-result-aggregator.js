/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createAgentTurnResult } from "@noobot/agent-transport-protocol/agent-turn-result";
import { isFunction } from "@noobot/shared/value";

function requireStore(store, name, methods) {
  if (!store || !methods.every((method) => isFunction(store[method]))) {
    throw new Error(`turn result requires the canonical ${name} store`);
  }
  return store;
}

export function buildLoopResult({
  output,
  modelMessageId,
  traces,
  loopState,
  turnMessageStore,
  modelMessages,
}) {
  const messages = requireStore(turnMessageStore, "currentTurnMessages", [
    "toArray",
    "updateWhere",
  ]);
  return createAgentTurnResult({
    output,
    modelMessageId,
    traces,
    turnMessages: messages.toArray(),
    modelMessages,
    modelLoopRound: loopState.systemRuntime.modelLoopRound,
  });
}
