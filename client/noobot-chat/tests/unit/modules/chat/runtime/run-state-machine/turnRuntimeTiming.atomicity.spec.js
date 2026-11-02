/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  applyTurnTimingSnapshot,
  createTurnRuntimeRegistryState,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";

const timing = (turnScopeId, dialogProcessId, modelLoopRound = 1) => ({
  turnScopeId,
  dialogProcessId,
  modelLoopRound,
});

describe("turn timing snapshot atomicity", () => {
  it("rejects a later conflict without retaining earlier timing or route writes", () => {
    const registry = createTurnRuntimeRegistryState();
    applyTurnTimingSnapshot(registry, {
      sessionId: "s1",
      turnTimings: [timing("client-turn:existing", "dp-existing")],
    });
    const before = structuredClone(registry);
    const bucket = registry.sessions.s1;
    expect(() =>
      applyTurnTimingSnapshot(registry, {
        sessionId: "s1",
        turnTimings: [
          timing("client-turn:new", "dp-new"),
          timing("client-turn:existing", "dp-existing", 2),
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "SESSION_TURN_TIMING_CONFLICT" }));
    expect(registry).toEqual(before);
    expect(registry.sessions.s1).toBe(bucket);
  });

  it("does not create a bucket when an incoming batch conflicts with itself", () => {
    const registry = createTurnRuntimeRegistryState();
    const before = structuredClone(registry);
    expect(() =>
      applyTurnTimingSnapshot(registry, {
        sessionId: "s1",
        turnTimings: [timing("client-turn:new", "dp-new"), timing("client-turn:new", "dp-other")],
      }),
    ).toThrow(expect.objectContaining({ code: "SESSION_TURN_TIMING_CONFLICT" }));
    expect(registry).toEqual(before);
  });
});
