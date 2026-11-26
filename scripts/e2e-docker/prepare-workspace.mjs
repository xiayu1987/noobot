#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeKnownConfigKeys } from "@noobot/agent-config-protocol";
import { resolveConfiguredSuperUserId } from "noobot-agent/utils/super-user";
import {
  WORKSPACE_LAYOUT,
  WORKSPACE_ROOT_LAYOUT,
  WORKSPACE_USER_CONFIGURATION_ENTRIES,
  isWorkspacePathSegment,
} from "../../workspace-protocol/src/layout.js";
import { text } from "@noobot/shared/value";
import { mcpTestServers } from "../mcp-test-service/config.mjs";
import { MOCK_MODEL, mockProvider } from "../mock-model-service/scenario.mjs";
import { PERF_HARNESS_MODELS } from "../mock-model-service/performance-contract.mjs";
import { BUILTIN_TOOL_IDS } from "../../agent/src/tools/constants/index.js";

function configurePerformance(config) {
  if (process.env.NOOBOT_E2E_PERF !== "1") return;
  config.providers = {
    ...config.providers,
    [MOCK_MODEL.alias]: mockProvider(),
    [`${MOCK_MODEL.alias}_alternate`]: mockProvider(),
    ...Object.fromEntries(
      Object.values(PERF_HARNESS_MODELS).map((model) => [model, { ...mockProvider(), model }]),
    ),
  };
  config.services = {
    ...config.services,
    e2e_perf: {
      enabled: true,
      handler: "e2e-perf-handler",
      endpoints: { echo: { url: `http://${MOCK_MODEL.hostname}:${MOCK_MODEL.port}/health` } },
    },
  };
  config.tools = {
    ...config.tools,
    do_search_web: {
      enabled: true,
      mode: "search_engine",
      search_engine: {
        endpoints: {
          search: {
            url: `http://${MOCK_MODEL.hostname}:${MOCK_MODEL.port}/search`,
            query_string_format: "q=",
          },
        },
      },
    },
    bindings: Object.fromEntries(BUILTIN_TOOL_IDS.map((name) => [name, { bindingName: name }])),
  };
}

function requireAbsoluteDir(value, label) {
  const dir = text(value);
  if (!path.isAbsolute(dir)) throw new Error(`${label} must be an absolute path`);
  return dir;
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function copyEntry(sourceRoot, targetRoot, relativePath) {
  const source = path.join(sourceRoot, relativePath);
  if (!(await exists(source))) return false;
  await cp(source, path.join(targetRoot, relativePath), { recursive: true });
  return true;
}

function requireUserId(value) {
  const userId = text(value);
  if (!isWorkspacePathSegment(userId)) throw new Error(`invalid workspace userId: ${userId}`);
  return userId;
}

async function readWorkspaceUserIds(sourceRoot, globalConfigPath) {
  const usersFile = path.join(sourceRoot, WORKSPACE_ROOT_LAYOUT.USERS_FILE);
  const document = JSON.parse(await readFile(usersFile, "utf8"));
  const users = Array.isArray(document?.users) ? document.users : [];
  const globalConfig = normalizeKnownConfigKeys(
    JSON.parse(await readFile(globalConfigPath, "utf8")),
  );
  const superUserId = resolveConfiguredSuperUserId(globalConfig);
  const userIds = users.map((user) => requireUserId(user?.userId));
  if (superUserId) userIds.push(requireUserId(superUserId));
  return [...new Set(userIds)];
}

async function copyUserConfiguration(source, target, userId) {
  const copied = [];
  await mkdir(path.join(target, userId), { recursive: true });
  for (const entry of WORKSPACE_USER_CONFIGURATION_ENTRIES) {
    const relative = path.posix.join(userId, entry);
    if (await copyEntry(source, target, relative)) copied.push(relative);
  }
  return copied;
}

async function prepareE2eWorkspace({ sourceRoot, targetRoot, globalConfigPath }) {
  const source = requireAbsoluteDir(sourceRoot, "source workspace");
  const target = requireAbsoluteDir(targetRoot, "e2e workspace");
  const configPath = requireAbsoluteDir(globalConfigPath, "global config path");
  if (source === target) throw new Error("e2e workspace must differ from the source workspace");
  const userIds = await readWorkspaceUserIds(source, configPath);
  await mkdir(target, { recursive: true });
  const globalConfig = JSON.parse(await readFile(configPath, "utf8"));
  globalConfig.mcp_servers = mcpTestServers();
  configurePerformance(globalConfig);
  await writeFile(path.join(target, "global.config.json"), JSON.stringify(globalConfig, null, 2), {
    mode: 0o600,
  });
  const copied = [];
  for (const file of Object.values(WORKSPACE_ROOT_LAYOUT)) {
    if (await copyEntry(source, target, file)) copied.push(file);
  }
  for (const userId of userIds) {
    copied.push(...(await copyUserConfiguration(source, target, userId)));
    const userConfigRelative = path.posix.join(userId, WORKSPACE_LAYOUT.CONFIG_FILE);
    if (!copied.includes(userConfigRelative)) {
      throw new Error(`e2e workspace user ${userId} requires ${userConfigRelative} in source`);
    }
    const userConfigPath = path.join(target, userConfigRelative);
    const userConfig = JSON.parse(await readFile(userConfigPath, "utf8"));
    userConfig.mcp_servers = mcpTestServers();
    configurePerformance(userConfig);
    await writeFile(userConfigPath, JSON.stringify(userConfig, null, 2), { mode: 0o600 });
    if (process.env.NOOBOT_E2E_PERF === "1") {
      const inputPath = path.join(target, userId, "runtime/ops_workdir");
      await mkdir(inputPath, { recursive: true });
      await writeFile(
        path.join(inputPath, "perf-input.png"),
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=",
          "base64",
        ),
      );
      const servicesPath = path.join(target, userId, "services");
      await mkdir(servicesPath, { recursive: true });
      await cp(
        new URL("../mock-model-service/service-handler.mjs", import.meta.url),
        path.join(servicesPath, "e2e-perf-handler.js"),
      );
    }
  }
  return { userIds, copied };
}

const [sourceRoot, targetRoot, globalConfigPath] = process.argv.slice(2);
const result = await prepareE2eWorkspace({ sourceRoot, targetRoot, globalConfigPath });
console.log(
  `[e2e-docker] workspace prepared: users=${result.userIds.join(",")} entries=${result.copied.length}`,
);
