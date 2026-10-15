/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { v4 as uuidv4 } from "uuid";
import { createExecutionEventListener, emitEvent } from "../../events/index.js";
import { CALLER_ROLE } from "../config/constants.js";
import { text } from "@noobot/shared/value";

export class SessionExecutionInitializer {
  constructor({ session = null, configService = null, workspaceService = null } = {}) {
    this.session = session;
    this.configService = configService;
    this.workspaceService = workspaceService;
  }

  async initializeRunSessionRuntime({
    userId,
    sessionId,
    parentSessionId = "",
    caller = CALLER_ROLE.USER,
    eventListener = null,
    dialogProcessId = "",
    turnScopeId = "",
    thinkingStartedAt = "",
    persistenceContext = null,
  }) {
    const usedSessionId = sessionId;
    const upstreamListener = eventListener;
    const basePath = await this.workspaceService.ensureUserWorkspace(userId);

    const resolvedDialogProcessId = text(dialogProcessId) || uuidv4();
    const sessionBundle = await this.session.getSessionBundle({
      userId,
      sessionId: usedSessionId,
      parentSessionId,
      persistenceContext,
    });
    const sessionLoadState = sessionBundle?.exists ? "loaded" : "created";
    const userConfig = await this.configService.loadUserConfig(basePath);

    await this.session.createSession({
      userId,
      sessionId: usedSessionId,
      parentSessionId,
      caller,
      modelAlias: "",
      persistenceContext,
    });

    await this.session.upsertTurnTiming({
      userId,
      sessionId: usedSessionId,
      parentSessionId,
      turnScopeId,
      dialogProcessId: resolvedDialogProcessId,
      thinkingStartedAt,
      persistenceContext,
    });

    const sessionScope = await this.session.resolveSessionScope({
      userId,
      sessionId: usedSessionId,
      parentSessionId,
      persistenceContext,
    });

    const runtimeEventListener = createExecutionEventListener({
      sessionManager: this.session,
      userId,
      sessionId: usedSessionId,
      parentSessionId,
      turnScopeId,
      persistenceContext,
      upstream: { ...upstreamListener, dialogProcessId: resolvedDialogProcessId },
    });

    emitEvent(runtimeEventListener, "session_starting", {
      mode: sessionLoadState === "loaded" ? "existing_session" : "new_session",
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
      dialogProcessId: resolvedDialogProcessId,
      sessionLoadState,
      userConfig,
      currentSessionModelAlias: text(sessionBundle?.session?.modelAlias),
      sessionDir: sessionScope.sessionDir,
      runtimeEventListener,
    };
  }
}
