/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CONFIG,
  loadConfig,
  normalizeHeaderKeyCandidates,
  normalizeProxyEntries,
} from './config.js';
import { createRequestCacheDiagnosticsTracker } from './cache-diagnostics.js';
import { createLogger } from './logger.js';
import {
  createHeaderExtractors,
  createProxyServer,
} from './server.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const config = loadConfig();
const proxyHost = String(config.proxyHost || DEFAULT_CONFIG.proxyHost).trim() || DEFAULT_CONFIG.proxyHost;
const proxyEntries = normalizeProxyEntries(config.proxies);
const unknownModelName = String(config.unknownModelName || DEFAULT_CONFIG.unknownModelName);
const unknownFlowName = String(config.unknownFlowName || DEFAULT_CONFIG.unknownFlowName);
const unknownSessionId = String(config.unknownSessionId || DEFAULT_CONFIG.unknownSessionId);
const logger = createLogger({
  logDir: path.resolve(projectRoot, String(config.logDir || DEFAULT_CONFIG.logDir)),
  logPrefix: String(config.logPrefix || DEFAULT_CONFIG.logPrefix),
  unknownModelName,
  unknownFlowName,
  unknownSessionId,
  maxLogFileSizeBytes: Number(config.maxLogFileSizeBytes) > 0
    ? Number(config.maxLogFileSizeBytes)
    : DEFAULT_CONFIG.maxLogFileSizeBytes,
  retainMs: Number(config.retainMs) > 0 ? Number(config.retainMs) : DEFAULT_CONFIG.retainMs,
});
const headerExtractors = createHeaderExtractors({
  modelNameHeaderKey: String(config.modelNameHeaderKey || DEFAULT_CONFIG.modelNameHeaderKey).toLowerCase(),
  parentSessionIdHeaderKey: String(
    config.parentSessionIdHeaderKey || DEFAULT_CONFIG.parentSessionIdHeaderKey,
  ).toLowerCase(),
  flowHeaderKeys: normalizeHeaderKeyCandidates(
    config.flowHeaderKeys,
    [
      config.flowHeaderKey,
      config.pluginFlowHeaderKey,
      'x-plugin-flow',
      config.harnessFlowHeaderKey,
      DEFAULT_CONFIG.harnessFlowHeaderKey,
    ],
  ),
  sessionIdHeaderKeys: normalizeHeaderKeyCandidates(
    config.sessionIdHeaderKeys,
    [
      config.pluginSessionIdHeaderKey,
      'x-plugin-session-id',
      config.sessionIdHeaderKey,
      DEFAULT_CONFIG.sessionIdHeaderKey,
    ],
  ),
  unknownModelName,
  unknownFlowName,
  unknownSessionId,
});
const buildRequestCacheDiagnostics = createRequestCacheDiagnosticsTracker();

for (const entry of proxyEntries) {
  createProxyServer({
    localPort: entry.localPort,
    targetUrl: entry.targetUrl,
    proxyHost,
    logger,
    buildRequestCacheDiagnostics,
    headerExtractors,
    unknownModelName,
    unknownFlowName,
    unknownSessionId,
  });
}
