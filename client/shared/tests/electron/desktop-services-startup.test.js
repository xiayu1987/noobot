/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { RUNTIME_INSTANCE_PATH_ENV_KEYS } from "@noobot/runtime-topology-protocol/instance-paths";
import { clientFilePath as path } from "../../path-resolver.js";
import test from "node:test";
import { createFixture } from "./desktop-service-fixture.js";

function withPlatform(platform, fn) {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Object.defineProperty(process, "platform", original);
    });
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
      assert.equal("NOOBOT_SERVICE_HOST" in fixture.calls[0].options.env, false);
      assert.equal("NOOBOT_DESKTOP" in fixture.calls[0].options.env, false);
      assert.match(fixture.calls[0].options.env.NOOBOT_GLOBAL_CONFIG_PATH, /global\.config\.json$/);
      assert.equal(
        fixture.calls[0].options.env.NOOBOT_CONFIG_DIR,
        path.join(fixture.userDataPath, "config"),
      );
      assert.equal(
        fixture.calls[0].options.env.NOOBOT_DATA_DIR,
        path.join(fixture.userDataPath, "data"),
      );
      const backendEnv = fixture.calls[0].options.env;
      const userDataKeys = Object.keys(backendEnv).filter((key) =>
        String(backendEnv[key]).startsWith(fixture.userDataPath),
      );
      assert.ok(userDataKeys.length > 0);
      assert.deepEqual(
        userDataKeys.filter((key) => !RUNTIME_INSTANCE_PATH_ENV_KEYS.includes(key)),
        [],
      );
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
      assert.equal("NOOBOT_SERVICE_HOST" in fixture.calls[0].options.env, false);
      assert.equal("NOOBOT_DESKTOP" in fixture.calls[0].options.env, false);
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
      const startupContext = JSON.parse(await readFile(serviceCall.args[2], "utf8"));
      assert.equal(startupContext.app.platform, "desktop");
      assert.equal(startupContext.service.host, "127.0.0.1");
      assert.equal(startupContext.service.port, 10061);
      assert.equal("agentProxy" in startupContext, false);
      assert.equal("electron" in startupContext.runtime, false);
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
      assert.ok(serviceCall.options.env.NOOBOT_WORKSPACE_ROOT);
      assert.equal(
        agentProxyCall.options.env.NOOBOT_WORKSPACE_ROOT,
        serviceCall.options.env.NOOBOT_WORKSPACE_ROOT,
      );
    } finally {
      await fixture.restore();
    }
  });
});

for (const proxyAlreadyHealthy of [false, true]) {
  test(`healthy service still checks packaged proxy (already healthy: ${proxyAlreadyHealthy})`, async () => {
    let proxyChecks = 0;
    const fixture = await createFixture({
      packaged: true,
      managerOptions: {
        fetchImpl: async (url) => {
          const isProxy = String(url).includes(":10062");
          if (isProxy) proxyChecks += 1;
          return {
            ok: true,
            json: async () => ({
              ok: !isProxy || proxyAlreadyHealthy || fixture.calls.length > 0,
            }),
          };
        },
      },
    });
    try {
      await Promise.all([
        fixture.manager.ensureServiceStarted(),
        fixture.manager.ensureServiceStarted(),
      ]);
      assert.ok(proxyChecks > 0);
      assert.equal(fixture.calls.length, proxyAlreadyHealthy ? 0 : 1);
      if (!proxyAlreadyHealthy)
        assert.match(fixture.calls[0].args[0], /agent-proxy[/\\]agent-proxy\.js$/);
      assert.equal(fixture.statuses.at(-1).message, "Noobot agent proxy is ready.");
    } finally {
      fixture.manager.stopManagedService();
      await fixture.restore();
    }
  });
}

