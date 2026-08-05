/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { routeWorkflowDiagnosticsPayload } from "../runtime/workflowDiagnosticsRoute.js";
import { activate } from "../index.js";

describe("Workflow frontend registration", () => {
  it("routes node diagnostics to the parent session and preserves node identity", () => {
    const logWorkflowDiagnostics = vi.fn();
    logWorkflowDiagnostics("frontend.workflowNodeDetail.displayProjected", routeWorkflowDiagnosticsPayload("parent-session", {
      sessionId: "node-session",
      traceId: "trace-1",
      messageCount: 2,
    }));

    expect(logWorkflowDiagnostics).toHaveBeenCalledWith(
      "frontend.workflowNodeDetail.displayProjected",
      {
        sessionId: "parent-session",
        nodeSessionId: "node-session",
        traceId: "trace-1",
        messageCount: 2,
      },
    );
  });

  it("keeps the parent identity without adding a redundant nodeSessionId", () => {
    const logWorkflowDiagnostics = vi.fn();
    logWorkflowDiagnostics("frontend.workflowRender.cardUpdated", routeWorkflowDiagnosticsPayload("parent-session", {
      sessionId: "parent-session",
      traceId: "trace-2",
    }));

    expect(logWorkflowDiagnostics).toHaveBeenCalledWith(
      "frontend.workflowRender.cardUpdated",
      { sessionId: "parent-session", traceId: "trace-2" },
    );
  });

  it("contributes one plugin-runtime projector with canonical record semantics", async () => {
    const contributions = [];
    await activate({
      contributeExtension: (point, contribution) => contributions.push({ point, contribution }),
      extensionPoints: {
        COMPOSER_OPTIONS_MODEL: "composer.options.model",
        MESSAGE_CARD_PRE: "message.card.pre",
        SESSION_DETAIL_HYDRATOR: "session.detail.hydrator",
        RUNTIME_STREAM_ROUTE: "runtime.stream.route",
      },
      services: { authenticatedRequest: { get: vi.fn() } },
    });
    const runtime = contributions.find(({ point }) => point === "runtime.stream.route")?.contribution;
    const projector = runtime?.provide?.()?.[0];
    const applyWorkflowRuntimeEvent = vi.fn(() => ({ applied: true }));
    const logRuntimeProjectionDiagnostics = vi.fn();
    const messageEvent = { sessionId: "child", eventType: "tool_call_start", sequence: 3 };

    expect(projector({
      event: "subagent_message_event",
      data: { seq: 46, route: { rootSessionId: "root" }, event: messageEvent },
      context: { source: "live", applyWorkflowRuntimeEvent, logRuntimeProjectionDiagnostics },
    })).toBe(true);
    expect(applyWorkflowRuntimeEvent).toHaveBeenCalledWith({
      event: "workflow_message_event",
      data: messageEvent,
      transportSequence: 46,
    }, { source: "live" });
    expect(logRuntimeProjectionDiagnostics).toHaveBeenCalledWith(
      "frontend.workflowRuntime.projectorReduced",
      expect.objectContaining({ sessionId: "root", nodeSessionId: "child", applied: true }),
    );
  });
});
