/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import fs from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  buildThinkingDetailPayload,
  readExecutionReportArtifact,
  readSessionArtifactSnapshot,
} from "noobot-agent/session";
import { HTTP_STATUS } from "noobot-agent/constants";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import {
  WORKSPACE_PATH_SEGMENT_PATTERN,
  resolvePluginAssetsRelativePath,
  resolvePluginDataRelativePath,
} from "@noobot/workspace-protocol";

const assetIdPattern = WORKSPACE_PATH_SEGMENT_PATTERN;
const assetVersionPattern = /^[a-f0-9]{64}$/;

function requireAssetToken(value, pattern, label) {
  const normalized = String(value || "").trim();
  if (!pattern.test(normalized)) throw new TypeError(`invalid workspace asset ${label}`);
  return normalized;
}

function createWorkspaceAssetWriter({ resolveRoot }) {
  return async function write({
    userId,
    assetId,
    source,
    declaredBytes = 0,
    validate = null,
  } = {}) {
    const normalizedAssetId = requireAssetToken(assetId, assetIdPattern, "ID");
    if (!source || typeof source.pipe !== "function") {
      throw new TypeError("workspace asset source stream is required");
    }
    const expectedBytes = Number(declaredBytes);
    const maximum = LENGTH_THRESHOLDS.serviceHttp.workspaceAssetFileBytes;
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > maximum) {
      const error = new Error("workspace asset content length is invalid");
      error.statusCode = expectedBytes > maximum ? 413 : 400;
      throw error;
    }
    const assetDir = path.resolve(resolveRoot(userId), normalizedAssetId);
    await fs.mkdir(assetDir, { recursive: true });
    const temporaryPath = path.resolve(assetDir, `.upload-${randomUUID()}`);
    const hash = createHash("sha256");
    const prefixChunks = [];
    let prefixBytes = 0;
    let actualBytes = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        actualBytes += chunk.length;
        if (actualBytes > maximum) {
          const error = new Error("workspace asset exceeds the configured size limit");
          error.statusCode = 413;
          callback(error);
          return;
        }
        if (prefixBytes < 16) {
          const prefix = chunk.subarray(0, Math.min(chunk.length, 16 - prefixBytes));
          prefixChunks.push(prefix);
          prefixBytes += prefix.length;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(source, meter, createWriteStream(temporaryPath, { flags: "wx" }));
      if (actualBytes !== expectedBytes) {
        const error = new Error("workspace asset content length mismatch");
        error.statusCode = 400;
        throw error;
      }
      const prefix = Buffer.concat(prefixChunks);
      if (typeof validate === "function") validate({ prefix, size: actualBytes });
      const version = hash.digest("hex");
      const filePath = path.resolve(assetDir, version);
      try {
        await fs.rename(temporaryPath, filePath);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        await fs.rm(temporaryPath, { force: true });
      }
      return Object.freeze({ assetId: normalizedAssetId, version, size: actualBytes });
    } catch (error) {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }
  };
}

function createWorkspaceAssetPort({ bot, pluginId }) {
  const normalizedPluginId = requireAssetToken(pluginId, assetIdPattern, "plugin ID");
  const resolveRoot = (userId) => {
    const workspacePath = String(bot?.getWorkspacePath?.(userId) || "").trim();
    if (!workspacePath) throw new Error("workspace path not found");
    return path.resolve(workspacePath, resolvePluginAssetsRelativePath(normalizedPluginId));
  };
  const resolveVersionPath = (userId, assetId, version) =>
    path.resolve(
      resolveRoot(userId),
      requireAssetToken(assetId, assetIdPattern, "ID"),
      requireAssetToken(version, assetVersionPattern, "version"),
    );
  const resolveCatalogPath = (userId) => path.resolve(resolveRoot(userId), "catalog.json");
  let catalogMutation = Promise.resolve();
  const readCatalog = async (userId) => {
    try {
      const value = JSON.parse(await fs.readFile(resolveCatalogPath(userId), "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("workspace asset catalog must be an object");
      }
      return value;
    } catch (error) {
      if (error?.code === "ENOENT") return {};
      throw error;
    }
  };
  const writeCatalog = async (userId, catalog) => {
    const root = resolveRoot(userId);
    await fs.mkdir(root, { recursive: true });
    const temporaryPath = path.resolve(root, `.catalog-${randomUUID()}`);
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(catalog), { flag: "wx" });
      await fs.rename(temporaryPath, resolveCatalogPath(userId));
    } catch (error) {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }
  };
  const mutateCatalog = (mutation) => {
    const operation = catalogMutation.then(mutation, mutation);
    catalogMutation = operation.catch(() => undefined);
    return operation;
  };
  return Object.freeze({
    maxFileBytes: LENGTH_THRESHOLDS.serviceHttp.workspaceAssetFileBytes,
    write: createWorkspaceAssetWriter({ resolveRoot }),
    async read({ userId, assetId, version } = {}) {
      const filePath = resolveVersionPath(userId, assetId, version);
      let stats;
      try {
        stats = await fs.stat(filePath);
      } catch (error) {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
        throw error;
      }
      if (!stats.isFile()) return null;
      return Object.freeze({
        size: stats.size,
        stream: createReadStream(filePath),
      });
    },
    async listMetadata({ userId } = {}) {
      return Object.freeze({ ...(await readCatalog(userId)) });
    },
    async writeMetadata({ userId, assetId, metadata } = {}) {
      const normalizedAssetId = requireAssetToken(assetId, assetIdPattern, "ID");
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        throw new TypeError("workspace asset metadata object is required");
      }
      return mutateCatalog(async () => {
        const catalog = await readCatalog(userId);
        catalog[normalizedAssetId] = metadata;
        await writeCatalog(userId, catalog);
        return metadata;
      });
    },
    async delete({ userId, assetId } = {}) {
      const normalizedAssetId = requireAssetToken(assetId, assetIdPattern, "ID");
      return mutateCatalog(async () => {
        const catalog = await readCatalog(userId);
        const existed = Object.prototype.hasOwnProperty.call(catalog, normalizedAssetId);
        delete catalog[normalizedAssetId];
        await writeCatalog(userId, catalog);
        await fs.rm(path.resolve(resolveRoot(userId), normalizedAssetId), {
          recursive: true,
          force: true,
        });
        return Object.freeze({ assetId: normalizedAssetId, deleted: existed });
      });
    },
  });
}