test("proxy timeout fails startup and retry waits for the existing process", async () => {
  let recovering = false;
  let recoveryChecks = 0;
  const fixture = await createFixture({
    packaged: true,
    managerOptions: {
      agentProxyStartupTimeoutMs: 100,
      fetchImpl: async (url) => {
        const isProxy = String(url).includes(":10062");
        if (isProxy && recovering) recoveryChecks += 1;
        return {
          ok: true,
          json: async () => ({ ok: !isProxy || (recovering && recoveryChecks >= 3) }),
        };
      },
    },
  });
  try {
    await assert.rejects(
      fixture.manager.ensureServiceStarted(),
      /agent proxy did not become healthy/,
    );
    assert.equal(fixture.calls.length, 1);
    assert.equal(
      fixture.statuses.some((status) => status.message === "Noobot agent proxy is ready."),
      false,
    );
    recovering = true;
    await fixture.manager.ensureServiceStarted();
    assert.ok(recoveryChecks >= 3);
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.statuses.at(-1).message, "Noobot agent proxy is ready.");
  } finally {
    fixture.manager.stopManagedService();
    await fixture.restore();
  }
});

for (const failure of ["request", "body"]) {
  test(`health probes release timers after ${failure} failure and bound body reads`, async (t) => {
    const schedule = globalThis.setTimeout;
    const cancel = globalThis.clearTimeout;
    const timers = new Set();
    const failedUrls = new Set();
    const abortedUrls = new Set();
    t.mock.method(globalThis, "setTimeout", (callback, ms, ...args) => {
      const isProbe = ms === TIME_THRESHOLDS.desktop.healthProbeTimeoutMs;
      const timer = schedule(callback, isProbe ? 1 : ms, ...args);
      if (isProbe) timers.add(timer);
      return timer;
    });
    t.mock.method(globalThis, "clearTimeout", (timer) => {
      timers.delete(timer);
      cancel(timer);
    });
    const fixture = await createFixture({
      packaged: true,
      managerOptions: {
        fetchImpl: async (url, { signal }) => {
          if (!failedUrls.has(url)) {
            failedUrls.add(url);
            if (failure === "request") throw new Error("connection refused");
            return {
              ok: true,
              json: () =>
                new Promise((resolve, reject) => {
                  signal.addEventListener("abort", () => {
                    abortedUrls.add(url);
                    reject(signal.reason);
                  });
                }),
            };
          }
          return { ok: true, json: async () => ({ ok: true }) };
        },
      },
    });
    try {
      await fixture.manager.ensureServiceStarted();
      assert.equal(failedUrls.size, 2);
      assert.equal(abortedUrls.size, failure === "body" ? 2 : 0);
      assert.equal(timers.size, 0);
      assert.equal(fixture.calls.length, 2);
      assert.equal(fixture.statuses.at(-1).message, "Noobot agent proxy is ready.");
    } finally {
      fixture.manager.stopManagedService();
      await fixture.restore();
    }
  });
}

for (const stopAtCheck of [1, 2]) {
  test(`stop during proxy health check ${stopAtCheck} cancels startup`, async () => {
    let proxyChecks = 0;
    const fixture = await createFixture({
      packaged: true,
      managerOptions: {
        fetchImpl: async (url) => {
          const isProxy = String(url).includes(":10062");
          if (isProxy && ++proxyChecks === stopAtCheck) fixture.manager.stopManagedService();
          return { ok: true, json: async () => ({ ok: !isProxy || stopAtCheck === 2 }) };
        },
      },
    });
    try {
      await assert.rejects(fixture.manager.ensureServiceStarted(), /startup stopped/);
      assert.equal(fixture.calls.length, 0);
      assert.equal(
        fixture.statuses.some((status) => status.message === "Noobot agent proxy is ready."),
        false,
      );
      await assert.rejects(fixture.manager.ensureServiceStarted(), /startup stopped/);
      assert.equal(fixture.calls.length, 0);
    } finally {
      fixture.manager.stopManagedService();
      await fixture.restore();
    }
  });
}

