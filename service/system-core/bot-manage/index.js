/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { SessionManager } from "../session/index.js";
import { MemoryService } from "../memory/index.js";
import { ContextBuilder } from "../context/index.js";
import { AttachmentService } from "../attach/index.js";
import { SkillService } from "../skill/index.js";
import { runAgentTurn } from "../agent/engine.js";
import { sanitizeUserConfig } from "../config/index.js";
import { createExecutionEventListener, emitEvent } from "../event/index.js";
import { ensureUserWorkspaceInitialized } from "../init/index.js";
import { appendSystemErrorLog } from "../logs/index.js";

function isValidSessionId(sessionId = "") {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(sessionId || ""),
  );
}

export class BotManager {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
    this.session = new SessionManager(globalConfig);
    this.memory = new MemoryService(globalConfig);
    this.attach = new AttachmentService(globalConfig);
    this.skill = new SkillService(globalConfig);
    this.asyncJobs = new Map();
  }

  _now() {
    return new Date().toISOString();
  }

  _validateRunInput({
    userId,
    sessionId,
    caller = "user",
    parentSessionId = "",
  }) {
    if (!userId || !sessionId) throw new Error("userId/sessionId required");
    if (!isValidSessionId(sessionId)) {
      throw new Error("invalid sessionId format (UUID required)");
    }
    if (!["user", "bot"].includes(String(caller || ""))) {
      throw new Error("invalid caller");
    }
    if (parentSessionId && !isValidSessionId(parentSessionId)) {
      throw new Error("invalid parentSessionId format");
    }
  }

  getWorkspacePath(userId) {
    return path.resolve(this.globalConfig.workspaceRoot, userId);
  }

  ensureUserWorkspace(userId) {
    return ensureUserWorkspaceInitialized({
      workspaceRoot: this.globalConfig.workspaceRoot,
      workspaceTemplatePath: this.globalConfig.workspaceTemplatePath,
      userId,
      globalConfig: this.globalConfig,
    });
  }

  getAttachmentById({ userId, attachmentId }) {
    return this.attach.getAttachmentById({ userId, attachmentId });
  }

  async loadUserConfig(basePath) {
    const rawText = await readFile(path.join(basePath, "config.json"), "utf8");
    const raw = JSON.parse(rawText);
    return sanitizeUserConfig(raw);
  }

  _buildContextBuilder({
    userId,
    sessionId,
    caller,
    parentSessionId,
    userConfig,
    attachments,
    eventListener,
    userInteractionBridge = null,
  }) {
    return new ContextBuilder({
      globalConfig: this.globalConfig,
      userConfig,
      eventListener,
      userId,
      sessionId,
      caller,
      parentSessionId,
      attachments,
      sessionManager: this.session,
      memoryService: this.memory,
      attachmentService: this.attach,
      skillService: this.skill,
      botManager: this,
      userInteractionBridge,
    });
  }

  async _buildAgentContext({
    mode,
    userId,
    sessionId,
    caller,
    parentSessionId,
    userConfig,
    attachments,
    eventListener,
    dialogProcessId = "",
    userInteractionBridge = null,
  }) {
    const contextBuilder = this._buildContextBuilder({
      userId,
      sessionId,
      caller,
      parentSessionId,
      userConfig,
      attachments,
      eventListener,
      userInteractionBridge,
    });
    emitEvent(eventListener, "context_building", { sessionId, mode });
    const agentContext =
      mode === "initial"
        ? await contextBuilder.buildInitialContext({ dialogProcessId })
        : await contextBuilder.buildContinueContext({ dialogProcessId });
    emitEvent(eventListener, "context_ready", {
      sessionId,
      messageCount: agentContext?.conversationMessages?.length || 0,
    });
    return agentContext;
  }

  async _appendSessionTurn({
    userId,
    sessionId,
    role,
    content,
    type = "",
    taskId = null,
    taskStatus = null,
    tool_calls = null,
    tool_call_id = "",
    attachmentIds = [],
    attachments = [],
    dialogProcessId = "",
    parentSessionId = "",
    eventListener,
  }) {
    await this.session.appendTurn({
      userId,
      sessionId,
      parentSessionId,
      role,
      content,
      type,
      taskId,
      taskStatus,
      dialogProcessId,
      tool_calls,
      tool_call_id,
      attachmentIds,
      attachments,
    });
    emitEvent(eventListener, `${role}_message_saved`, { sessionId });
  }

  async _appendAgentMessages({
    userId,
    sessionId,
    parentSessionId = "",
    messages = [],
    dialogProcessId = "",
    eventListener,
  }) {
    for (const messageItem of messages) {
      await this._appendSessionTurn({
        userId,
        sessionId,
        role: messageItem.role || "assistant",
        content: messageItem.content || "",
        type: messageItem.type || "",
        parentSessionId,
        dialogProcessId: messageItem.dialogProcessId || dialogProcessId || "",
        tool_calls: Array.isArray(messageItem.tool_calls)
          ? messageItem.tool_calls
          : null,
        tool_call_id: messageItem.tool_call_id || "",
        eventListener,
      });
    }
  }

  _logSystemError({
    userId = "",
    sessionId = "",
    parentSessionId = "",
    source = "bot-manage",
    event = "system_error",
    error = null,
    extra = {},
  }) {
    try {
      const basePath = this.ensureUserWorkspace(userId);
      appendSystemErrorLog({
        basePath,
        userId,
        sessionId,
        parentSessionId,
        source,
        event,
        message: error?.message || String(error || ""),
        stack: error?.stack || "",
        extra,
      });
    } catch (logError) {
      // eslint-disable-next-line no-console
      console.error("[system_error][log_write_failed]", logError);
    }
  }

  _asyncJobKey({ parentSessionId = "", sessionId = "" }) {
    return `${String(parentSessionId || "")}::${String(sessionId || "")}`;
  }

  _buildAsyncSubAgentEventListener({
    upstream = null,
    parentSessionId = "",
    subSessionId = "",
    task = "",
    sourceDialogProcessId = "",
  }) {
    if (!upstream?.onEvent) return null;
    const label = `子任务#${String(subSessionId || "").slice(0, 8)}`;
    return {
      onEvent: (eventPayload = {}) => {
        const event = String(eventPayload?.event || "");
        const data = eventPayload?.data || {};
        const ts = eventPayload?.ts || this._now();
        upstream.onEvent({
          event,
          ts,
          data: {
            ...data,
            subAgentCall: true,
            subAgentLabel: label,
            subAgentSessionId: String(subSessionId || ""),
            subAgentParentSessionId: String(parentSessionId || ""),
            subAgentTask: String(task || ""),
            sourceDialogProcessId: String(sourceDialogProcessId || ""),
          },
        });
      },
    };
  }

  async runSession({
    userId,
    sessionId,
    message,
    attachments = [],
    eventListener = null,
    caller = "user",
    parentSessionId = "",
    abortSignal = null,
    userInteractionBridge = null,
  }) {
    try {
      if (!message) throw new Error("userId/sessionId/message required");
      this._validateRunInput({ userId, sessionId, caller, parentSessionId });

      const usedSessionId = sessionId;
      const upstreamListener = eventListener;
      const basePath = this.ensureUserWorkspace(userId);

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
      const userConfig = await this.loadUserConfig(basePath);
      const ingestedAttachments = await this.attach.ingest({
        userId,
        attachments,
      });
      const userMessageAttachmentIds = ingestedAttachments.map(
        (attachmentItem) => String(attachmentItem?.attachmentId || ""),
      );
      const userMessageAttachments = ingestedAttachments.map((attachmentItem) => ({
        attachmentId: String(attachmentItem?.attachmentId || ""),
        name: String(attachmentItem?.name || ""),
        mimeType: String(
          attachmentItem?.mimeType || "application/octet-stream",
        ),
        size: Number(attachmentItem?.size || 0),
      }));

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

      const agentContext = await this._buildAgentContext({
        mode: isContinue ? "continue" : "initial",
        userId,
        sessionId: usedSessionId,
        caller,
        parentSessionId,
        userConfig,
        attachments: ingestedAttachments,
        eventListener: runtimeEventListener,
        dialogProcessId,
        userInteractionBridge,
      });

      await this._appendSessionTurn({
        userId,
        sessionId: usedSessionId,
        parentSessionId,
        role: "user",
        content: message,
        type: "message",
        attachmentIds: userMessageAttachmentIds,
        attachments: userMessageAttachments,
        dialogProcessId,
        eventListener: runtimeEventListener,
      });

      const agentResult = await runAgentTurn({
        agentContext: {
          ...agentContext,
          runtime: {
            ...(agentContext?.runtime || {}),
            abortSignal,
          },
        },
        userMessage: message,
      });
      emitEvent(runtimeEventListener, "agent_done", {
        sessionId: usedSessionId,
        traceCount: agentResult?.traces?.length || 0,
      });

      await this._appendAgentMessages({
        userId,
        sessionId: usedSessionId,
        parentSessionId,
        messages: agentResult?.turnMessages || [
          {
            role: "assistant",
            content: agentResult.output || "",
            type: "message",
            dialogProcessId,
          },
        ],
        dialogProcessId,
        eventListener: runtimeEventListener,
      });

      await this.memory.captureSessionToShortMemory({
        userId,
        sessionId: usedSessionId,
        parentSessionId,
        userConfig,
      });
      emitEvent(runtimeEventListener, "short_memory_captured", {
        sessionId: usedSessionId,
      });
      await this.memory.maybeSummarize({ userId, userConfig });
      emitEvent(runtimeEventListener, "memory_summary_checked", {
        sessionId: usedSessionId,
      });

      const execution = await this.session.getExecutionBundle({
        userId,
        sessionId: usedSessionId,
      });
      const executionLogs = (execution?.logs || []).slice(executionStartIndex);

      return {
        sessionId: usedSessionId,
        parentSessionId: parentSessionId || "",
        caller: String(caller || "user"),
        answer: agentResult.output,
        traces: agentResult.traces,
        messages: agentResult?.turnMessages || [],
        executionLogs,
        dialogProcessId,
      };
    } catch (error) {
      this._logSystemError({
        userId,
        sessionId,
        parentSessionId,
        source: "BotManager.runSession",
        event: "run_session_failed",
        error,
      });
      throw error;
    }
  }

  async startNewSession({
    userId,
    sessionId,
    message,
    attachments = [],
    eventListener = null,
  }) {
    if (!sessionId) throw new Error("sessionId required");
    return this.runSession({
      userId,
      sessionId,
      message,
      attachments,
      eventListener,
      caller: "user",
      parentSessionId: "",
    });
  }

  async continueSession({
    userId,
    sessionId,
    message,
    attachments = [],
    eventListener = null,
  }) {
    if (!sessionId) throw new Error("sessionId required");
    return this.runSession({
      userId,
      sessionId,
      message,
      attachments,
      eventListener,
      caller: "user",
      parentSessionId: "",
    });
  }

  runAsyncSession({
    userId,
    parentSessionId,
    sessionId = "",
    task = "",
    sharedTaskSpec = "",
    deliverable = "",
    attachments = [],
    eventListener = null,
    sourceDialogProcessId = "",
    userInteractionBridge = null,
  }) {
    if (!userId || !parentSessionId) {
      throw new Error("userId/parentSessionId required");
    }
    if (!isValidSessionId(parentSessionId)) {
      throw new Error("invalid parentSessionId format");
    }

    const usedSessionId = String(sessionId || "").trim() || uuidv4();
    if (!isValidSessionId(usedSessionId)) {
      throw new Error("invalid sessionId format");
    }

    const message = [
      `任务: ${task || ""}`,
      `共享任务说明: ${sharedTaskSpec || ""}`,
      `规定最终交付物（文件及说明）: ${deliverable || ""}`,
    ].join("\n");

    const key = this._asyncJobKey({
      parentSessionId,
      sessionId: usedSessionId,
    });
    const startedAt = this._now();
    const job = {
      key,
      sessionId: usedSessionId,
      parentSessionId,
      status: "running",
      startedAt,
      endedAt: "",
      result: null,
      error: "",
      input: { task, sharedTaskSpec, deliverable },
      promise: null,
    };
    this.asyncJobs.set(key, job);

    const asyncEventListener = this._buildAsyncSubAgentEventListener({
      upstream: eventListener,
      parentSessionId,
      subSessionId: usedSessionId,
      task,
      sourceDialogProcessId,
    });

    job.promise = this.runSession({
      userId,
      sessionId: usedSessionId,
      parentSessionId,
      caller: "bot",
      message,
      attachments,
      eventListener: asyncEventListener,
      userInteractionBridge,
    })
      .then((result) => {
        job.status = "completed";
        job.endedAt = this._now();
        job.result = result;
        return result;
      })
      .catch((error) => {
        job.status = "failed";
        job.endedAt = this._now();
        job.error = error?.message || String(error);
        this._logSystemError({
          userId,
          sessionId: usedSessionId,
          parentSessionId,
          source: "BotManager.runAsyncSession",
          event: "run_async_session_failed",
          error,
          extra: { task, sharedTaskSpec, deliverable },
        });
        throw error;
      });

    return {
      ok: true,
      status: "running",
      sessionId: usedSessionId,
      parentSessionId,
      startedAt,
    };
  }

  async waitAsyncSession({
    userId,
    parentSessionId,
    sessionId,
    timeoutMs = 120000,
  }) {
    try {
      if (!userId || !parentSessionId || !sessionId) {
        throw new Error("userId/parentSessionId/sessionId required");
      }

      const key = this._asyncJobKey({ parentSessionId, sessionId });
      const job = this.asyncJobs.get(key);
      const normalizedTimeoutMs = Math.max(1000, Number(timeoutMs || 120000));

      if (!job?.promise) {
        const bundle = await this.session.getSessionBundle({
          userId,
          sessionId,
          parentSessionId,
        });
        return {
          ok: !!bundle?.exists,
          status: bundle?.exists ? "completed" : "not_found",
          sessionId,
          parentSessionId,
        };
      }

      const timeoutSignal = new Promise((resolve) =>
        setTimeout(() => resolve({ timeout: true }), normalizedTimeoutMs),
      );
      const result = await Promise.race([
        job.promise.then((resultPayload) => ({ result: resultPayload })),
        timeoutSignal,
      ]);

      if (result?.timeout) {
        return {
          ok: true,
          status: "running",
          sessionId,
          parentSessionId,
          startedAt: job.startedAt,
        };
      }

      return {
        ok: true,
        status: job.status,
        sessionId,
        parentSessionId,
        startedAt: job.startedAt,
        endedAt: job.endedAt,
        result: result?.result || null,
        error: job.error || "",
      };
    } catch (error) {
      this._logSystemError({
        userId,
        sessionId,
        parentSessionId,
        source: "BotManager.waitAsyncSession",
        event: "wait_async_session_failed",
        error,
      });
      throw error;
    }
  }
}
