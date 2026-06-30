/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDesktopBootstrap } from "../../electron/desktop-bootstrap.js";
import { createDesktopServiceManager } from "../../electron/desktop-services.js";

function withPlatform(platform, fn) {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Object.defineProperty(process, "platform", original);
    });
}

function createMockChildProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  return child;
}

async function createPackagedBackendFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noobot-desktop-bootstrap-flow-"));
  const resourcesPath = path.join(rootDir, "resources");
  const packagedBackendRoot = path.join(resourcesPath, "backend");
  const userDataPath = path.join(rootDir, "user-data");
  await mkdir(path.join(packagedBackendRoot, "agent-proxy"), { recursive: true });
  await mkdir(path.join(packagedBackendRoot, "model-proxy"), { recursive: true });
  await mkdir(path.join(resourcesPath, "frontend"), { recursive: true });
  await writeFile(path.join(packagedBackendRoot, "agent-proxy", "agent-proxy.config.example.json"), "{}");
  await writeFile(path.join(packagedBackendRoot, "model-proxy", "model-proxy.config.example.json"), "{}");
  await writeFile(path.join(resourcesPath, "frontend", "index.html"), "<html></html>");
  return { rootDir, resourcesPath, packagedBackendRoot, userDataPath };
}

test("desktop boot flow reaches system after startup setup, config params, service and proxy readiness", async () => {
  await withPlatform("darwin", async () => {
    const fixture = await createPackagedBackendFixture();
    const originalResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");
    Object.defineProperty(process, "resourcesPath", { value: fixture.resourcesPath, configurable: true });

    let configStep = 0;
    let desktopConfigState = null;
    let pendingSuperAdminResolve = null;
    let pendingConfigResolve = null;
    let serviceSpawned = false;
    let proxySpawned = false;
    let windowCreated = false;
    const statuses = [];
    const spawnCalls = [];
    const loadedUrls = [];
    const earlyLogs = [];

    const makeConfigState = () => {
      const base = {
        globalConfigPath: path.join(fixture.userDataPath, "config", "global.config.json"),
        workspaceRootPath: path.join(fixture.userDataPath, "workspace"),
        workspaceTemplatePath: path.join(fixture.userDataPath, "template"),
        templateConfigPath: path.join(fixture.userDataPath, "template", "config.json"),
        configParamsPath: path.join(fixture.userDataPath, "workspace", "config-params.json"),
      };
      if (configStep === 0) {
        return {
          ...base,
          superAdmin: {
            missing: true,
            userId: "",
            connectCode: "",
            language: "zh-CN",
            model: "openai",
            modelOptions: [{ key: "openai", model: "gpt" }],
            dependencyProxyUrl: "",
          },
          missingParams: [],
        };
      }
      if (configStep === 1) {
        return {
          ...base,
          superAdmin: { missing: false, userId: "owner", connectCode: "secret" },
          missingParams: [{ key: "OPENAI_API_KEY", description: "API key" }],
        };
      }
      return {
        ...base,
        superAdmin: { missing: false, userId: "owner", connectCode: "secret" },
        missingParams: [],
      };
    };

    const sendStatus = (status) => {
      statuses.push(status);
      if (status.phase === "super-admin-required") {
        queueMicrotask(() => {
          configStep = 1;
          pendingSuperAdminResolve?.();
        });
      }
      if (status.phase === "config-optional") {
        queueMicrotask(() => {
          configStep = 2;
          pendingConfigResolve?.();
        });
      }
    };

    try {
      const requestSuperAdminConfig = (superAdmin) => {
        sendStatus({
          phase: "super-admin-required",
          message: "Please set the super admin username and connect code before starting Noobot.",
          superAdmin,
        });
        return new Promise((resolve) => {
          pendingSuperAdminResolve = resolve;
        });
      };
      const requestMissingConfigParams = (missingParams) => {
        sendStatus({
          phase: "config-optional",
          message: "Optional configuration variables can be filled now or skipped.",
          params: missingParams,
        });
        return new Promise((resolve) => {
          pendingConfigResolve = resolve;
        });
      };

      const serviceManager = createDesktopServiceManager({
        app: {
          isPackaged: true,
          getPath: (name) => {
            assert.equal(name, "userData");
            return fixture.userDataPath;
          },
        },
        repoRoot: path.join(fixture.rootDir, "repo"),
        packagedBackendRoot: fixture.packagedBackendRoot,
        servicePort: 10061,
        agentProxyPort: 10062,
        serviceOrigin: "http://127.0.0.1:10061",
        healthUrl: "http://127.0.0.1:10061/health",
        agentProxyHealthUrl: "http://127.0.0.1:10062/health",
        startupTimeoutMs: 200,
        pollIntervalMs: 1,
        sendStatus,
        getLogFilePath: (fileName = "desktop-startup.log") => path.join(fixture.userDataPath, "logs", fileName),
        ensureDesktopGlobalConfig: () => makeConfigState(),
        getDesktopConfigState: () => desktopConfigState,
        setDesktopConfigState: (state) => {
          desktopConfigState = state;
        },
        requestSuperAdminConfig,
        requestMissingConfigParams,
        fetchImpl: async (url) => ({
          ok: true,
          json: async () => {
            const target = String(url || "");
            if (target.includes(":10061")) return { ok: serviceSpawned };
            if (target.includes(":10062")) return { ok: proxySpawned };
            return { ok: false };
          },
        }),
        sleep: async () => {},
        spawnProcess: (command, args, options) => {
          spawnCalls.push({ command, args, options });
          if (args.join(" ").includes("service/app.js")) serviceSpawned = true;
          if (args.join(" ").includes("agent-proxy.js")) proxySpawned = true;
          return createMockChildProcess();
        },
      });

      const bootstrap = createDesktopBootstrap({
        createWindow: () => {
          windowCreated = true;
          return {};
        },
        ensureServiceStarted: serviceManager.ensureServiceStarted,
        resolveNoobotUrl: async () => "http://127.0.0.1:10062",
        getMainWindow: () => ({
          loadURL: async (url) => {
            loadedUrls.push(url);
          },
        }),
        sendStatus,
        appendEarlyLog: (line) => earlyLogs.push(line),
        healthUrl: "http://127.0.0.1:10061/health",
        defaultClientUrl: "http://127.0.0.1:10060",
      });

      await bootstrap.boot();

      assert.equal(windowCreated, true);
      assert.equal(bootstrap.hasBootStarted(), true);
      assert.deepEqual(loadedUrls, ["http://127.0.0.1:10062"]);
      assert.deepEqual(
        statuses.map((status) => status.phase),
        [
          "checking",
          "super-admin-required",
          "config-optional",
          "starting",
          "dependency",
          "starting",
          "ready",
          "starting",
          "config",
          "config",
          "starting",
          "ready",
          "loading",
        ],
      );
      assert.equal(spawnCalls.length, 2);
      assert.match(spawnCalls[0].args[0], /service[/\\]app\.js$/);
      assert.match(spawnCalls[1].args[0], /agent-proxy[/\\]agent-proxy\.js$/);
      assert.equal(spawnCalls[0].options.env.ELECTRON_RUN_AS_NODE, "1");
      assert.equal(spawnCalls[1].options.env.ELECTRON_RUN_AS_NODE, "1");
      assert.ok(earlyLogs.some((line) => line.includes("before createWindow")));

      await bootstrap.boot();
      assert.equal(spawnCalls.length, 2);
      assert.deepEqual(loadedUrls, ["http://127.0.0.1:10062"]);
    } finally {
      if (originalResourcesPath) {
        Object.defineProperty(process, "resourcesPath", originalResourcesPath);
      } else {
        delete process.resourcesPath;
      }
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  });
});

test("desktop boot flow reports error and keeps startup page when service startup fails", async () => {
  const statuses = [];
  const loadedUrls = [];
  const bootstrap = createDesktopBootstrap({
    createWindow: () => ({}),
    ensureServiceStarted: async () => {
      throw new Error("service boom");
    },
    resolveNoobotUrl: async () => "http://127.0.0.1:10062",
    getMainWindow: () => ({
      loadURL: async (url) => loadedUrls.push(url),
    }),
    sendStatus: (status) => statuses.push(status),
    healthUrl: "http://127.0.0.1:10061/health",
    defaultClientUrl: "http://127.0.0.1:10060",
  });

  await bootstrap.boot();

  assert.deepEqual(loadedUrls, []);
  assert.deepEqual(statuses, [
    {
      phase: "error",
      message: "service boom",
      healthUrl: "http://127.0.0.1:10061/health",
      clientUrl: "http://127.0.0.1:10060",
    },
  ]);
});
