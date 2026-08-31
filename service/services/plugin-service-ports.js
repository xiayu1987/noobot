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
  iterateExecutionLogs,
  readSessionArtifactSnapshot,
} from "noobot-agent/session";
import { HTTP_STATUS } from "noobot-agent/constants";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

const assetIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/;
const assetVersionPattern = /^[a-f0-9]{64}$/;

function requireAssetToken(value, pattern, label) {
  const normalized = String(value || "").trim();
  if (!pattern.test(normalized)) throw new TypeError(`invalid workspace asset ${label}`);
  return normalized;
}

function createWorkspaceAssetPort({ bot, pluginId }) {
  const normalizedPluginId = requireAssetToken(pluginId, assetIdPattern, "plugin ID");
  const resolveRoot = (userId) => {
    const workspacePath = String(bot?.getWorkspacePath?.(userId) || "").trim();
    if (!workspacePath) throw new Error("workspace path not found");
    return path.resolve(workspacePath, "runtime/plugin-assets", normalizedPluginId);
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
    async write({ userId, assetId, source, declaredBytes = 0, validate = null } = {}) {
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
    },
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

async function readSegmentedExecutionLogs({
  workspacePath,
  rootSessionId,
  childSessionId,
  skip = 0,
  limit = Infinity,
}) {
  const sessionsRoot = path.resolve(workspacePath, "runtime/session");
  const eventsDir = path.resolve(sessionsRoot, rootSessionId, childSessionId, "execution-events");
  const relative = path.relative(sessionsRoot, eventsDir);
  if (
    !rootSessionId ||
    !childSessionId ||
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  )
    return [];
  let entries = [];
  try {
    entries = await fs.readdir(eventsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = entries
    .filter((entry) => entry.isFile() && /^segment-\d+\.jsonl$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const logs = [];
  let seen = 0;
  for (const name of names) {
    try {
      for await (const log of iterateExecutionLogs(path.join(eventsDir, name))) {
        if (seen++ < skip) continue;
        if (logs.length >= limit) return logs;
        logs.push(log);
      }
    } catch {
      continue;
    }
  }
  return logs;
}

export function createPluginServicePorts({ bot = null, translateText = null } = {}) {
  function resolveWorkflowDir({ userId, sessionId, dialogProcessId, locale = "" }) {
    const workspacePath = String(bot?.getWorkspacePath?.(userId) || "").trim();
    if (!workspacePath) throw new Error(translateText?.("common.notFound", locale) || "not found");
    const outputDir = path.resolve(
      workspacePath,
      "runtime/workflow/session",
      String(sessionId || "").trim(),
      String(dialogProcessId || "").trim(),
    );
    const relative = path.relative(path.resolve(workspacePath), outputDir);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(translateText?.("common.notFound", locale) || "not found");
    }
    return { workspacePath, outputDir };
  }

  return Object.freeze({
    http: Object.freeze({ status: HTTP_STATUS }),
    workspaceAssets: Object.freeze({
      forPlugin(pluginId) {
        return createWorkspaceAssetPort({ bot, pluginId });
      },
    }),
    sessions: Object.freeze({
      async readWorkflowSnapshot({
        userId,
        sessionId,
        dialogProcessId,
        locale,
        executionPage = null,
      }) {
        const { workspacePath, outputDir } = resolveWorkflowDir({
          userId,
          sessionId,
          dialogProcessId,
          locale,
        });
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
        const scopedLogs = Array.isArray(snapshot.executionLogs) ? snapshot.executionLogs : [];
        const hasScopedArtifacts =
          entries.includes("execution-events") || entries.includes("execution-events.jsonl");
        const executionLogs =
          scopedLogs.length || (executionPage && hasScopedArtifacts)
            ? scopedLogs
            : await readSegmentedExecutionLogs({
                workspacePath,
                rootSessionId: sessionId,
                childSessionId,
                skip: executionPage?.cursor || 0,
                limit: executionPage ? executionPage.limit + 1 : Infinity,
              });
        return { ...snapshot, executionLogs, childSessionId, artifactNames: entries };
      },
      async readWorkflowThinkingDetail({
        userId,
        sessionId,
        routeDialogProcessId,
        dialogProcessId,
        turnScopeId,
        locale,
      }) {
        const { outputDir } = resolveWorkflowDir({
          userId,
          sessionId,
          dialogProcessId: routeDialogProcessId,
          locale,
        });
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
    }),
  });
}
