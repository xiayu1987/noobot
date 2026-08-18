/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { clientFilePath as path } from "../path-resolver.js";
import {
  getDependencyProxyEnv,
  maskDependencyProxyUrl,
  normalizeDependencyProxyUrl,
} from "../electron/dependencies/proxy.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const STANDARD_PROXY_KEYS = Object.freeze([
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
]);

async function readJson(filePath = "") {
  if (!String(filePath || "").trim()) return null;
  try {
    const value = JSON.parse(await readFile(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export async function resolveDesktopBuildProxy({ env = process.env, root = repoRoot } = {}) {
  const standardKey = STANDARD_PROXY_KEYS.find((key) => String(env[key] || "").trim());
  if (standardKey) {
    return {
      source: `environment:${standardKey}`,
      proxyUrl: String(env[standardKey] || "").trim(),
      inherited: true,
    };
  }

  const explicitProxy = String(env.NOOBOT_DEPENDENCY_PROXY_URL || "").trim();
  if (explicitProxy) {
    return {
      source: "environment:NOOBOT_DEPENDENCY_PROXY_URL",
      proxyUrl: normalizeDependencyProxyUrl(explicitProxy),
      inherited: false,
    };
  }

  const globalConfigPath = String(env.NOOBOT_GLOBAL_CONFIG_PATH || "").trim()
    ? path.resolve(env.NOOBOT_GLOBAL_CONFIG_PATH)
    : path.join(root, "service", "config", "global.config.json");
  const config = await readJson(globalConfigPath);
  const configuredProxy = String(config?.desktop?.dependency_proxy_url || "").trim();
  return {
    source: configuredProxy ? `config:${globalConfigPath}` : "none",
    proxyUrl: configuredProxy ? normalizeDependencyProxyUrl(configuredProxy) : "",
    inherited: false,
  };
}

export function buildDesktopBuilderEnv({ env = process.env, proxy = {} } = {}) {
  if (!proxy?.proxyUrl || proxy?.inherited === true) return { ...env };
  return { ...env, ...getDependencyProxyEnv(proxy.proxyUrl) };
}

export async function runElectronBuilder({
  args = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
  root = repoRoot,
  spawnImpl = spawn,
} = {}) {
  const proxy = await resolveDesktopBuildProxy({ env, root });
  const builderCli = path.join(root, "node_modules", "electron-builder", "out", "cli", "cli.js");
  if (proxy.proxyUrl) {
    console.log(
      `[desktop-build] electron-builder download proxy: ${maskDependencyProxyUrl(proxy.proxyUrl)} (${proxy.source})`,
    );
  } else {
    console.log("[desktop-build] electron-builder download proxy: none");
  }
  return await new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, [builderCli, ...args], {
      cwd,
      env: buildDesktopBuilderEnv({ env, proxy }),
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve(0);
        return;
      }
      reject(
        new Error(
          `electron-builder failed (code=${String(code ?? "")}, signal=${String(signal || "")})`,
        ),
      );
    });
  });
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  runElectronBuilder().catch((error) => {
    console.error(`[desktop-build] ${error?.message || String(error)}`);
    process.exitCode = 1;
  });
}
