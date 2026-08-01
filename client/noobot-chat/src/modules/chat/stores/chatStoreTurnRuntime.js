/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  applyExecutionChildren, applyExecutionSnapshot, applyExecutionTree,
  applyTurnLifecycleEnvelope, applyTurnLifecycleSnapshot, applyTurnTimingSnapshot, applyTurnTimingUpdate,
  applyTurnTerminalResolution, applyTurnRuntimeEvent, createTurnRuntimeRegistryState,
  pruneTerminalTurns,
} from "../runtime/run-state-machine/turnRuntimeRegistry.js";

export function createTurnRuntimeStoreActions(
  turnRuntimeRegistry,
  { onTurnCommitted = null, onTurnEvaluated = null } = {},
) {
  function commitTurnRuntime(reducer, ...args) {
    const registry = turnRuntimeRegistry.value || createTurnRuntimeRegistryState();
    const result = reducer(registry, ...args);
    const applied = result?.applied !== false;
    if (applied) turnRuntimeRegistry.value = { ...registry };
    if (typeof onTurnEvaluated === "function") {
      onTurnEvaluated({ reducer: reducer.name, input: args[0], result, applied });
    }
    if (applied && result?.turn && typeof onTurnCommitted === "function") {
      const projection = onTurnCommitted(result);
      return projection ? { ...result, subSessionEffect: projection } : result;
    }
    return result;
  }
  return {
    applyTurnRuntimeEvent: (event) => commitTurnRuntime(applyTurnRuntimeEvent, event),
    applyTurnLifecycleEnvelope: (value) => commitTurnRuntime(applyTurnLifecycleEnvelope, value),
    applyTurnLifecycleSnapshot: (value) => commitTurnRuntime(applyTurnLifecycleSnapshot, value),
    applyTurnTimingSnapshot: (value) => commitTurnRuntime(applyTurnTimingSnapshot, value),
    applyTurnTimingUpdate: (value) => commitTurnRuntime(applyTurnTimingUpdate, value),
    applyTurnTerminalResolution: (value) => commitTurnRuntime(applyTurnTerminalResolution, value),
    applyExecutionSnapshot: (value) => commitTurnRuntime(applyExecutionSnapshot, value),
    applyExecutionChildren: (value) => commitTurnRuntime(applyExecutionChildren, value),
    applyExecutionTree: (value) => commitTurnRuntime(applyExecutionTree, value),
    pruneTerminalTurns(options = {}) {
      const registry = turnRuntimeRegistry.value || createTurnRuntimeRegistryState();
      const result = pruneTerminalTurns(registry, options);
      const applied = Array.isArray(result?.removedTurnScopeIds) && result.removedTurnScopeIds.length > 0;
      if (applied) turnRuntimeRegistry.value = { ...registry };
      return { ...(result || {}), applied };
    },
  };
}
