/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { routeForeignTurnLifecycleEvent } from "../../../../../../src/modules/chat/runtime/engine/turnLifecycleRouter.js";

describe("foreign Turn lifecycle routing", () => {
  it("commits child Session authority envelopes into the canonical Turn registry", () => {
    const applyTurnLifecycleEnvelope = vi.fn();
    const data = {
      sessionId: "child-session",
      parentSessionId: "root-session",
      turnScopeId: "workflow-node:node-a",
      eventType: "turn.processing_started",
      sequence: 2,
    };

    expect(routeForeignTurnLifecycleEvent("turn_lifecycle", data, {
      activeSession: { value: { backendSessionId: "root-session" } },
      applyTurnLifecycleEnvelope,
      sessionId: "root-session",
    })).toBe(true);
    expect(applyTurnLifecycleEnvelope).toHaveBeenCalledWith(data);
  });

  it("logs the settled terminal resolution result instead of treating its Promise as a reducer result", async () => {
    const logSessionEvent = vi.fn();
    const applyTurnLifecycleEnvelope = vi.fn().mockResolvedValue({
      applied: true,
      reason: "terminal_resolution_applied",
    });
    const data = {
      sessionId: "child-session",
      parentSessionId: "root-session",
      turnScopeId: "workflow-node:node-a",
      eventType: "turn.completed",
      revision: 4,
      sequence: 4,
    };

    routeForeignTurnLifecycleEvent("turn_lifecycle", data, {
      activeSession: { value: { backendSessionId: "root-session" } },
      applyTurnLifecycleEnvelope,
      logSessionEvent,
      sessionId: "root-session",
    });
    await Promise.resolve();

    expect(logSessionEvent).toHaveBeenCalledTimes(2);
    expect(logSessionEvent.mock.calls[0][0]).toMatchObject({
      event: "frontend.authoritativeState.lifecycleRouteEvaluated",
      data: {
        route: "child",
        eventSessionId: "child-session",
        mainSessionId: "root-session",
      },
    });
    expect(logSessionEvent.mock.calls[1][0].data).toMatchObject({
      applied: true,
      reason: "terminal_resolution_applied",
      terminalResolutionScheduled: true,
    });
  });
});
