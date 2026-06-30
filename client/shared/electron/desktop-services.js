/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildDependencyRuntimeEnv,
  summarizeDependencyRuntimeEnv,
} from "./dependency-runtime-env.js";

export function createDesktopServiceManager({
  app,
  repoRoot,
  packagedBackendRoot,
  servicePort,
  agentProxyPort,
  serviceOrigin,
  healthUrl,
  agentProxyHealthUrl,
  startupTimeoutMs,
  pollIntervalMs,
  sendStatus = () => {},
  getLogFilePath = () => "",
  ensureDesktopGlobalConfig,
  getDesktopConfigState = () => null,
  setDesktopConfigState = () => {},
  requestSuperAdminConfig,
  requestMissingConfigParams,
} = {}) {
  let managedServiceProcess = null;
  let managedAgentProxyProcess = null;
  let serviceStartupPromise = null;

  function syncPackagedProxyConfig(proxyName) {
    if (!app.isPackaged) return;
    const examplePath = path.join(packagedBackendRoot, proxyName, `${proxyName}.config.example.json`);
    const configPath = path.join(packagedBackendRoot, proxyName, `${proxyName}.config.json`);
    if (fs.existsSync(configPath)) return;
    if (!fs.existsSync(examplePath)) {
      sendStatus({ phase: "warning", message: `Skipped ${proxyName} config sync; example config not found: ${examplePath}` });
      return;
    }
    fs.copyFileSync(examplePath, configPath);
    sendStatus({ phase: "config", message: `Synced ${proxyName} config from example: ${examplePath} -> ${configPath}` });
  }

  function syncPackagedProxyConfigs() {
    syncPackagedProxyConfig("agent-proxy");
    syncPackagedProxyConfig("model-proxy");
  }

  function writeStartupContext({ isPackaged, userDataPath, cwd, configDir, configState, globalConfigPath } = {}) {
    const runtimeDir = path.join(userDataPath, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const backendRoot = isPackaged ? packagedBackendRoot : repoRoot;
    const frontendRoot = isPackaged ? path.join(process.resourcesPath, "frontend") : "";
    const startupContextPath = path.join(runtimeDir, "startup-context.json");
    const dependencyEnv = buildDependencyRuntimeEnv({ app });
    const dependencySummary = summarizeDependencyRuntimeEnv(dependencyEnv);
    sendStatus({
      phase: "dependency",
      message: `Resolved startup dependency environment: ${JSON.stringify(dependencySummary)}`,
    });
    const startupContext = {
      schemaVersion: 1,
      app: {
        name: "Noobot",
        platform: "desktop",
        channel: process.platform,
        packaged: Boolean(isPackaged),
      },
      paths: {
        backendRoot,
        frontendRoot,
        pluginRootDir: path.join(backendRoot, "plugin"),
        userDataDir: userDataPath,
        configDir,
        dataDir: process.env.NOOBOT_DATA_DIR || path.join(userDataPath, "data"),
        logDir: process.env.NOOBOT_LOG_DIR || path.join(userDataPath, "logs"),
        workspaceRoot: configState?.workspaceRootPath || "",
        workspaceTemplatePath: configState?.workspaceTemplatePath || "",
        globalConfigPath,
      },
      service: {
        port: Number(servicePort),
        origin: serviceOrigin,
      },
      agentProxy: {
        port: Number(agentProxyPort),
        origin: `http://127.0.0.1:${agentProxyPort}`,
      },
      runtime: {
        node: process.version,
        electron: process.versions?.electron || "",
        cwd,
        execPath: process.execPath,
        resourcesPath: process.resourcesPath || "",
        env: dependencyEnv,
        dependencies: dependencySummary,
      },
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(startupContextPath, `${JSON.stringify(startupContext, null, 2)}\n`, "utf8");
    return { startupContextPath, dependencyEnv, dependencySummary };
  }


  async function isServiceHealthy() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const response = await fetch(healthUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) return false;
      const data = await response.json().catch(() => ({}));
      return data?.ok === true;
    } catch {
      return false;
    }
  }

  async function isAgentProxyHealthy() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const response = await fetch(agentProxyHealthUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) return false;
      const data = await response.json().catch(() => ({}));
      return data?.ok === true;
    } catch {
      return false;
    }
  }

  function startNoobotService() {
    if (managedServiceProcess) return;
    const isPackaged = app.isPackaged;
    const command = isPackaged ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
    const cwd = isPackaged ? packagedBackendRoot : repoRoot;
    const userDataPath = app.getPath("userData");
    const configDir = process.env.NOOBOT_CONFIG_DIR || path.join(userDataPath, "config");
    const configState = getDesktopConfigState() || ensureDesktopGlobalConfig({ isPackaged, userDataPath });
    setDesktopConfigState(configState);
    const globalConfigPath = configState.globalConfigPath;
    const { startupContextPath, dependencyEnv, dependencySummary } = writeStartupContext({
      isPackaged,
      userDataPath,
      cwd,
      configDir,
      configState,
      globalConfigPath,
    });
    const args = isPackaged
      ? [path.join(packagedBackendRoot, "service", "app.js"), "--startup-context", startupContextPath]
      : ["run", "-w", "service", "start", "--", "--startup-context", startupContextPath];
    sendStatus({
      phase: "starting",
      message: [
        `Starting Noobot service process...`,
        `command=${command}`,
        `args=${args.join(" ")}`,
        `cwd=${cwd}`,
        `log=${getLogFilePath()}`,
        `globalConfig=${globalConfigPath}`,
        `dependencies=${JSON.stringify(dependencySummary)}`,
        `startupContext=${startupContextPath}`,
      ].join("\n"),
    });
    managedServiceProcess = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...dependencyEnv,
        ELECTRON_RUN_AS_NODE: isPackaged ? "1" : process.env.ELECTRON_RUN_AS_NODE,
        PORT: String(servicePort),
        NOOBOT_DESKTOP: "1",
        NOOBOT_USER_DATA_DIR: userDataPath,
        NOOBOT_CONFIG_DIR: configDir,
        NOOBOT_DATA_DIR: process.env.NOOBOT_DATA_DIR || path.join(userDataPath, "data"),
        NOOBOT_LOG_DIR: process.env.NOOBOT_LOG_DIR || path.join(userDataPath, "logs"),
        NOOBOT_GLOBAL_CONFIG_PATH: globalConfigPath,
        NOOBOT_WORKSPACE_ROOT: configState.workspaceRootPath,
        NOOBOT_WORKSPACE_TEMPLATE_PATH: configState.workspaceTemplatePath,
      },
      stdio: "pipe",
      windowsHide: true,
    });

    managedServiceProcess.stdout?.on("data", (chunk) => {
      sendStatus({ phase: "service-log", message: chunk.toString() });
    });
    managedServiceProcess.stderr?.on("data", (chunk) => {
      sendStatus({ phase: "service-log", message: chunk.toString() });
    });
    managedServiceProcess.once("error", (error) => {
      managedServiceProcess = null;
      sendStatus({
        phase: "error",
        message: `Failed to start Noobot service process: ${error?.message || String(error)}`,
      });
    });
    managedServiceProcess.once("exit", (code, signal) => {
      const wasManaged = managedServiceProcess;
      managedServiceProcess = null;
      if (wasManaged && code !== 0 && code !== null) {
        sendStatus({
          phase: "error",
          message: `Noobot service exited early (code=${code}, signal=${signal || ""}).`,
        });
      }
    });
  }

  function startAgentProxy() {
    if (managedAgentProxyProcess) return;
    const isPackaged = app.isPackaged;
    const command = isPackaged ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
    const args = isPackaged ? [path.join(packagedBackendRoot, "agent-proxy", "agent-proxy.js")] : ["run", "-w", "agent-proxy", "start"];
    const cwd = isPackaged ? packagedBackendRoot : repoRoot;
    const frontendRoot = isPackaged ? path.join(process.resourcesPath, "frontend") : "";
    const dependencyEnv = buildDependencyRuntimeEnv({ app });
    const dependencySummary = summarizeDependencyRuntimeEnv(dependencyEnv);
    sendStatus({
      phase: "starting",
      message: [
        `Starting Noobot agent proxy process...`,
        `command=${command}`,
        `args=${args.join(" ")}`,
        `cwd=${cwd}`,
        `health=${agentProxyHealthUrl}`,
        `frontend=${frontendRoot || "dev-server"}`,
        `dependencies=${JSON.stringify(dependencySummary)}`,
      ].join("\n"),
    });
    managedAgentProxyProcess = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...dependencyEnv,
        ELECTRON_RUN_AS_NODE: isPackaged ? "1" : process.env.ELECTRON_RUN_AS_NODE,
        AGENT_PROXY_PORT: String(agentProxyPort),
        AGENT_PROXY_HOST: "127.0.0.1",
        AGENT_PROXY_UPSTREAM_HTTP_BASE: serviceOrigin,
        AGENT_PROXY_UPSTREAM_WS_URL: `ws://127.0.0.1:${servicePort}/chat/ws`,
        AGENT_PROXY_FRONTEND_ROOT: frontendRoot,
        AGENT_PROXY_HTTP_RATE_LIMIT_ENABLED: "0",
        AGENT_PROXY_WS_RATE_LIMIT_ENABLED: "0",
      },
      stdio: "pipe",
      windowsHide: true,
    });
    managedAgentProxyProcess.stdout?.on("data", (chunk) => sendStatus({ phase: "agent-proxy-log", message: chunk.toString() }));
    managedAgentProxyProcess.stderr?.on("data", (chunk) => sendStatus({ phase: "agent-proxy-log", message: chunk.toString() }));
    managedAgentProxyProcess.once("error", (error) => {
      managedAgentProxyProcess = null;
      sendStatus({ phase: "error", message: `Failed to start Noobot agent proxy process: ${error?.message || String(error)}` });
    });
    managedAgentProxyProcess.once("exit", (code, signal) => {
      const wasManaged = managedAgentProxyProcess;
      managedAgentProxyProcess = null;
      if (wasManaged && code !== 0 && code !== null) {
        sendStatus({ phase: "error", message: `Noobot agent proxy exited early (code=${code}, signal=${signal || ""}).` });
      }
    });
  }

  async function waitForHealthyService() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < startupTimeoutMs) {
      if (await isServiceHealthy()) return true;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return false;
  }

  async function waitForHealthyAgentProxy() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < startupTimeoutMs) {
      if (await isAgentProxyHealthy()) return true;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return false;
  }

  async function ensureServiceStarted() {
    if (serviceStartupPromise) return serviceStartupPromise;
    serviceStartupPromise = (async () => {
      sendStatus({ phase: "checking", message: `Checking ${healthUrl}` });
      if (await isServiceHealthy()) {
        sendStatus({ phase: "ready", message: "Noobot service is already running." });
        return;
      }

      setDesktopConfigState(ensureDesktopGlobalConfig({ isPackaged: app.isPackaged, userDataPath: app.getPath("userData") }));
      if (getDesktopConfigState().superAdmin?.missing) {
        await requestSuperAdminConfig(getDesktopConfigState().superAdmin);
        setDesktopConfigState(ensureDesktopGlobalConfig({ isPackaged: app.isPackaged, userDataPath: app.getPath("userData") }));
      }
      if (getDesktopConfigState().missingParams.length) {
        await requestMissingConfigParams(getDesktopConfigState().missingParams);
        setDesktopConfigState(ensureDesktopGlobalConfig({ isPackaged: app.isPackaged, userDataPath: app.getPath("userData") }));
      }
      sendStatus({ phase: "starting", message: "Starting Noobot service..." });
      startNoobotService();
      const healthy = await waitForHealthyService();
      if (!healthy) {
        throw new Error(`Noobot service did not become healthy within ${startupTimeoutMs}ms.`);
      }
      sendStatus({ phase: "ready", message: "Noobot service is ready." });
      if (app.isPackaged) {
        sendStatus({ phase: "starting", message: "Starting Noobot agent proxy..." });
        syncPackagedProxyConfigs();
        if (!(await isAgentProxyHealthy())) startAgentProxy();
        const proxyHealthy = await waitForHealthyAgentProxy();
        if (!proxyHealthy) throw new Error(`Noobot agent proxy did not become healthy within ${startupTimeoutMs}ms.`);
        sendStatus({ phase: "ready", message: "Noobot agent proxy is ready." });
      }
    })().finally(() => {
      serviceStartupPromise = null;
    });
    return serviceStartupPromise;
  }


  function stopManagedService() {
    if (managedAgentProxyProcess) {
      const child = managedAgentProxyProcess;
      managedAgentProxyProcess = null;
      child.kill("SIGTERM");
    }
    if (!managedServiceProcess) return;
    const child = managedServiceProcess;
    managedServiceProcess = null;
    child.kill("SIGTERM");
  }


  return { ensureServiceStarted, stopManagedService };
}
