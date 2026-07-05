/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { mkdir, writeFile, appendFile, access } from "node:fs/promises";
import { emitEvent } from "../../event/index.js";
import { mapAttachmentRecordsToMetas } from "../../attach/index.js";
import { MIME_TYPE } from "../../constants/index.js";
import { normalizeSessionEntity } from "../../session/entities/session-entity.js";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";
import {
  applyNormalizedMessageFlags,
  persistSnapshotJsonFiles,
  resolvePreferredAttachments,
  resolveTransferEnvelopeListFromMessage,
} from "./session-execution-engine-utils.js";

export class ScopedArtifactPersistenceHelpers {
  constructor({
    session = null,
    attach = null,
    workspaceService = null,
    now = null,
  } = {}) {
    this.session = session;
    this.attach = attach;
    this.workspaceService = workspaceService;
    this.now = typeof now === "function" ? now : () => new Date().toISOString();
  }

  resolveScopedDir({
    userId = "",
    relativeDir = "",
    absoluteDir = "",
  } = {}) {
    const workspacePath = this.workspaceService.getWorkspacePath(userId);
    const resolvedWorkspacePath = path.resolve(workspacePath);
    if (absoluteDir && String(absoluteDir || "").trim()) {
      const resolvedAbsoluteDir = path.resolve(String(absoluteDir || "").trim());
      const relativeFromWorkspace = path.relative(
        resolvedWorkspacePath,
        resolvedAbsoluteDir,
      );
      if (
        !relativeFromWorkspace ||
        relativeFromWorkspace.startsWith("..") ||
        path.isAbsolute(relativeFromWorkspace)
      ) {
        throw new Error("plugin scoped output path must be inside workspace");
      }
      return resolvedAbsoluteDir;
    }
    const normalizedRelativeDir = String(relativeDir || "").trim().replaceAll("\\", "/");
    if (!normalizedRelativeDir) return "";
    const resolvedDir = path.resolve(resolvedWorkspacePath, normalizedRelativeDir);
    const relativeFromWorkspace = path.relative(resolvedWorkspacePath, resolvedDir);
    if (
      !relativeFromWorkspace ||
      relativeFromWorkspace.startsWith("..") ||
      path.isAbsolute(relativeFromWorkspace)
    ) {
      throw new Error("plugin scoped output path must be inside workspace");
    }
    return resolvedDir;
  }

