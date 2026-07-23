/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "../../utils/path-resolver.js";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { mapAttachmentRecordsToMetas } from "../../attach/index.js";
import { MIME_TYPE } from "../../constants/index.js";
import {
  persistSnapshotJsonFiles,
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
    const sessionRepo = this.session?.repositories?.sessionRepository
      || this.session?.sessionRepo
      || this.session?.sessionRepository
      || this.session?.repo
      || null;
    return persistSnapshotJsonFiles({
      outputDir,
      sessionPayload: session || { sessionId, messages: [] },
      taskPayload: { sessionId, currentTaskId: "", tasks, updatedAt: this.now() },
      executionPayload: execution,
      metadata,
      mutationLockDir: typeof sessionRepo?._sessionLifecycleLockDir === "function"
        ? sessionRepo._sessionLifecycleLockDir(userId, sessionId)
        : "",
      assertSessionWritable: typeof sessionRepo?.assertSessionWritable === "function"
        ? () => sessionRepo.assertSessionWritable(userId, sessionId)
        : null,
    });
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
