/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, it, expect } from "vitest";
import {
  applyTurnRuntimeEvent,
  applyTurnLifecycleSnapshot,
  applyTurnTimingSnapshot,
  createTurnRuntimeRegistryState,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { SESSION_RUN_EVENT } from "@noobot/session-protocol/runtime-event";
import { lifecycle, snapshot } from "./turnRuntimeRegistryTestFixtures.js";
import { turnRecordFixture } from "../../helpers/turnRecordFixture.js";

const terminal = (fields = {}) =>
  turnRecordFixture({
    sessionId: "s1",
    turnScopeId: "t2",
    dialogProcessId: "dp2",
    state: "completed",
    revision: 3,
    sequence: 3,
    ...fields,
  });

describe("runtime input rejection is atomic", () => {
  it("does not hydrate an earlier snapshot turn when a later identity conflicts", () => {
    const registry = createTurnRuntimeRegistryState();
    lifecycle(registry, { turnScopeId: "t2", dialogProcessId: "dp-original" });
    const before = structuredClone(registry);
    const result = applyTurnLifecycleSnapshot(
      registry,
      snapshot({
        sequence: 4,
        recentTerminalTurns: [terminal()],
      }),
    );
    expect(result).toMatchObject({ applied: false, reason: "dialog_process_identity_conflict" });
    expect(registry).toEqual(before);
  });

  it("does not hydrate earlier turns or metadata when later timing conflicts", () => {
    const registry = createTurnRuntimeRegistryState();
    applyTurnTimingSnapshot(registry, {
      sessionId: "s1",
      turnTimings: [
        {
          turnScopeId: "t2",
          dialogProcessId: "dp2",
          thinkingFinishedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    });
    const before = structuredClone(registry);
    expect(() =>
      applyTurnLifecycleSnapshot(
        registry,
        snapshot({
          sequence: 4,
          recentTerminalTurns: [terminal({ thinkingFinishedAt: "2026-01-01T00:00:02.000Z" })],
        }),
      ),
    ).toThrow();
    expect(registry).toEqual(before);
  });

  it.each([
    { failure: { message: "incomplete" } },
    { finalizeIntent: {} },
    { continuationSource: { turnScopeId: "t1", dialogProcessId: "dp1" } },
    { capabilities: { canStop: "true", actionLocked: true } },
    { updatedAt: "invalid" },
    { sessionId: " s1 " },
    { seq: "1" },
  ])("rejects malformed authoritative input without creating routing or state: %j", (invalid) => {
    const registry = createTurnRuntimeRegistryState();
    const before = structuredClone(registry);
    expect(
      applyTurnRuntimeEvent(registry, {
        type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
        sessionId: "s1",
        turnScopeId: "t1",
        dialogProcessId: "dp1",
        state: "processing",
        seq: 1,
        revision: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...invalid,
      }),
    ).toMatchObject({ applied: false, reason: "invalid_runtime_event" });
    expect(registry).toEqual(before);
  });
});
