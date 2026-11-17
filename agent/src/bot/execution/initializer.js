/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createExecutionEventListener, emitEvent } from "../../events/index.js";
import { assertSessionScopeIdentity } from "@noobot/session-protocol";
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
    const runContext = await this.session.getSessionRunContext({
      userId,
      sessionId: usedSessionId,
      persistenceScope,
      turnScopeId,
      dialogProcessId: resolvedDialogProcessId,
    });
    const userConfig = await this.configService.loadUserConfig(basePath);

    assertSessionScopeIdentity({
      session: { sessionId: usedSessionId, parentSessionId },
      sessionId: usedSessionId,
      parentSessionId: runContext.parentSessionId,
    });

    const runtimeEventListener = createExecutionEventListener({
      sessionManager: this.session,
      userId,
      sessionId: usedSessionId,
      parentSessionId: runContext.parentSessionId,
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
      startedAt: runContext.startedAt,
      parentSessionId: runContext.parentSessionId,
      dialogProcessId: resolvedDialogProcessId,
      userConfig,
      currentSessionModelAlias: runContext.modelAlias,
      sessionDir: runContext.sessionDir,
      runtimeEventListener,
    };
  }
}
