/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, normalizeHeaderKeyCandidates } from "./config.js";
import { createLogger } from "./logger.js";
import { createHeaderExtractors, createProxyServer } from "./server.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function startModelProxy() {
  const config = loadConfig();
  const proxyHost = config.proxyHost;
  const proxyEntries = config.proxies;
  const { unknownModelName, unknownFlowName, unknownSessionId } = config;
  const logger = createLogger({
    logDir: path.resolve(projectRoot, config.logDir),
    logPrefix: config.logPrefix,
    unknownModelName,
    unknownFlowName,
    unknownSessionId,
    maxLogFileSizeBytes: LENGTH_THRESHOLDS.modelProxy.logFileBytes,
    retainMs: TIME_THRESHOLDS.modelProxy.logRetentionMs,
  });
  const headerExtractors = createHeaderExtractors({
    modelNameHeaderKey: config.modelNameHeaderKey.toLowerCase(),
    parentSessionIdHeaderKey: config.parentSessionIdHeaderKey.toLowerCase(),
    flowHeaderKeys: normalizeHeaderKeyCandidates(config.flowHeaderKeys, [
      config.flowHeaderKey,
      config.pluginFlowHeaderKey,
      "x-plugin-flow",
      config.harnessFlowHeaderKey,
    ]),
    sessionIdHeaderKeys: normalizeHeaderKeyCandidates(config.sessionIdHeaderKeys, [
      config.pluginSessionIdHeaderKey,
      "x-plugin-session-id",
      config.sessionIdHeaderKey,
    ]),
    unknownModelName,
    unknownFlowName,
    unknownSessionId,
  });

  for (const entry of proxyEntries) {
    createProxyServer({
      localPort: entry.localPort,
      targetUrl: entry.targetUrl,
      proxyHost,
      logger,
      headerExtractors,
      unknownModelName,
      unknownFlowName,
      unknownSessionId,
    });
  }
}
