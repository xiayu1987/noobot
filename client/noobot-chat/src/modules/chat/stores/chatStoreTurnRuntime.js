/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  applyExecutionChildren,
  applyExecutionSnapshot,
  applyExecutionTree,
  applyTurnLifecycleEnvelope,
  applyTurnLifecycleSnapshot,
  applyTurnTimingSnapshot,
  applyTurnTerminalResolution,
  applyTurnRuntimeEvent,
  pruneTerminalTurns,
} from "../runtime/run-state-machine/turnRuntimeRegistry.js";

export function createTurnRuntimeStoreActions(
  turnRuntimeRegistry,
  { onTurnCommitted, onTurnEvaluated },
) {
  function commitTurnRuntime(reducer, ...args) {
    const registry = turnRuntimeRegistry.value;
    const result = reducer(registry, ...args);
    const applied = result.applied !== false;
    if (applied) turnRuntimeRegistry.value = { ...registry };
    onTurnEvaluated({ reducer: reducer.name, input: args[0], result, applied });
    if (applied && result.turn) return { ...result, subSessionEffect: onTurnCommitted(result) };
    return result;
  }
  return {
    applyTurnRuntimeEvent: (event) => commitTurnRuntime(applyTurnRuntimeEvent, event),
    applyTurnLifecycleEnvelope: (value) => commitTurnRuntime(applyTurnLifecycleEnvelope, value),
    applyTurnLifecycleSnapshot: (value) => commitTurnRuntime(applyTurnLifecycleSnapshot, value),
    applyTurnTimingSnapshot: (value) => commitTurnRuntime(applyTurnTimingSnapshot, value),
    applyTurnTerminalResolution: (value) => commitTurnRuntime(applyTurnTerminalResolution, value),
    applyExecutionSnapshot: (value) => commitTurnRuntime(applyExecutionSnapshot, value),
    applyExecutionChildren: (value) => commitTurnRuntime(applyExecutionChildren, value),
    applyExecutionTree: (value) => commitTurnRuntime(applyExecutionTree, value),
    pruneTerminalTurns(options) {
      const registry = turnRuntimeRegistry.value;
      const result = pruneTerminalTurns(registry, options);
      const applied = result.removedTurnScopeIds.length > 0;
      if (applied) turnRuntimeRegistry.value = { ...registry };
      return { ...result, applied };
    },
  };
}