function createPluginSessionPort({ bot, pluginId, translateText }) {
  const normalizedPluginId = requireAssetToken(pluginId, assetIdPattern, "plugin ID");
  function resolveSessionDir({ userId, segments, locale = "" }) {
    const notFound = () => new Error(translateText?.("common.notFound", locale) || "not found");
    const workspacePath = String(bot?.getWorkspacePath?.(userId) || "").trim();
    if (!workspacePath) throw notFound();
    let relativeDir;
    try {
      relativeDir = resolvePluginDataRelativePath(
        normalizedPluginId,
        ...(Array.isArray(segments) ? segments : []).map((item) => String(item ?? "").trim()),
      );
    } catch {
      throw notFound();
    }
    return { outputDir: path.resolve(workspacePath, relativeDir) };
  }
  return Object.freeze({
    async readSnapshot({ userId, segments, locale, executionPage = null }) {
      const { outputDir } = resolveSessionDir({ userId, segments, locale });
      let entries = [];
      try {
        entries = await fs.readdir(outputDir);
      } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
      }
      const snapshot = await readSessionArtifactSnapshot({
        outputDir,
        executionLogOptions: executionPage
          ? { skip: executionPage.cursor, limit: executionPage.limit + 1 }
          : {},
      });
      const childSessionId = String(
        snapshot.sessionSummary?.sessionId || snapshot.session?.sessionId || "",
      ).trim();
      return { ...snapshot, childSessionId, artifactNames: entries };
    },
    async readThinkingDetail({ userId, segments, dialogProcessId, turnScopeId, locale }) {
      const { outputDir } = resolveSessionDir({ userId, segments, locale });
      const { session, sessionSummary } = await readSessionArtifactSnapshot({
        outputDir,
        includeExecutionLogs: false,
      });
      const summaryMessage = (
        Array.isArray(sessionSummary?.messages) ? sessionSummary.messages : []
      ).find(
        (message = {}) =>
          String(message?.turnScopeId || "").trim() === String(turnScopeId || "").trim() &&
          (!dialogProcessId ||
            String(message?.dialogProcessId || "").trim() === String(dialogProcessId).trim()),
      );
      return buildThinkingDetailPayload(
        {
          exists: Boolean(session?.sessionId),
          sessionId: String(session?.sessionId || "").trim(),
          revision: String(summaryMessage?.thinkingDetailRef?.contentHash || "").trim(),
          sessions: [
            {
              sessionId: String(session?.sessionId || "").trim(),
              rawMessages: Array.isArray(session?.messages) ? session.messages : [],
            },
          ],
        },
        { dialogProcessId, turnScopeId },
      );
    },
    async readExecutionReport({ userId, segments, dialogProcessId, locale }) {
      const { outputDir } = resolveSessionDir({ userId, segments, locale });
      return readExecutionReportArtifact({ sessionDir: outputDir, dialogProcessId });
    },
  });
}

export function createPluginServicePorts({ bot = null, translateText = null } = {}) {
  return Object.freeze({
    http: Object.freeze({ status: HTTP_STATUS }),
    workspaceAssets: Object.freeze({
      forPlugin(pluginId) {
        return createWorkspaceAssetPort({ bot, pluginId });
      },
    }),
    sessions: Object.freeze({
      forPlugin(pluginId) {
        return createPluginSessionPort({ bot, pluginId, translateText });
      },
    }),
  });
}