test("crash recovery clears the previous startup interruption", async () => {
  let recovering = false;
  let recoveries = 0;
  const fixture = await createFixture({
    packaged: true,
    managerOptions: {
      crashRestartDelaysMs: [0],
      fetchImpl: async (url) => {
        const isProxy = String(url).includes(":10062");
        const entry = isProxy ? /agent-proxy[/\\]agent-proxy\.js$/ : /service[/\\]app\.js$/;
        return {
          ok: true,
          json: async () => ({
            ok:
              (!isProxy || recovering) &&
              fixture.calls.some((call) => !call.child.exited && entry.test(call.args[0])),
          }),
        };
      },
    },
  });
  fixture.manager.setBackendRecoveredHandler(async () => {
    recoveries += 1;
  });
  try {
    const startup = assert.rejects(
      fixture.manager.ensureServiceStarted(),
      /service exited during startup/,
    );
    await waitFor(() => fixture.calls.length === 2);
    fixture.calls[0].child.emit("exit", 1, null);
    await startup;
    recovering = true;
    fixture.calls[1].child.emit("exit", 1, null);
    await waitFor(() => recoveries === 1);
    assert.equal(fixture.calls.length, 4);
    assert.match(fixture.calls[2].args[0], /service[/\\]app\.js$/);
    assert.match(fixture.calls[3].args[0], /agent-proxy[/\\]agent-proxy\.js$/);
    assert.equal(fixture.statuses.at(-1).message, "Noobot backend restarted after crash.");
  } finally {
    fixture.manager.stopManagedService();
    await fixture.restore();
  }
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

test("crash restart without a registered recovery handler still completes", async () => {
  await withPlatform("darwin", async () => {
    const fixture = await createFixture({
      packaged: false,
      managerOptions: { crashRestartDelaysMs: [0] },
    });
    try {
      await fixture.manager.ensureServiceStarted();
      fixture.calls[0].child.emit("exit", null, "SIGKILL");
      await waitFor(
        () => fixture.startupEvents.at(-1) === "status:ready" && fixture.calls.length === 2,
      );
      await settle();
      assert.equal(
        fixture.statuses.some((status) => String(status.message).includes("restart failed")),
        false,
      );
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
      },
    });
    fixture.manager.setBackendRecoveredHandler(async () => {
      recoveries += 1;
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
        agentProxyStartupTimeoutMs: 5000,
        fetchImpl: async () => ({ ok: true, json: async () => ({ ok: false }) }),
      },
    });
    fixture.manager.setBackendRecoveredHandler(async () => {
      recoveries += 1;
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

test("service startup reports upgrade progress until healthy and injects the launch id", async () => {
  await withPlatform("darwin", async () => {
    let healthy = false;
    const reads = [];
    const layout = { userIndex: 1, userCount: 1, stage: "layoutUpgrade", processedSessions: 3 };
    const progressSteps = [null, layout, layout, { ...layout, processedSessions: 9 }];
    const fixture = await createFixture({
      packaged: false,
      managerOptions: {
        fetchImpl: async () => ({ ok: true, json: async () => ({ ok: healthy }) }),
        readStartupState: async (launch) => {
          reads.push(launch);
          const progress = progressSteps[reads.length - 1];
          if (reads.length >= progressSteps.length) healthy = true;
          return progress ? { state: "pending", progress } : { state: "pending" };
        },
      },
    });
    try {
      await fixture.manager.ensureServiceStarted();
      const launchId = fixture.calls[0].options.env.NOOBOT_STARTUP_LAUNCH_ID;
      assert.match(launchId, /^[0-9a-f-]{36}$/);
      assert.equal(reads[0].launchId, launchId);
      assert.equal(
        reads[0].env.NOOBOT_WORKSPACE_ROOT,
        path.join(fixture.userDataPath, "workspace"),
      );
      const upgrading = fixture.statuses.filter((status) => status.phase === "upgrading");
      assert.deepEqual(
        upgrading.map((status) => status.progress.processedSessions),
        [3, 9],
      );
      assert.equal(fixture.startupEvents.at(-1), "status:ready");
    } finally {
      fixture.manager.stopManagedService();
      await fixture.restore();
    }
  });
});

test("service startup fails as soon as the startup protocol reports failure", async () => {
  await withPlatform("darwin", async () => {
    const fixture = await createFixture({
      packaged: false,
      managerOptions: {
        fetchImpl: async () => ({ ok: true, json: async () => ({ ok: false }) }),
        readStartupState: async () => ({ state: "failed", event: "service.startup.failed" }),
      },
    });
    try {
      await assert.rejects(
        fixture.manager.ensureServiceStarted(),
        /startup failed \(service\.startup\.failed\)/,
      );
    } finally {
      fixture.manager.stopManagedService();
      await fixture.restore();
    }
  });
});

test("service startup stays pending without startup events and has no wall-clock limit", async () => {
  await withPlatform("darwin", async () => {
    let healthChecks = 0;
    const fixture = await createFixture({
      packaged: false,
      managerOptions: {
        agentProxyStartupTimeoutMs: 1,
        fetchImpl: async () => {
          healthChecks += 1;
          await new Promise((resolve) => setTimeout(resolve, 2));
          return { ok: true, json: async () => ({ ok: healthChecks > 20 }) };
        },
      },
    });
    try {
      await fixture.manager.ensureServiceStarted();
      assert.ok(healthChecks > 20);
      assert.equal(fixture.startupEvents.at(-1), "status:ready");
    } finally {
      fixture.manager.stopManagedService();
      await fixture.restore();
    }
  });
});

test("service startup fails when the startup heartbeat stops", async () => {
  await withPlatform("darwin", async () => {
    const clock = Date.parse("2026-10-25T00:10:00.000Z");
    const fixture = await createFixture({
      packaged: false,
      managerOptions: {
        now: () => clock,
        fetchImpl: async () => ({ ok: true, json: async () => ({ ok: false }) }),
        readStartupState: async () => ({
          state: "pending",
          progress: { stage: "layoutUpgrade", processedSessions: 1 },
          progressAt: "2026-10-25T00:06:00.000Z",
          heartbeatAt: "2026-10-25T00:07:00.000Z",
        }),
      },
    });
    try {
      await assert.rejects(
        fixture.manager.ensureServiceStarted(),
        /stopped responding during startup \(no heartbeat for 180s\)/,
      );
    } finally {
      fixture.manager.stopManagedService();
      await fixture.restore();
    }
  });
});

test("stalled startup progress warns once per minute and keeps waiting", async () => {
  await withPlatform("darwin", async () => {
    const progressAt = Date.parse("2026-10-25T00:00:00.000Z");
    const progress = { stage: "layoutUpgrade", processedSessions: 4 };
    const offsetsMs = [60000, 330000, 345000, 365000, 400000];
    let reads = 0;
    let clock = progressAt;
    const fixture = await createFixture({
      packaged: false,
      managerOptions: {
        now: () => clock,
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ ok: reads >= offsetsMs.length }),
        }),
        readStartupState: async () => {
          clock = progressAt + offsetsMs[reads];
          reads += 1;
          return {
            state: "pending",
            progress,
            progressAt: new Date(progressAt).toISOString(),
            heartbeatAt: new Date(clock - 1000).toISOString(),
          };
        },
      },
    });
    try {
      await fixture.manager.ensureServiceStarted();
      const upgrading = fixture.statuses.filter((status) => status.phase === "upgrading");
      assert.deepEqual(
        upgrading.map((status) => status.stalledMinutes),
        [0, 5, 6],
      );
      assert.equal(fixture.startupEvents.at(-1), "status:ready");
    } finally {
      fixture.manager.stopManagedService();
      await fixture.restore();
    }
  });
});
