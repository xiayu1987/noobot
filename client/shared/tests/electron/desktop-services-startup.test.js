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
import test from "node:test";
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
  return child;
}

async function createFixture({ packaged = false } = {}) {
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
    globalConfigPath: path.join(userDataPath, "config", "global.config.json"),
    workspaceRootPath: path.join(userDataPath, "workspace"),
    workspaceTemplatePath: path.join(userDataPath, "template"),
    missingParams: [],
    superAdmin: {},
  };
  let desktopConfigState = null;
  const calls = [];
  const execFileCalls = [];
  let healthCalls = 0;
  const originalResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");
  Object.defineProperty(process, "resourcesPath", { value: resourcesPath, configurable: true });
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
    startupTimeoutMs: 200,
    pollIntervalMs: 1,
    getLogFilePath: (fileName = "desktop-startup.log") => path.join(userDataPath, "logs", fileName),
    ensureDesktopGlobalConfig: () => configState,
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
          return { ok: true, json: async () => ({ ok: calls.some((call) => call.args.join(" ").includes("service/app.js")) }) };
        }
        if (target.includes(":10062")) {
          return { ok: true, json: async () => ({ ok: calls.some((call) => call.args.join(" ").includes("agent-proxy.js")) }) };
        }
      }
      return { ok: true, json: async () => ({ ok: calls.length > 0 }) };
    },
    spawnProcess: (command, args, options) => {
      const child = createMockChildProcess();
      calls.push({ command, args, options, child });
      return child;
    },
    execFileProcess: (command, args, options, callback) => {
      execFileCalls.push({ command, args, options });
      callback?.(null, "", "");
    },
  });

  return {
    rootDir,
    repoRoot,
    userDataPath,
    packagedBackendRoot,
    calls,
    execFileCalls,
    getHealthCalls: () => healthCalls,
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

test("desktop startup uses npm.cmd for Windows development service launch", async () => {
  await withPlatform("win32", async () => {
    const fixture = await createFixture({ packaged: false });
    try {
      await fixture.manager.ensureServiceStarted();

      assert.equal(fixture.calls.length, 1);
      assert.equal(fixture.calls[0].command, "npm.cmd");
      assert.deepEqual(fixture.calls[0].args.slice(0, 4), ["run", "-w", "service", "start"]);
      assert.equal(fixture.calls[0].options.cwd, fixture.repoRoot);
      assert.equal(fixture.calls[0].options.env.PORT, "10061");
      assert.equal(fixture.calls[0].options.env.NOOBOT_DESKTOP, "1");
      assert.match(fixture.calls[0].options.env.NOOBOT_GLOBAL_CONFIG_PATH, /global\.config\.json$/);
      assert.ok(fixture.getHealthCalls() >= 2);
    } finally {
      await fixture.restore();
    }
  });
});

test("desktop stop uses taskkill process tree cleanup on Windows", async () => {
  await withPlatform("win32", async () => {
    const fixture = await createFixture({ packaged: false });
    try {
      await fixture.manager.ensureServiceStarted();
      fixture.manager.stopManagedService();

      assert.equal(fixture.execFileCalls.length, 1);
      assert.deepEqual(fixture.execFileCalls[0], {
        command: "taskkill",
        args: ["/PID", String(fixture.calls[0].child.pid), "/T", "/F"],
        options: { windowsHide: true },
      });
      assert.deepEqual(fixture.calls[0].child.killCalls, []);
    } finally {
      await fixture.restore();
    }
  });
});

test("desktop startup uses npm for macOS development service launch", async () => {
  await withPlatform("darwin", async () => {
    const fixture = await createFixture({ packaged: false });
    try {
      await fixture.manager.ensureServiceStarted();

      assert.equal(fixture.calls.length, 1);
      assert.equal(fixture.calls[0].command, "npm");
      assert.deepEqual(fixture.calls[0].args.slice(0, 4), ["run", "-w", "service", "start"]);
      assert.equal(fixture.calls[0].options.cwd, fixture.repoRoot);
      assert.equal(fixture.calls[0].options.env.PORT, "10061");
      assert.equal(fixture.calls[0].options.env.NOOBOT_DESKTOP, "1");
    } finally {
      await fixture.restore();
    }
  });
});

test("packaged desktop startup uses Electron node runtime for service and agent proxy", async () => {
  await withPlatform("darwin", async () => {
    const fixture = await createFixture({ packaged: true });
    try {
      await fixture.manager.ensureServiceStarted();

      assert.equal(fixture.calls.length, 2);
      const [serviceCall, agentProxyCall] = fixture.calls;
      assert.equal(serviceCall.command, process.execPath);
      assert.match(serviceCall.args[0], /service[/\\]app\.js$/);
      assert.equal(serviceCall.args[1], "--startup-context");
      assert.match(serviceCall.args[2], /startup-context\.json$/);
      assert.equal(serviceCall.options.cwd, fixture.packagedBackendRoot);
      assert.equal(serviceCall.options.env.ELECTRON_RUN_AS_NODE, "1");

      assert.equal(agentProxyCall.command, process.execPath);
      assert.match(agentProxyCall.args[0], /agent-proxy[/\\]agent-proxy\.js$/);
      assert.equal(agentProxyCall.options.cwd, fixture.packagedBackendRoot);
      assert.equal(agentProxyCall.options.env.ELECTRON_RUN_AS_NODE, "1");
      assert.equal(agentProxyCall.options.env.AGENT_PROXY_UPSTREAM_HTTP_BASE, "http://127.0.0.1:10061");
      assert.equal(agentProxyCall.options.env.AGENT_PROXY_UPSTREAM_WS_URL, "ws://127.0.0.1:10061/chat/ws");
    } finally {
      await fixture.restore();
    }
  });
});
