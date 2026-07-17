/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_FILE_PATH = path.join(__dirname, '..', 'model-proxy.config.json');

const DEFAULT_CONFIG = {
  proxyHost: '0.0.0.0',
  proxies: [
    {
      localPort: 12341,
      targetUrl: 'https://dashscope.aliyuncs.com',
    },
    {
      localPort: 12342,
      targetUrl: 'https://api.poe.com',
    },
  ],
  logDir: 'logs',
  logPrefix: 'requests',
  unknownModelName: 'unknown_model',
  unknownFlowName: 'unknown_flow',
  unknownSessionId: 'unknown_session',
  modelNameHeaderKey: 'x-model-name',
  flowHeaderKeys: ['x-plugin-flow', 'x-harness-flow'],
  sessionIdHeaderKeys: ['x-plugin-session-id', 'x-harness-session-id'],
  harnessFlowHeaderKey: 'x-harness-flow',
  sessionIdHeaderKey: 'x-harness-session-id',
  parentSessionIdHeaderKey: 'parentsessionid',
  maxLogFileSizeBytes: 10 * 1024 * 1024,
  retainMs: 60 * 60 * 1000,
};

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE_PATH)) return { ...DEFAULT_CONFIG };
    const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
    };
  } catch (error) {
    console.error('[model-proxy] Failed to load config, fallback to defaults:', error);
    return { ...DEFAULT_CONFIG };
  }
}

function normalizeProxyEntries(rawEntries = []) {
  if (!Array.isArray(rawEntries) || !rawEntries.length) {
    return [...DEFAULT_CONFIG.proxies];
  }

  const usedPorts = new Set();
  const normalized = [];

  for (let index = 0; index < rawEntries.length; index += 1) {
    const item = rawEntries[index] || {};
    const rawTarget = String(item.targetUrl || '').trim();
    if (!rawTarget) continue;

    let localPort = Number(item.localPort);
    if (!Number.isInteger(localPort) || localPort <= 0 || localPort > 65535) {
      localPort = DEFAULT_CONFIG.proxies[0].localPort + index;
    }

    if (usedPorts.has(localPort)) {
      console.error(`[model-proxy] Duplicate localPort in config: ${localPort}, skip target ${rawTarget}`);
      continue;
    }

    usedPorts.add(localPort);
    normalized.push({
      targetUrl: rawTarget,
      localPort,
    });
  }

  return normalized.length ? normalized : [...DEFAULT_CONFIG.proxies];
}

function normalizeHeaderKeyCandidates(primaryKeys = [], fallbackKeys = []) {
  const keys = [
    ...(Array.isArray(primaryKeys) ? primaryKeys : [primaryKeys]),
    ...(Array.isArray(fallbackKeys) ? fallbackKeys : [fallbackKeys]),
  ]
    .map((key) => String(key || '').trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(keys));
}

export {
  DEFAULT_CONFIG,
  loadConfig,
  normalizeHeaderKeyCandidates,
  normalizeProxyEntries,
};
