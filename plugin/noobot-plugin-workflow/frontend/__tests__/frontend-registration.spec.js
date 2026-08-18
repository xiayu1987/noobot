/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { routeWorkflowDiagnosticsPayload } from "../runtime/workflowDiagnosticsRoute.js";
import { activate } from "../index.js";
import workflowManifest from "../../manifest.json";
import { createEventEnvelope, EVENT_FAMILY } from "@noobot/event-protocol";
import { validatePluginContributionReceipt } from "@noobot/plugin-protocol";
import {
  WORKFLOW_RUNTIME_EVENT,
  WORKFLOW_SEQUENCE_DOMAIN,
} from "@noobot/event-protocol/workflow-runtime-event";

describe("Workflow frontend registration", () => {
  it("registers exactly the frontend contributions declared by the manifest", async () => {
    const contributions = [];
    await activate({
      contributeExtension: (point, contribution) => contributions.push({ point, contribution }),
      extensionPoints: {
        COMPOSER_OPTIONS_MODEL: "composer.options.model",
        MESSAGE_CARD_PRE: "message.card.pre",
        RUNTIME_STREAM_ROUTE: "runtime.stream.route",
      },
      services: { authenticatedRequest: { get: vi.fn() } },
    });

    const receipt = contributions.map(({ point, contribution }) => ({
      type: "extension",
      contributionId: contribution.id,
      point,
    }));
    expect(validatePluginContributionReceipt(workflowManifest, "frontend", receipt)).toEqual([
      "extension:workflow-model-extension:composer.options.model",
      "extension:workflow-card:message.card.pre",
      "extension:workflow-runtime-projector:runtime.stream.route",
    ]);
  });

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
    const envelope = createEventEnvelope({
      family: EVENT_FAMILY.WORKFLOW_RUNTIME,
      identity: {
        eventId: "workflow-node-state-46",
        eventType: WORKFLOW_RUNTIME_EVENT.NODE_STATE,
        sessionId: "root",
        turnScopeId: "workflow-node:node-1",
      },
      causality: {},
      ordering: {
        domain: WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE,
        scopeId: "workflow-1",
        sequence: 46,
        revision: 3,
      },
      producer: { type: "test", id: "workflow-frontend-registration" },
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload: {
        workflowRunId: "workflow-1",
        nodeExecutionId: "node-1",
        nodeSessionId: "child",
        status: "running",
      },
    });

    expect(projector({
      envelope,
      descriptor: { family: EVENT_FAMILY.WORKFLOW_RUNTIME },
      context: { source: "live", applyWorkflowRuntimeEvent, logRuntimeProjectionDiagnostics },
    })).toBe(true);
    expect(applyWorkflowRuntimeEvent).toHaveBeenCalledWith(envelope, { source: "live" });
    expect(logRuntimeProjectionDiagnostics).toHaveBeenCalledWith(
      "frontend.workflowRuntime.projectorReduced",
      expect.objectContaining({ sessionId: "root", nodeSessionId: "child", applied: true }),
    );
  });
});
