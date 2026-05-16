/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { v4 as uuidv4 } from "uuid";
import { createExecutionEventListener, emitEvent } from "../../event/index.js";
import { CALLER_ROLE } from "../config/constants.js";

/**
 * Session runtime initializer.
 */
export class SessionExecutionInitializer {
  constructor({
    session = null,
    configService = null,
    workspaceService = null,
  } = {}) {
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
  }) {
    const usedSessionId = sessionId;
    const upstreamListener = eventListener;
    const basePath = await this.workspaceService.ensureUserWorkspace(userId);

    await this.session.upsertSessionTree({
      userId,
      sessionId: usedSessionId,
      parentSessionId,
    });

    const dialogProcessId = uuidv4();
    const sessionBundle = await this.session.getSessionBundle({
      userId,
      sessionId: usedSessionId,
      parentSessionId,
    });
    const isContinue = Boolean(sessionBundle?.exists);
    const userConfig = await this.configService.loadUserConfig(basePath);

    await this.session.createSession({
      userId,
      sessionId: usedSessionId,
      parentSessionId,
      caller,
      modelAlias: "",
    });

    const executionStartIndex =
      (await this.session.getExecutionBundle({
        userId,
        sessionId: usedSessionId,
      }))?.logs?.length || 0;

    const runtimeEventListener = createExecutionEventListener({
      sessionManager: this.session,
      userId,
      sessionId: usedSessionId,
      parentSessionId,
      upstream: { ...upstreamListener, dialogProcessId },
    });

    emitEvent(runtimeEventListener, "session_starting", {
      mode: isContinue ? "continue" : "new",
      ...(isContinue ? { sessionId: usedSessionId } : {}),
    });
    emitEvent(runtimeEventListener, "workspace_ready", { userId });
    emitEvent(
      runtimeEventListener,
      isContinue ? "session_loaded" : "session_created",
      { sessionId: usedSessionId },
    );

    return {
      usedSessionId,
      dialogProcessId,
      isContinue,
      userConfig,
      currentSessionModelAlias: String(sessionBundle?.session?.modelAlias || "").trim(),
      executionStartIndex,
      runtimeEventListener,
    };
  }
}
