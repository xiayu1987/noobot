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
import { createDesktopServiceManager } from "../../electron/runtime/services.js";

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
  child.exited = false;
  child.once("exit", () => {
    child.exited = true;
  });
  return child;
}

async function createFixture({
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
    startupTimeoutMs: 200,
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
      assert.equal(fixture.calls[0].options.env.NOOBOT_SERVICE_HOST, "127.0.0.1");
      assert.equal(fixture.calls[0].options.env.NOOBOT_DESKTOP, "1");
      assert.match(fixture.calls[0].options.env.NOOBOT_GLOBAL_CONFIG_PATH, /global\.config\.json$/);
      assert.ok(fixture.getHealthCalls() >= 2);
      assert.deepEqual(fixture.startupEvents.slice(0, 2), ["config-loaded", "status:checking"]);
    } finally {
      await fixture.restore();
    }
  });
});

test("desktop startup passes configured dependency proxy to the service runtime", async () => {
  await withPlatform("win32", async () => {
    const fixture = await createFixture({
      packaged: false,
      dependencyProxyUrl: "http://user:secret@127.0.0.1:7890",
    });
    try {
      await fixture.manager.ensureServiceStarted();

      assert.equal(fixture.calls[0].options.env.HTTPS_PROXY, "http://user:secret@127.0.0.1:7890/");
      assert.equal(
        fixture.calls[0].options.env.HTTP_PROXY,
        fixture.calls[0].options.env.HTTPS_PROXY,
      );
    } finally {
      await fixture.restore();
    }
  });
});

test("desktop stop delegates process tree cleanup to the platform boundary", async () => {
  await withPlatform("win32", async () => {
    const fixture = await createFixture({ packaged: false });
    try {
      await fixture.manager.ensureServiceStarted();
      fixture.manager.stopManagedService();

      assert.deepEqual(fixture.terminateCalls, [
        {
          child: fixture.calls[0].child,
          signal: "SIGTERM",
          options: { processGroup: false },
        },
      ]);
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
      assert.equal(fixture.calls[0].options.env.NOOBOT_SERVICE_HOST, "127.0.0.1");
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
      assert.equal(
        agentProxyCall.options.env.AGENT_PROXY_UPSTREAM_HTTP_BASE,
        "http://127.0.0.1:10061",
      );
      assert.equal(
        agentProxyCall.options.env.AGENT_PROXY_UPSTREAM_WS_URL,
        "ws://127.0.0.1:10061/chat/ws",
      );
    } finally {
      await fixture.restore();
    }
  });
});

async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

test("crashed service and agent proxy are restarted once when they exit together", async () => {
  await withPlatform("darwin", async () => {
    const fixture = await createFixture({
      packaged: true,
      managerOptions: { crashRestartDelaysMs: [0, 0] },
    });
    try {
      await fixture.manager.ensureServiceStarted();
      const [serviceCall, agentProxyCall] = fixture.calls;
      serviceCall.child.emit("exit", 4294930435, null);
      agentProxyCall.child.emit("exit", 4294930435, null);

      await waitFor(() => fixture.calls.length === 4);
      await settle();
      assert.equal(fixture.calls.length, 4);
      assert.match(fixture.calls[2].args[0], /service[/\\]app\.js$/);
      assert.match(fixture.calls[3].args[0], /agent-proxy[/\\]agent-proxy\.js$/);
      assert.equal(fixture.startupEvents.at(-1), "status:ready");

      fixture.calls[2].child.emit("exit", 1, null);
      fixture.calls[3].child.emit("exit", 1, null);
      await waitFor(() => fixture.calls.length === 6);
      await settle();
      assert.equal(fixture.calls.length, 6);
    } finally {
      fixture.manager.stopManagedService();
      await fixture.restore();
    }
  });
});

test("intentional stop does not trigger crash restart", async () => {
  await withPlatform("darwin", async () => {
    const fixture = await createFixture({
      packaged: false,
      managerOptions: { crashRestartDelaysMs: [0, 0, 0] },
    });
    try {
      await fixture.manager.ensureServiceStarted();
      fixture.manager.stopManagedService();
      fixture.calls[0].child.emit("exit", 1, null);
      await settle();
      assert.equal(fixture.calls.length, 1);
    } finally {
      await fixture.restore();
    }
  });
});

