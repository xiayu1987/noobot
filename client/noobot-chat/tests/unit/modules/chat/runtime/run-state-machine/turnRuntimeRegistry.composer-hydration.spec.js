/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { it, expect, vi } from "vitest";
import { nextTick, ref } from "vue";
import {
  applyTurnLifecycleSnapshot,
  createTurnRuntimeRegistryState,
  selectCurrentTurnRuntime,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { settleTerminal, snapshot } from "./turnRuntimeRegistryTestFixtures.js";
import { createTurnRuntimeStoreActions } from "../../../../../../src/modules/chat/stores/chatStoreTurnRuntime.js";
import { createComposerRuntimeState } from "../../../../../../src/modules/chat/runtime/session/composerRuntimeState.js";

it("reactively restores the stop action when a snapshot replaces an old stopped Turn", async () => {
  const registry = createTurnRuntimeRegistryState();
  applyTurnLifecycleSnapshot(registry, snapshot());
  settleTerminal(registry, {
    turnScopeId: "t1",
    dialogProcessId: "dp1",
    revision: 3,
    sequence: 3,
  });
  const turnRuntimeRegistry = ref(registry);
  const store = createTurnRuntimeStoreActions(turnRuntimeRegistry, {
    onTurnCommitted: vi.fn(() => null),
    onTurnEvaluated: vi.fn(),
  });
  const resolveActiveTurn = () => selectCurrentTurnRuntime(turnRuntimeRegistry.value, "s1");
  const { composerActionState } = createComposerRuntimeState({
    resolveActiveSessionIdentity: () => "s1",
    resolveActiveTurn,
  });
  expect(composerActionState.value.canStop).toBe(false);

  store.applyTurnLifecycleSnapshot(
    snapshot({
      commandId: "snapshot-current-processing",
      sequence: 4,
      activeTurnScopeId: "t2",
      activeTurn: {
        turnScopeId: "t2",
        dialogProcessId: "dp2",
        commandId: "command-t2",
        action: "send",
        state: "processing",
        phase: "processing",
        executionState: "sending",
        revision: 2,
        sequence: 4,
        summaryVersion: 0,
        capabilities: { actionLocked: true, canStop: true },
      },
    }),
  );
  await nextTick();

  expect(resolveActiveTurn()?.turnScopeId).toBe("t2");
  expect(composerActionState.value).toMatchObject({
    displayState: "sending",
    canStop: true,
  });
});
