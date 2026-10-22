/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createExecutionEventListener, emitEvent } from "../../events/index.js";
import { assertSessionScopeIdentity } from "@noobot/session-protocol";
import { text } from "@noobot/shared/value";
import { AGENT_CONTEXT_MODE } from "@noobot/context-protocol";

export class SessionExecutionInitializer {
  constructor({ session = null, configService = null, workspaceService = null } = {}) {
    this.session = session;
    this.configService = configService;
    this.workspaceService = workspaceService;
  }

  async initializeRunSessionRuntime({
    userId,
    sessionId,
    parentSessionId,
    caller,
    eventListener = null,
    dialogProcessId = "",
    turnScopeId = "",
    thinkingStartedAt = "",
    persistenceScope,
  }) {
    const usedSessionId = sessionId;
    const upstreamListener = eventListener;
    const basePath = await this.workspaceService.ensureUserWorkspace(userId);

    const resolvedDialogProcessId = text(dialogProcessId);
    if (!resolvedDialogProcessId) {
      throw new TypeError("accepted Turn dialogProcessId is required before Session run");
    }
    const sessionBundle = await this.session.getSessionBundle({
      userId,
      sessionId: usedSessionId,
      persistenceScope,
    });
    const sessionLoadState = sessionBundle.exists ? "loaded" : "created";
    const userConfig = await this.configService.loadUserConfig(basePath);

    if (!sessionBundle.exists) {
      await this.session.createSession({
        userId,
        sessionId: usedSessionId,
        parentSessionId,
        caller,
        persistenceScope,
      });
    }

    await this.session.upsertTurnTiming({
      userId,
      sessionId: usedSessionId,
      turnScopeId,
      dialogProcessId: resolvedDialogProcessId,
      thinkingStartedAt,
      persistenceScope,
    });

    const sessionScope = await this.session.locateSessionScope({
      userId,
      sessionId: usedSessionId,
      persistenceScope,
    });

    assertSessionScopeIdentity({
      session: { sessionId: usedSessionId, parentSessionId },
      sessionId: usedSessionId,
      parentSessionId: sessionScope.resolvedParentSessionId,
    });

    const runtimeEventListener = createExecutionEventListener({
      sessionManager: this.session,
      userId,
      sessionId: usedSessionId,
      parentSessionId: sessionScope.resolvedParentSessionId,
      turnScopeId,
      persistenceScope,
      dialogProcessId: resolvedDialogProcessId,
      upstream: upstreamListener,
    });

    emitEvent(runtimeEventListener, "session_starting", {
      mode:
        sessionLoadState === "loaded"
          ? AGENT_CONTEXT_MODE.EXISTING_SESSION
          : AGENT_CONTEXT_MODE.NEW_SESSION,
      ...(sessionLoadState === "loaded" ? { sessionId: usedSessionId } : {}),
    });
    emitEvent(runtimeEventListener, "workspace_ready", { userId });
    emitEvent(
      runtimeEventListener,
      sessionLoadState === "loaded" ? "session_loaded" : "session_created",
      { sessionId: usedSessionId },
    );

    return {
      usedSessionId,
      parentSessionId: sessionScope.resolvedParentSessionId,
      dialogProcessId: resolvedDialogProcessId,
      sessionLoadState,
      userConfig,
      currentSessionModelAlias: text(sessionBundle?.session?.modelAlias),
      sessionDir: sessionScope.sessionDir,
      runtimeEventListener,
    };
  }
}