test("crash restart stops after the restart budget is exhausted", async () => {
  await withPlatform("darwin", async () => {
    const fixture = await createFixture({
      packaged: false,
      managerOptions: { crashRestartDelaysMs: [0] },
    });
    try {
      await fixture.manager.ensureServiceStarted();
      fixture.calls[0].child.emit("exit", 1, null);
      await waitFor(() => fixture.calls.length === 2);
      await settle();
      fixture.calls[1].child.emit("exit", 1, null);
      await settle();
      assert.equal(fixture.calls.length, 2);
      assert.equal(fixture.startupEvents.at(-1), "status:error");
      assert.equal(fixture.statuses.at(-1).retryable, true);
    } finally {
      fixture.manager.stopManagedService();
      await fixture.restore();
    }
  });
});

test("signal-terminated service is reported and restarted, then recovery is notified", async () => {
  await withPlatform("darwin", async () => {
    let recoveries = 0;
    const fixture = await createFixture({
      packaged: false,
      managerOptions: {
        crashRestartDelaysMs: [0],
        onBackendRecovered: async () => {
          recoveries += 1;
        },
      },
    });
    try {
      await fixture.manager.ensureServiceStarted();
      fixture.calls[0].child.emit("exit", null, "SIGKILL");
      await waitFor(() => recoveries === 1);
      assert.equal(fixture.calls.length, 2);
      const exitStatus = fixture.statuses.find((status) =>
        String(status.message).includes("exited unexpectedly"),
      );
      assert.equal(exitStatus.phase, "error");
      assert.match(exitStatus.message, /signal=SIGKILL/);
      assert.equal(fixture.startupEvents.at(-1), "status:ready");

      fixture.calls[1].child.emit("exit", 0, null);
      await settle();
      assert.equal(fixture.calls.length, 2);
      assert.equal(recoveries, 1);
    } finally {
      fixture.manager.stopManagedService();
      await fixture.restore();
    }
  });
});

test("child exit during startup fails startup with the exit reason instead of auto restarting", async () => {
  await withPlatform("darwin", async () => {
    let recoveries = 0;
    const fixture = await createFixture({
      packaged: false,
      managerOptions: {
        crashRestartDelaysMs: [0, 0],
        startupTimeoutMs: 5000,
        fetchImpl: async () => ({ ok: true, json: async () => ({ ok: false }) }),
        onBackendRecovered: async () => {
          recoveries += 1;
        },
      },
    });
    try {
      const startup = fixture.manager.ensureServiceStarted();
      await waitFor(() => fixture.calls.length === 1);
      fixture.calls[0].child.emit("exit", 1, null);
      await assert.rejects(startup, /service exited during startup \(code=1, signal=\)/);
      await settle();
      assert.equal(fixture.calls.length, 1);
      assert.equal(recoveries, 0);
      assert.equal(
        fixture.statuses.some((status) => String(status.message).startsWith("Restarting")),
        false,
      );
    } finally {
      fixture.manager.stopManagedService();
      await fixture.restore();
    }
  });
});

test("crash restart yielded to an in-flight startup does not consume restart budget", async () => {
  await withPlatform("darwin", async () => {
    let inspections = 0;
    let releaseStartup = () => {};
    const startupGate = new Promise((resolve) => {
      releaseStartup = resolve;
    });
    const fixture = await createFixture({
      packaged: false,
      managerOptions: {
        crashRestartDelaysMs: [10],
        inspectDependencies: async () => {
          inspections += 1;
          if (inspections === 2) await startupGate;
          return [];
        },
      },
    });
    try {
      await fixture.manager.ensureServiceStarted();
      fixture.calls[0].child.emit("exit", 1, null);
      const startup = fixture.manager.ensureServiceStarted();
      await settle();
      assert.equal(fixture.calls.length, 1);
      releaseStartup();
      await startup;
      assert.equal(fixture.calls.length, 2);

      fixture.calls[1].child.emit("exit", 1, null);
      await waitFor(() => fixture.calls.length === 3);
      await settle();
      assert.equal(fixture.startupEvents.at(-1), "status:ready");
    } finally {
      fixture.manager.stopManagedService();
      await fixture.restore();
    }
  });
});
