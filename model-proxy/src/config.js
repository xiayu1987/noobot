/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readOptionalJsonObjectConfigSync } from "@noobot/shared/config-file";
import { isPlainObject, text } from "@noobot/shared/value";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_FILE_PATH = path.join(__dirname, "..", "model-proxy.config.json");

const DEFAULT_CONFIG = {
  proxyHost: "0.0.0.0",
  proxies: [
    {
      localPort: 12341,
      targetUrl: "https://dashscope.aliyuncs.com",
    },
    {
      localPort: 12342,
      targetUrl: "https://api.poe.com",
    },
  ],
  logDir: "logs",
  logPrefix: "requests",
  unknownModelName: "unknown_model",
  unknownFlowName: "unknown_flow",
  unknownSessionId: "unknown_session",
  modelNameHeaderKey: "x-model-name",
  flowHeaderKeys: ["x-plugin-flow", "x-harness-flow"],
  sessionIdHeaderKeys: ["x-plugin-session-id", "x-harness-session-id"],
  harnessFlowHeaderKey: "x-harness-flow",
  sessionIdHeaderKey: "x-harness-session-id",
  parentSessionIdHeaderKey: "parentsessionid",
};

function loadConfig(configFilePath = CONFIG_FILE_PATH) {
  const parsed = readOptionalJsonObjectConfigSync({
    filePath: configFilePath,
    defaultValue: {},
  });
  for (const key of ["maxLogFileSizeBytes", "retainMs"]) {
    if (Object.hasOwn(parsed, key))
      throw new Error(
        `${key} was moved to workspace/runtime-params.json; remove it from model-proxy.config.json`,
      );
  }
  const config = { ...DEFAULT_CONFIG, ...parsed };
  for (const key of [
    "proxyHost",
    "logDir",
    "logPrefix",
    "unknownModelName",
    "unknownFlowName",
    "unknownSessionId",
    "modelNameHeaderKey",
    "parentSessionIdHeaderKey",
  ]) {
    if (typeof config[key] !== "string" || !config[key].trim()) {
      throw new Error(`Invalid model-proxy config: ${key} must be a non-empty string`);
    }
  }
  config.proxies = normalizeProxyEntries(config.proxies);
  return config;
}

function normalizeProxyEntries(rawEntries) {
  if (!Array.isArray(rawEntries) || !rawEntries.length) {
    throw new Error("Invalid model-proxy config: proxies must be a non-empty array");
  }

  const usedPorts = new Set();
  const normalized = [];

  for (let index = 0; index < rawEntries.length; index += 1) {
    const item = rawEntries[index];
    if (!isPlainObject(item)) {
      throw new Error(`Invalid model-proxy config: proxies[${index}] must be an object`);
    }
    const rawTarget = text(item.targetUrl);
    const target = new URL(rawTarget);
    if (!["http:", "https:"].includes(target.protocol)) {
      throw new Error(`Invalid model-proxy config: proxies[${index}].targetUrl must use HTTP(S)`);
    }

    const localPort = item.localPort;
    if (!Number.isInteger(localPort) || localPort <= 0 || localPort > 65535) {
      throw new Error(`Invalid model-proxy config: proxies[${index}].localPort is invalid`);
    }

    if (usedPorts.has(localPort)) {
      throw new Error(`Invalid model-proxy config: duplicate localPort ${localPort}`);
    }

    usedPorts.add(localPort);
    normalized.push({
      targetUrl: rawTarget,
      localPort,
    });
  }

  return normalized;
}

function normalizeHeaderKeyCandidates(primaryKeys = [], fallbackKeys = []) {
  const keys = [
    ...(Array.isArray(primaryKeys) ? primaryKeys : [primaryKeys]),
    ...(Array.isArray(fallbackKeys) ? fallbackKeys : [fallbackKeys]),
  ]
    .map((key) => text(key).toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(keys));
}

export { DEFAULT_CONFIG, loadConfig, normalizeHeaderKeyCandidates };
