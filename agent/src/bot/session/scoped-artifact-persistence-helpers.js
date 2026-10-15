/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { ATTACHMENT_SOURCE } from "@noobot/attachment-protocol";
import { mapAttachmentRecordsToMetas } from "../../artifacts/index.js";
import { MIME_TYPE } from "@noobot/attachment-protocol/mime";
import { text } from "@noobot/shared/value";

const assertInsideWorkspace = (resolvedWorkspacePath, resolvedDir) => {
  const relativeFromWorkspace = path.relative(resolvedWorkspacePath, resolvedDir);
  if (
    !relativeFromWorkspace ||
    relativeFromWorkspace.startsWith("..") ||
    path.isAbsolute(relativeFromWorkspace)
  ) {
    throw new Error("plugin scoped output path must be inside workspace");
  }
  return resolvedDir;
};

export class ScopedArtifactPersistenceHelpers {
  constructor({ session = null, attach = null, workspaceService = null, now = null } = {}) {
    this.session = session;
    this.attach = attach;
    this.workspaceService = workspaceService;
    this.now = typeof now === "function" ? now : () => new Date().toISOString();
  }

  resolveScopedDir({ userId = "", relativeDir = "", absoluteDir = "" } = {}) {
    const workspacePath = this.workspaceService.getWorkspacePath(userId);
    const resolvedWorkspacePath = path.resolve(workspacePath);
    if (absoluteDir && text(absoluteDir)) {
      const resolvedAbsoluteDir = path.resolve(text(absoluteDir));
      return assertInsideWorkspace(resolvedWorkspacePath, resolvedAbsoluteDir);
    }
    const normalizedRelativeDir = text(relativeDir).replaceAll("\\", "/");
    if (!normalizedRelativeDir) return "";
    const resolvedDir = path.resolve(resolvedWorkspacePath, normalizedRelativeDir);
    return assertInsideWorkspace(resolvedWorkspacePath, resolvedDir);
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
    const normalizedUserId = text(userId);
    if (!normalizedUserId) throw new Error(userIdError);
    const outputDir = this.resolveScopedDir({
      userId: normalizedUserId,
      relativeDir,
      absoluteDir,
    });
    if (!outputDir) throw new Error(outputDirError);
    const normalizedFileName = text(fileName) || "payload.json";
    if (normalizedFileName.includes("/") || normalizedFileName.includes("\\")) {
      throw new Error(fileNameError);
    }
    return {
      outputDir,
      outputFile: path.join(outputDir, normalizedFileName),
    };
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
      const normalizedUserId = text(userId);
      const normalizedSessionId = text(sessionId);
      if (!normalizedUserId || !normalizedSessionId) return [];
      const artifactList = Array.isArray(artifacts) ? artifacts : [];
      if (!artifactList.length) return [];
      const normalizedGenerationSource = text(generationSource) || "generated_artifact";
      const records = await attachmentService.ingestGeneratedArtifacts({
        userId: normalizedUserId,
        sessionId: normalizedSessionId,
        attachmentSource:
          text(attachmentSource) || ATTACHMENT_SOURCE.MODEL || ATTACHMENT_SOURCE.MODEL,
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