  resolveScopedFileTarget({
    userId = "",
    relativeDir = "",
    absoluteDir = "",
    fileName = "payload.json",
    userIdError = "plugin scoped writer requires userId",
    outputDirError = "plugin scoped writer requires output directory",
    fileNameError = "plugin scoped writer fileName must be plain file name",
  } = {}) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) throw new Error(userIdError);
    const outputDir = this.resolveScopedDir({
      userId: normalizedUserId,
      relativeDir,
      absoluteDir,
    });
    if (!outputDir) throw new Error(outputDirError);
    const normalizedFileName = String(fileName || "payload.json").trim() || "payload.json";
    if (normalizedFileName.includes("/") || normalizedFileName.includes("\\")) {
      throw new Error(fileNameError);
    }
    return {
      outputDir,
      outputFile: path.join(outputDir, normalizedFileName),
    };
  }

  async persistSubSessionSnapshot({
    userId = "",
    sessionId = "",
    parentSessionId = "",
    outputDir = "",
    metadata = null,
  } = {}) {
    if (!userId || !sessionId || !outputDir) return null;
    const sessionBundle = await this.session.getSessionBundle({
      userId,
      sessionId,
      parentSessionId,
    });
    const executionBundle = await this.session.getExecutionBundle({
      userId,
      sessionId,
    });
    const session = sessionBundle?.session && typeof sessionBundle.session === "object"
      ? sessionBundle.session
      : null;
    const tasks = Array.isArray(sessionBundle?.turnTasks) ? sessionBundle.turnTasks : [];
    const execution = executionBundle && typeof executionBundle === "object"
      ? executionBundle
      : { sessionId, logs: [] };
    return persistSnapshotJsonFiles({
      outputDir,
      sessionPayload: session || { sessionId, messages: [] },
      taskPayload: { sessionId, currentTaskId: "", tasks, updatedAt: this.now() },
      executionPayload: execution,
      metadata,
    });
  }

  normalizeDetachedSubSessionMessage(message = {}, now = "") {
    const ts = String(now || this.now()).trim() || this.now();
    const normalized = {
      role: String(message?.role || "").trim() || "assistant",
      content: message?.content || "",
      type: String(message?.type || "").trim(),
      dialogProcessId: String(message?.dialogProcessId || "").trim(),
      parentDialogProcessId: String(message?.parentDialogProcessId || "").trim(),
      turnScopeId: String(message?.turnScopeId || "").trim(),
      taskId: String(message?.taskId || "").trim(),
      taskStatus: String(message?.taskStatus || "").trim(),
      modelAlias: String(message?.modelAlias || "").trim(),
      modelName: String(message?.modelName || "").trim(),
      summarized: message?.summarized === true,
      ts,
    };
    if (Array.isArray(message?.tool_calls)) normalized.tool_calls = message.tool_calls;
    if (String(message?.tool_call_id || "").trim()) {
      normalized.tool_call_id = String(message.tool_call_id || "").trim();
    }
    const preferredAttachments = resolvePreferredAttachments(message);
    if (preferredAttachments.length) normalized.attachments = preferredAttachments;
    const transferEnvelopes = resolveTransferEnvelopeListFromMessage(message);
    if (transferEnvelopes.length) normalized.transferEnvelopes = transferEnvelopes;
    return applyNormalizedMessageFlags(normalized, message);
  }

  async persistDetachedSubSessionSnapshot({
    outputDir = "",
    sessionPayload = {},
    taskPayload = {},
    executionPayload = {},
    metadata = null,
  } = {}) {
    if (!outputDir) return null;
    const normalizedSessionPayload = normalizeSessionEntity(
      sessionPayload && typeof sessionPayload === "object" ? sessionPayload : {},
      { now: () => this.now() },
    );
    return persistSnapshotJsonFiles({
      outputDir,
      sessionPayload: normalizedSessionPayload,
      taskPayload: taskPayload && typeof taskPayload === "object" ? taskPayload : {},
      executionPayload: executionPayload && typeof executionPayload === "object" ? executionPayload : {},
      metadata,
    });
  }

  async assertDetachedSubSessionIsolation({
    userId = "",
    sessionId = "",
    eventListener = null,
    scope = "sub_session",
  } = {}) {
    if (!userId || !sessionId) return true;
    const workspacePath = this.workspaceService.getWorkspacePath(userId);
    const leakedMainSessionFile = path.resolve(
      workspacePath,
      "runtime/session",
      sessionId,
      "session.json",
    );
    try {
      await access(leakedMainSessionFile);
    } catch {
      return true;
    }
    const payload = {
      scope,
      userId,
      sessionId,
      leakedMainSessionFile,
      message: "detached sub session leaked into runtime/session main tree",
    };
    emitEvent(
      typeof eventListener === "function" ? eventListener : null,
      "plugin_subsession_persistence_leak",
      payload,
    );
    await writeRoutedRuntimeEvent({
      scope: "session",
      source: "agent",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
      event: "plugin_subsession_persistence_leak",
      userId,
      sessionId,
      data: payload,
    }, {
      workspaceRoot: path.dirname(workspacePath),
    }).catch(() => null);
    return false;
  }

  createScopedJsonWriter() {
    return async ({
      userId = "",
      relativeDir = "",
      absoluteDir = "",
      fileName = "payload.json",
      payload = {},
    } = {}) => {
      const { outputDir, outputFile } = this.resolveScopedFileTarget({
        userId,
        relativeDir,
        absoluteDir,
        fileName,
        userIdError: "plugin scoped writer requires userId",
        outputDirError: "plugin scoped writer requires output directory",
        fileNameError: "plugin scoped writer fileName must be plain file name",
      });
      await mkdir(outputDir, { recursive: true });
      await writeFile(
        outputFile,
        `${JSON.stringify(
          payload && typeof payload === "object" ? payload : { value: payload },
          null,
          2,
        )}\n`,
        "utf8",
      );
      return {
        outputDir,
        outputFile,
      };
    };
  }

  createScopedEventLogger() {
    return async ({
      userId = "",
      relativeDir = "",
      absoluteDir = "",
      fileName = "events.jsonl",
      event = {},
    } = {}) => {
      const { outputDir, outputFile } = this.resolveScopedFileTarget({
        userId,
        relativeDir,
        absoluteDir,
        fileName,
        userIdError: "plugin event logger requires userId",
        outputDirError: "plugin event logger requires output directory",
        fileNameError: "plugin event logger fileName must be plain file name",
      });
      await mkdir(outputDir, { recursive: true });
      await appendFile(
        outputFile,
        `${JSON.stringify({
          timestamp: this.now(),
          ...(event && typeof event === "object" ? event : { value: event }),
        })}\n`,
        "utf8",
      );
      return {
        outputDir,
        outputFile,
      };
    };
  }

  createGeneratedArtifactPersister() {
    return async ({
      userId = "",
      sessionId = "",
      attachmentSource = "model",
      generationSource = "generated_artifact",
      artifacts = [],
      fallbackMimeType = MIME_TYPE.APPLICATION_OCTET_STREAM,
    } = {}) => {
      const attachmentService = this.attach;
      if (!attachmentService || typeof attachmentService.ingestGeneratedArtifacts !== "function") {
        return [];
      }
      const normalizedUserId = String(userId || "").trim();
      const normalizedSessionId = String(sessionId || "").trim();
      if (!normalizedUserId || !normalizedSessionId) return [];
      const artifactList = Array.isArray(artifacts) ? artifacts : [];
      if (!artifactList.length) return [];
      const normalizedGenerationSource = String(generationSource || "generated_artifact").trim();
      const records = await attachmentService.ingestGeneratedArtifacts({
        userId: normalizedUserId,
        sessionId: normalizedSessionId,
        attachmentSource: String(attachmentSource || "model").trim() || "model",
        generationSource: normalizedGenerationSource,
        artifacts: artifactList,
      });
      return mapAttachmentRecordsToMetas(records, {
        fallbackMimeType,
        fallbackGenerationSource: normalizedGenerationSource,
      });
    };
  }
}
