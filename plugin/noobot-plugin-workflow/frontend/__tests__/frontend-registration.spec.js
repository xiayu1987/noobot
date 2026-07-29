/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { routeWorkflowDiagnosticsPayload } from "../runtime/workflowDiagnosticsRoute.js";

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
});
