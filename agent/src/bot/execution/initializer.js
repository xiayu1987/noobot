/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createExecutionEventListener, emitEvent } from "../../events/index.js";
import { assertSessionScopeIdentity, requireAcceptedTurnRecord } from "@noobot/session-protocol";
import { isFunction, text } from "@noobot/shared/value";

export class SessionExecutionInitializer {
  constructor({ session = null, configService = null, workspaceService = null, now }) {
    if (!isFunction(now)) {
      throw new TypeError("SessionExecutionInitializer requires now function");
    }
    this.session = session;
    this.configService = configService;
    this.workspaceService = workspaceService;
    this.now = now;
  }

  async initializeRunSessionRuntime({
    userId,
    sessionId,
    parentSessionId,
    eventListener = null,
    dialogProcessId = "",
    turnScopeId = "",
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
    if (!sessionBundle.exists) {
      throw new TypeError("accepted Turn session is required before Session run");
    }
    // Acceptance always commits the Session together with its first Turn, so a run only ever loads.
    const { startedAt } = requireAcceptedTurnRecord(sessionBundle.session.turnLifecycle, {
      turnScopeId,
      dialogProcessId: resolvedDialogProcessId,
    });
    const userConfig = await this.configService.loadUserConfig(basePath);

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
      now: this.now,
    });

    emitEvent(runtimeEventListener, "session_starting", {
      sessionId: usedSessionId,
    });
    emitEvent(runtimeEventListener, "workspace_ready", { userId });
    emitEvent(runtimeEventListener, "session_loaded", { sessionId: usedSessionId });

    return {
      usedSessionId,
      startedAt,
      parentSessionId: sessionScope.resolvedParentSessionId,
      dialogProcessId: resolvedDialogProcessId,
      userConfig,
      currentSessionModelAlias: text(sessionBundle.session.modelAlias),
      sessionDir: sessionScope.sessionDir,
      runtimeEventListener,
    };
  }
}
