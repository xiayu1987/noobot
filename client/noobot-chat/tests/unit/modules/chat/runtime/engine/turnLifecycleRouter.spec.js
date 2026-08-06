/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  routeCurrentTurnLifecycleEvent,
  routeForeignTurnLifecycleEvent,
} from "../../../../../../src/modules/chat/runtime/engine/turnLifecycleRouter.js";

describe("foreign Turn lifecycle routing", () => {
  it("keeps a newly assigned backend Session on the main Turn route", () => {
    const applyTurnLifecycleEnvelope = vi.fn();
    const logSessionEvent = vi.fn();
    const data = {
      sessionId: "backend-session",
      parentSessionId: "",
      turnScopeId: "client-turn:1",
      eventType: "turn.action_accepted",
      sequence: 1,
    };

    expect(routeForeignTurnLifecycleEvent("turn_lifecycle", data, {
      activeSession: { value: { id: "local-session", sessionId: "" } },
      applyTurnLifecycleEnvelope,
      logSessionEvent,
      sessionId: "local-session",
    })).toBe(false);
    expect(applyTurnLifecycleEnvelope).not.toHaveBeenCalled();
    expect(logSessionEvent).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ route: "main" }),
    }));
  });

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
      activeSession: { value: { sessionId: "root-session" } },
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
      activeSession: { value: { sessionId: "root-session" } },
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

describe("committed user Turn routing", () => {
  it("clears a pending interaction when the authoritative Turn terminates", () => {
    const clearPendingInteractionIfObsolete = vi.fn();
    const applyTurnLifecycleEnvelope = vi.fn();
    expect(routeCurrentTurnLifecycleEvent("turn_lifecycle", {
      sessionId: "session-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      eventType: "turn.failed",
    }, {
      activeSession: { value: { sessionId: "session-1" } },
      applyTurnLifecycleEnvelope,
      clearPendingInteractionIfObsolete,
      sessionId: "session-1",
    })).toBe(true);
    expect(clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
      sessionId: "session-1",
      dialogProcessId: "dialog-1",
    });
  });

  it("replaces draft attachments with the canonical committed attachment set", () => {
    const draftMessage = {
      id: "frontend-user-1",
      messageId: "frontend-user-1",
      role: "user",
      turnScopeId: "client-turn:1",
      attachments: [{ clientAttachmentId: "draft-1", name: "old.docx" }],
    };
    const activeSession = {
      value: {
        id: "session-1",
        sessionId: "session-1",
        version: 0,
        messages: [draftMessage],
      },
    };
    const logSessionEvent = vi.fn();
    const canonicalAttachment = {
      attachmentId: "attachment-1",
      clientAttachmentId: "draft-1",
      sessionId: "session-1",
      name: "old.docx",
    };

    expect(routeCurrentTurnLifecycleEvent("turn_committed", {
      sessionId: "session-1",
      aggregateVersion: 1,
      dialogProcessId: "dialog-1",
      turnScopeId: "client-turn:1",
      userMessage: {
        messageUid: "sm_1",
        id: "frontend-user-1",
        messageId: "frontend-user-1",
        role: "user",
        sessionId: "session-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "client-turn:1",
        content: "parse attachments",
        attachments: [canonicalAttachment],
      },
    }, {
      activeSession,
      findCanonicalMessageById: (_sessionId, messageId) => (
        messageId === draftMessage.messageId ? draftMessage : null
      ),
      makeViewMessage: (message) => ({ ...message, attachments: [...message.attachments] }),
      logSessionEvent,
      sessionId: "session-1",
    })).toBe(true);

    expect(activeSession.value.aggregateVersion).toBe(1);
    expect(draftMessage).toMatchObject({
      messageUid: "sm_1",
      messageId: "frontend-user-1",
      dialogProcessId: "dialog-1",
      attachments: [canonicalAttachment],
    });
    expect(logSessionEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: "frontend.turnCommit.userMessageApplied",
      data: expect.objectContaining({ applied: true, attachmentCount: 1 }),
    }));
  });

  it("rejects a commit whose stable message id has no local target", () => {
    const logSessionEvent = vi.fn();
    const activeSession = {
      value: { id: "session-1", sessionId: "session-1", version: 0, messages: [] },
    };

    expect(routeCurrentTurnLifecycleEvent("turn_committed", {
      sessionId: "session-1",
      aggregateVersion: 1,
      dialogProcessId: "dialog-1",
      turnScopeId: "client-turn:1",
      userMessage: {
        messageUid: "sm_1",
        messageId: "missing-user",
        role: "user",
        sessionId: "session-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "client-turn:1",
        attachments: [],
      },
    }, {
      activeSession,
      findCanonicalMessageById: () => null,
      logSessionEvent,
      sessionId: "session-1",
    })).toBe(true);

    expect(logSessionEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: "frontend.turnCommit.userMessageRejected",
      data: expect.objectContaining({ reason: "committed_user_target_missing" }),
    }));
  });
});
