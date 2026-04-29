/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir } from "node:fs/promises";

export class SessionStoreManager {
  constructor({
    now = () => new Date().toISOString(),
    ensureRuntimeDirsByBasePath,
    resolveParentSessionId,
    resolveSessionScope,
    sessionDir,
    sessionFile,
    taskFile,
    executionFile,
    exists,
    readJson,
    writeJson,
    normalizeMessage,
    normalizeMessages,
  } = {}) {
    this.now = now;
    this.ensureRuntimeDirsByBasePath = ensureRuntimeDirsByBasePath;
    this.resolveParentSessionId = resolveParentSessionId;
    this.resolveSessionScope = resolveSessionScope;
    this.sessionDir = sessionDir;
    this.sessionFile = sessionFile;
    this.taskFile = taskFile;
    this.executionFile = executionFile;
    this.exists = exists;
    this.readJson = readJson;
    this.writeJson = writeJson;
    this.normalizeMessage = normalizeMessage;
    this.normalizeMessages = normalizeMessages;
  }

  async ensureSession({
    basePath,
    userId,
    sessionId,
    parentSessionId = "",
    meta = {},
  }) {
    await this.ensureRuntimeDirsByBasePath(basePath);
    const resolvedParentSessionId = await this.resolveParentSessionId(
      basePath,
      sessionId,
      parentSessionId,
    );
    const targetSessionDir = await this.sessionDir(
      basePath,
      sessionId,
      resolvedParentSessionId,
    );
    await mkdir(targetSessionDir, { recursive: true });

    const currentSessionFile = await this.sessionFile(
      basePath,
      sessionId,
      resolvedParentSessionId,
    );
    if (!(await this.exists(currentSessionFile))) {
      await this.writeJson(currentSessionFile, {
        sessionId,
        parentSessionId: resolvedParentSessionId || "",
        caller: meta?.caller || "user",
        modelAlias: meta?.modelAlias || "",
        currentTaskId: "",
        shortMemoryCheckpoint: 0,
        messages: [],
        createdAt: this.now(),
        updatedAt: this.now(),
      });
    }

    const currentTaskFile = await this.taskFile(
      basePath,
      sessionId,
      resolvedParentSessionId,
    );
    if (!(await this.exists(currentTaskFile))) {
      await this.writeJson(currentTaskFile, {
        sessionId,
        currentTaskId: "",
        tasks: [],
        updatedAt: this.now(),
      });
    }

    const currentExecutionFile = await this.executionFile(
      basePath,
      sessionId,
      resolvedParentSessionId,
    );
    if (!(await this.exists(currentExecutionFile))) {
      await this.writeJson(currentExecutionFile, {
        sessionId,
        logs: [],
        updatedAt: this.now(),
      });
    }

    return { userId, sessionId, resolvedParentSessionId };
  }

  async getSessionBundle({
    basePath,
    sessionId,
    parentSessionId = "",
  }) {
    const resolvedParentSessionId = await this.resolveParentSessionId(
      basePath,
      sessionId,
      parentSessionId,
    );
    const currentSessionFile = await this.sessionFile(
      basePath,
      sessionId,
      resolvedParentSessionId,
    );
    const currentTaskFile = await this.taskFile(
      basePath,
      sessionId,
      resolvedParentSessionId,
    );

    if (!(await this.exists(currentSessionFile))) {
      return { exists: false, session: null, task: null };
    }

    const session = await this.readJson(currentSessionFile, {});
    session.parentSessionId = session.parentSessionId || resolvedParentSessionId || "";
    session.caller = session.caller || "user";
    session.modelAlias = session.modelAlias || "";

    const normalizedMessages = this.normalizeMessages(session.messages || []);
    const beforeJson = JSON.stringify(session.messages || []);
    const afterJson = JSON.stringify(normalizedMessages);
    session.messages = normalizedMessages;
    if (beforeJson !== afterJson) {
      session.updatedAt = session.updatedAt || this.now();
      await this.writeJson(currentSessionFile, session);
    }

    return {
      exists: true,
      session,
      task: await this.readJson(currentTaskFile, {
        sessionId,
        currentTaskId: "",
        tasks: [],
      }),
    };
  }

  async appendTurn({
    basePath,
    userId,
    sessionId,
    role,
    content,
    type = "",
    taskId = null,
    taskStatus = null,
    dialogProcessId = "",
    parentDialogProcessId = "",
    tool_calls = null,
    tool_call_id = "",
    attachmentMetas = [],
    modelAlias = "",
    modelName = "",
    parentSessionId = "",
  }) {
    const resolvedParentSessionId = await this.resolveParentSessionId(
      basePath,
      sessionId,
      parentSessionId,
    );
    await this.ensureSession({
      basePath,
      userId,
      sessionId,
      parentSessionId: resolvedParentSessionId,
    });
    const sessionBundle = await this.getSessionBundle({
      basePath,
      sessionId,
      parentSessionId: resolvedParentSessionId,
    });

    const resolvedTaskId = taskId ?? sessionBundle.session?.currentTaskId ?? "";
    const resolvedTaskStatus = taskStatus ?? (resolvedTaskId ? "start" : "");

    sessionBundle.session.messages = this.normalizeMessages(
      sessionBundle.session.messages || [],
    );

    const turn = this.normalizeMessage({
      role,
      content,
      type: type || "",
      dialogProcessId: dialogProcessId || "",
      parentDialogProcessId: parentDialogProcessId || "",
      taskId: resolvedTaskId,
      taskStatus: resolvedTaskStatus,
      modelAlias: String(modelAlias || "").trim(),
      modelName: String(modelName || "").trim(),
      ts: this.now(),
    });

    if (tool_call_id) turn.tool_call_id = tool_call_id;
    if (Array.isArray(tool_calls) && tool_calls.length) {
      turn.tool_calls = tool_calls;
    }
    if (Array.isArray(attachmentMetas) && attachmentMetas.length) {
      turn.attachmentMetas = attachmentMetas;
    }

    sessionBundle.session.messages.push(turn);
    sessionBundle.session.updatedAt = this.now();
    if (sessionBundle.session.shortMemoryCheckpoint === undefined) {
      sessionBundle.session.shortMemoryCheckpoint = 0;
    }

    const { sessionFile } = await this.resolveSessionScope(
      basePath,
      sessionId,
      resolvedParentSessionId,
    );
    await this.writeJson(sessionFile, sessionBundle.session);
  }
}
