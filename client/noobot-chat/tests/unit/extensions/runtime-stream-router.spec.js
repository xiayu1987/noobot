/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearExtensionRegistry,
  contributeExtension,
} from "../../../src/extensions/extension-registry.js";
import { EXTENSION_POINTS } from "@noobot/plugin-protocol/frontend";
import { routeRuntimeStreamEvent } from "../../../src/extensions/runtime-stream-router.js";
import { createEventEnvelope, EVENT_FAMILY, getEventFamily } from "@noobot/event-protocol";
import {
  WORKFLOW_RUNTIME_EVENT,
  WORKFLOW_SEQUENCE_DOMAIN,
} from "@noobot/event-protocol/workflow-runtime-event";

function workflowNodeEvent() {
  return createEventEnvelope({
    family: EVENT_FAMILY.WORKFLOW_RUNTIME,
    schemaVersion: getEventFamily(EVENT_FAMILY.WORKFLOW_RUNTIME).schemaVersion,
    identity: {
      eventId: "workflow-node-event-7",
      eventType: WORKFLOW_RUNTIME_EVENT.NODE_STATE,
      sessionId: "s-1",
      turnScopeId: "turn-1",
      executionId: "node-1",
    },
    causality: {},
    ordering: {
      domain: WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE,
      scopeId: "workflow-1",
      sequence: 7,
      revision: 1,
    },
    producer: { type: "test", id: "runtime-stream-router" },
    occurredAt: "2026-01-01T00:00:07.000Z",
    payload: {
      workflowRunId: "workflow-1",
      status: "running",
      activeChildExecutionId: "agent-1",
      attemptExecutionIds: ["agent-1"],
      turnScopeId: "turn-1",
    },
  });
}

describe("runtime stream projector boundary", () => {
  afterEach(() => clearExtensionRegistry());

  it.each([
    "turn_lifecycle",
    "turn_snapshot",
    "execution_snapshot",
    "execution_children",
    "execution_tree",
  ])("keeps authoritative-state event %s out of plugin projectors", (event) => {
    const projector = vi.fn(() => true);
    contributeExtension(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE, {
      id: "hostile-projector",
      provide: () => [projector],
    });

    expect(routeRuntimeStreamEvent({ event }, {})).toBe(false);
    expect(projector).not.toHaveBeenCalled();
  });

  it("allows declared plugin runtime facts through the projector gateway", () => {
    const projector = vi.fn(() => true);
    contributeExtension(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE, {
      id: "plugin-projector",
      provide: () => [projector],
    });

    expect(
      routeRuntimeStreamEvent(workflowNodeEvent(), {
        source: "live",
        isCurrentActiveSession: () => true,
      }),
    ).toBe(true);
    expect(projector).toHaveBeenCalledOnce();
  });

  it("rejects invalid context before matching or invoking projectors", () => {
    const projector = vi.fn(() => true);
    const when = vi.fn(() => true);
    contributeExtension(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE, {
      id: "context-projector",
      when,
      provide: () => [projector],
    });
    for (const context of [undefined, {}, { source: "live" }]) {
      expect(() => routeRuntimeStreamEvent(workflowNodeEvent(), context)).toThrow(
        expect.objectContaining({ code: "PLUGIN_EXTENSION_CONTEXT_INVALID" }),
      );
    }
    expect(when).not.toHaveBeenCalled();
    expect(projector).not.toHaveBeenCalled();
  });

  it("rejects invalid projectors before invoking any later projector", () => {
    const logRuntimeProjectionDiagnostics = vi.fn();
    const projector = vi.fn(() => true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    contributeExtension(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE, {
      id: "mixed-projectors",
      provide: () => [null, {}, projector],
    });
    try {
      expect(() =>
        routeRuntimeStreamEvent(workflowNodeEvent(), {
          source: "live",
          isCurrentActiveSession: () => true,
          logRuntimeProjectionDiagnostics,
        }),
      ).toThrow("invalid_runtime_stream_route");
      expect(projector).not.toHaveBeenCalled();
      expect(
        logRuntimeProjectionDiagnostics.mock.calls.filter(
          ([event]) => event === "frontend.pluginRuntime.projectorFailed",
        ),
      ).toHaveLength(1);
      expect(logRuntimeProjectionDiagnostics).toHaveBeenCalledWith(
        "frontend.pluginRuntime.gatewayEvaluated",
        expect.objectContaining({ projectorCount: 1 }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("records registered, matched, and executable projector counts", () => {
    const logRuntimeProjectionDiagnostics = vi.fn();
    const predicate = vi.fn(
      ({ envelope }) => envelope?.identity?.eventType === WORKFLOW_RUNTIME_EVENT.NODE_STATE,
    );
    contributeExtension(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE, {
      id: "matching-projector",
      pluginId: "plugin-a",
      when: predicate,
      provide: () => [() => true],
    });
    contributeExtension(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE, {
      id: "nonmatching-projector",
      pluginId: "plugin-b",
      when: () => false,
      provide: () => [() => true],
    });

    expect(
      routeRuntimeStreamEvent(workflowNodeEvent(), {
        source: "live",
        isCurrentActiveSession: () => true,
        logRuntimeProjectionDiagnostics,
      }),
    ).toBe(true);
    expect(logRuntimeProjectionDiagnostics).toHaveBeenCalledWith(
      "frontend.pluginRuntime.gatewayEvaluated",
      expect.objectContaining({
        registeredContributionIds: ["matching-projector", "nonmatching-projector"],
        matchedContributionIds: ["matching-projector"],
        projectorCount: 1,
      }),
    );
    expect(predicate).toHaveBeenCalledOnce();
  });

  it("keeps diagnostic identities on the validated envelope when context identities differ", () => {
    const logRuntimeProjectionDiagnostics = vi.fn();
    const envelope = workflowNodeEvent();
    routeRuntimeStreamEvent(envelope, {
      source: "live",
      isCurrentActiveSession: () => true,
      sessionId: "active-session",
      turnScopeId: "active-turn",
      logRuntimeProjectionDiagnostics,
    });

    expect(logRuntimeProjectionDiagnostics).toHaveBeenCalledWith(
      "frontend.pluginRuntime.gatewayEvaluated",
      expect.objectContaining({
        sessionId: envelope.identity.sessionId,
        turnScopeId: envelope.identity.turnScopeId,
        eventType: envelope.identity.eventType,
        eventFamily: envelope.protocol.family,
        dialogProcessId: undefined,
      }),
    );
  });

  it("keeps projector failure diagnostics on the same envelope identity", () => {
    const logRuntimeProjectionDiagnostics = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    contributeExtension(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE, {
      id: "failing-projector",
      provide: () => [
        () => {
          throw new Error("projector failed");
        },
      ],
    });
    try {
      expect(() =>
        routeRuntimeStreamEvent(workflowNodeEvent(), {
          source: "reconnect",
          isCurrentActiveSession: () => true,
          sessionId: "active-session",
          turnScopeId: "active-turn",
          logRuntimeProjectionDiagnostics,
        }),
      ).toThrow("projector failed");
      expect(logRuntimeProjectionDiagnostics).toHaveBeenCalledWith(
        "frontend.pluginRuntime.projectorFailed",
        expect.objectContaining({
          sessionId: "s-1",
          turnScopeId: "turn-1",
          source: "reconnect",
          error: "projector failed",
        }),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
