/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  applyExecutionChildren, applyExecutionSnapshot, applyExecutionTree,
  applyTurnLifecycleEnvelope, applyTurnLifecycleSnapshot, applyTurnTimingSnapshot,
  applyTurnTerminalResolution, applyTurnRuntimeEvent, createTurnRuntimeRegistryState,
  hydrateSessionTurnRuntime, pruneTerminalTurns,
} from "../../composables/chat/sessionRunStateMachine/turnRuntimeRegistry.js";

export function createTurnRuntimeStoreActions(turnRuntimeRegistry) {
  function commitTurnRuntime(reducer, ...args) {
    const registry = turnRuntimeRegistry.value || createTurnRuntimeRegistryState();
    const result = reducer(registry, ...args);
    const applied = result?.applied !== false;
    if (applied) turnRuntimeRegistry.value = { ...registry };
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
    hydrateSessionTurnRuntime(session, statuses) {
      const registry = turnRuntimeRegistry.value || createTurnRuntimeRegistryState();
      const result = hydrateSessionTurnRuntime(registry, session, statuses);
      if (result?.applied) turnRuntimeRegistry.value = { ...registry };
      return result;
    },
    pruneTerminalTurns(options = {}) {
      const registry = turnRuntimeRegistry.value || createTurnRuntimeRegistryState();
      const result = pruneTerminalTurns(registry, options);
      const applied = Array.isArray(result?.removedTurnScopeIds) && result.removedTurnScopeIds.length > 0;
      if (applied) turnRuntimeRegistry.value = { ...registry };
      return { ...(result || {}), applied };
    },
  };
}
