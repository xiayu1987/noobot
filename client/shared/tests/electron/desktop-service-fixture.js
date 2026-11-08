/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { clientFilePath as path } from "../../path-resolver.js";
import { createDesktopServiceManager } from "../../electron/runtime/services.js";

let nextMockPid = 3000;

function createMockChildProcess() {
  const child = new EventEmitter();
  child.pid = nextMockPid;
  nextMockPid += 1;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killCalls = [];
  child.kill = (signal) => {
    child.killCalls.push(signal);
  };
  child.exited = false;
  child.once("exit", () => {
    child.exited = true;
  });
  return child;
}

export async function createFixture({
  packaged = false,
  dependencyProxyUrl = "",
  managerOptions = {},
} = {}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noobot-desktop-services-startup-"));
  const repoRoot = path.join(rootDir, "repo");
  const userDataPath = path.join(rootDir, "user-data");
  const resourcesPath = path.join(rootDir, "resources");
  const packagedBackendRoot = path.join(resourcesPath, "backend");
  await mkdir(repoRoot, { recursive: true });
  await mkdir(userDataPath, { recursive: true });
  await mkdir(path.join(packagedBackendRoot, "agent-proxy"), { recursive: true });
  await mkdir(path.join(packagedBackendRoot, "model-proxy"), { recursive: true });
  await writeFile(
    path.join(packagedBackendRoot, "agent-proxy", "agent-proxy.config.example.json"),
    "{}",
  );
  await writeFile(
    path.join(packagedBackendRoot, "model-proxy", "model-proxy.config.example.json"),
    "{}",
  );

  const configState = {
    configDir: path.join(userDataPath, "config"),
    globalConfigPath: path.join(userDataPath, "config", "global.config.json"),
    workspaceRootPath: path.join(userDataPath, "workspace"),
    workspaceTemplatePath: path.join(userDataPath, "template"),
    missingParams: [],
    superAdmin: { dependencyProxyUrl },
  };
  let desktopConfigState = null;
  const calls = [];
  const startupEvents = [];
  const statuses = [];
  const terminateCalls = [];
  let healthCalls = 0;
  const originalResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");
  Object.defineProperty(process, "resourcesPath", { value: resourcesPath, configurable: true });
  const hasLiveChild = (pattern) =>
    calls.some(
      (call) =>
        !call.child.exited &&
        (!pattern || call.args.join(" ").replaceAll("\\", "/").includes(pattern)),
    );
  const manager = createDesktopServiceManager({
    app: {
      isPackaged: packaged,
      getPath: (name) => {
        assert.equal(name, "userData");
        return userDataPath;
      },
    },
    repoRoot,
    packagedBackendRoot,
    servicePort: 10061,
    agentProxyPort: 10062,
    serviceOrigin: "http://127.0.0.1:10061",
    healthUrl: "http://127.0.0.1:10061/health",
    agentProxyHealthUrl: "http://127.0.0.1:10062/health",
    agentProxyStartupTimeoutMs: 200,
    pollIntervalMs: 1,
    getLogFilePath: (fileName = "desktop-startup.log") => path.join(userDataPath, "logs", fileName),
    ensureDesktopGlobalConfig: () => {
      startupEvents.push("config-loaded");
      return configState;
    },
    sendStatus: (status) => {
      statuses.push(status);
      startupEvents.push(`status:${status.phase}`);
    },
    getDesktopConfigState: () => desktopConfigState,
    setDesktopConfigState: (state) => {
      desktopConfigState = state;
    },
    requestSuperAdminConfig: async () => {},
    requestMissingConfigParams: async () => {},
    fetchImpl: async (url) => {
      healthCalls += 1;
      const target = String(url || "");
      if (packaged) {
        if (target.includes(":10061")) {
          return {
            ok: true,
            json: async () => ({
              ok: hasLiveChild("service/app.js"),
            }),
          };
        }
        if (target.includes(":10062")) {
          return {
            ok: true,
            json: async () => ({
              ok: hasLiveChild("agent-proxy.js"),
            }),
          };
        }
      }
      return { ok: true, json: async () => ({ ok: hasLiveChild() }) };
    },
    spawnProcess: (command, args, options) => {
      const child = createMockChildProcess();
      calls.push({ command, args, options, child });
      return child;
    },
    terminateProcess: (child, signal, options) => {
      terminateCalls.push({ child, signal, options });
    },
    ...managerOptions,
  });

  return {
    rootDir,
    repoRoot,
    userDataPath,
    packagedBackendRoot,
    calls,
    terminateCalls,
    getHealthCalls: () => healthCalls,
    startupEvents,
    statuses,
    manager,
    restore: async () => {
      if (originalResourcesPath) {
        Object.defineProperty(process, "resourcesPath", originalResourcesPath);
      } else {
        delete process.resourcesPath;
      }
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}
