/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import fs from "node:fs";
import { desktopDependencyTimeouts } from "./dependency-specs.js";
import { sleep } from "./dependency-process.js";

export function createDependencyDetector({
  appendEarlyLog = () => {},
  writeDependencyLog = () => {},
  runProcess,
  hasExistingFile,
  getDarwinManagedKeyForSpec = () => "",
  getMacManagedCommandPath = () => "",
  prependManagedDependencyPath = () => {},
} = {}) {
  function getFileMode(filePath) {
    try {
      return fs.statSync(filePath).mode.toString(8);
    } catch {
      return "";
    }
  }

  async function hasCommand(command) {
    if (process.platform === "darwin") prependManagedDependencyPath();
    appendEarlyLog(`[dependency:probe:start] command=${command}`);
    const result = await runProcess(command, ["--version"], {
      timeoutMs: desktopDependencyTimeouts.commandProbeMs,
    });
    appendEarlyLog(`[dependency:probe:finish] command=${command}; ok=${result.ok}; error=${result.error || ""}`);
    return result.ok;
  }

  function hasMacAppBundle(appName) {
    if (process.platform !== "darwin") return false;
    const candidates = [
      path.join("/Applications", appName),
      path.join(process.env.HOME || "", "Applications", appName),
    ].filter(Boolean);
    appendEarlyLog(`[dependency:installed:mac-app:start] app=${appName}; candidates=${candidates.join(" | ")}`);
    for (const candidate of candidates) {
      appendEarlyLog(`[dependency:installed:mac-app:path] app=${appName}; path=${candidate}`);
      const exists = hasExistingFile(candidate);
      appendEarlyLog(`[dependency:installed:mac-app:path-result] app=${appName}; path=${candidate}; exists=${exists}`);
      if (exists) {
        appendEarlyLog(`[dependency:installed:mac-app:finish] app=${appName}; installed=true; path=${candidate}`);
        return true;
      }
    }
    appendEarlyLog(`[dependency:installed:mac-app:finish] app=${appName}; installed=false`);
    return false;
  }

  function parseWindowsRegistryDefaultValue(output) {
    const lines = String(output || "").split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*\(Default\)\s+REG_\w+\s+(.+)\s*$/i)
        || line.match(/^\s*默认\s+REG_\w+\s+(.+)\s*$/i);
      if (match?.[1]) return match[1].trim();
    }
    return "";
  }

  async function hasWindowsRegistryInstallPath(spec) {
    for (const registryKey of spec.win32RegistryKeys || []) {
      const result = await runProcess("reg", ["query", registryKey], {
        timeoutMs: desktopDependencyTimeouts.commandProbeMs,
      });
      if (!result.ok) continue;
      const installPath = parseWindowsRegistryDefaultValue(result.stdout);
      if (!installPath) continue;
      const candidates = [
        path.join(installPath, "soffice.exe"),
        path.join(installPath, "libreoffice.exe"),
        path.join(installPath, "program", "soffice.exe"),
        path.join(installPath, "program", "libreoffice.exe"),
      ];
      if (candidates.some(hasExistingFile)) return true;
    }
    return false;
  }

  async function hasWindowsWingetPackage(spec) {
    if (!spec.win32WingetPackages?.length || !(await findAvailableCommand(["winget"]))) return false;
    for (const packageId of spec.win32WingetPackages) {
      const result = await runProcess("winget", ["list", "--id", packageId, "--exact", "--accept-source-agreements"], {
        timeoutMs: desktopDependencyTimeouts.packageQueryMs,
      });
      if (result.ok && String(result.stdout || "").toLowerCase().includes(packageId.toLowerCase())) return true;
    }
    return false;
  }

  async function isDependencyInstalled(spec) {
    appendEarlyLog(`[dependency:installed:start] label=${spec.label}; platform=${process.platform}`);
    if (process.platform === "darwin" && spec.managedCommand) {
      const managedKey = getDarwinManagedKeyForSpec(spec);
      const managedPath = managedKey ? getMacManagedCommandPath(managedKey, spec.managedCommand) : "";
      const managedExists = hasExistingFile(managedPath);
      writeDependencyLog("installed:managed:path", {
        label: spec.label,
        key: managedKey,
        command: spec.managedCommand,
        path: managedPath,
        exists: managedExists,
        mode: managedExists ? getFileMode(managedPath) : "",
      });
      if (managedExists) {
        const result = await runProcess(managedPath, ["--version"], { timeoutMs: desktopDependencyTimeouts.commandProbeMs });
        writeDependencyLog("installed:managed:probe", {
          label: spec.label,
          key: managedKey,
          command: spec.managedCommand,
          path: managedPath,
          ok: result.ok,
          code: result.code,
          error: result.error,
          stdout: String(result.stdout || "").slice(0, 500),
          stderr: String(result.stderr || "").slice(0, 1000),
        });
        appendEarlyLog(`[dependency:installed:managed:probe] label=${spec.label}; path=${managedPath}; ok=${result.ok}; code=${result.code ?? ""}; error=${result.error || ""}; stderr=${String(result.stderr || "").slice(0, 500)}`);
        if (result.ok) {
          prependManagedDependencyPath();
          appendEarlyLog(`[dependency:installed:finish] label=${spec.label}; installed=true; via=managed; path=${managedPath}`);
          return true;
        }
      } else if (managedPath) {
        appendEarlyLog(`[dependency:installed:managed:missing] label=${spec.label}; path=${managedPath}`);
      }
    }
    if (process.platform === "darwin" && spec.darwinAppBundle) {
      appendEarlyLog(`[dependency:installed:mac-app] label=${spec.label}; app=${spec.darwinAppBundle}`);
      if (hasMacAppBundle(spec.darwinAppBundle)) {
        appendEarlyLog(`[dependency:installed:finish] label=${spec.label}; installed=true; via=mac-app`);
        return true;
      }
    }
    for (const command of spec.checkCommands || []) {
      appendEarlyLog(`[dependency:installed:command] label=${spec.label}; command=${command}`);
      const installed = await hasCommand(command);
      appendEarlyLog(`[dependency:installed:command-result] label=${spec.label}; command=${command}; installed=${installed}`);
      if (installed) {
        appendEarlyLog(`[dependency:installed:finish] label=${spec.label}; installed=true; via=command; command=${command}`);
        return true;
      }
    }
    if (process.platform === "win32") {
      if (await hasWindowsRegistryInstallPath(spec)) return true;
      const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.ProgramData, process.env.LOCALAPPDATA, process.env.APPDATA, "C:\\"].filter(Boolean);
      for (const root of roots) {
        for (const relative of spec.win32ExecutableCandidates || []) {
          if (hasExistingFile(path.join(root, relative))) return true;
        }
      }
      if (await hasWindowsWingetPackage(spec)) return true;
    }
    appendEarlyLog(`[dependency:installed:finish] label=${spec.label}; installed=false`);
    return false;
  }

  async function waitForDependencyInstalled(spec, { timeoutMs = 90000, intervalMs = 3000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (await isDependencyInstalled(spec)) return true;
      await sleep(intervalMs);
    }
    return false;
  }

  async function findAvailableCommand(commands = []) {
    writeDependencyLog("find-command:start", { commands: commands.join(",") }, { debug: true });
    for (const command of commands) {
      writeDependencyLog("find-command:probe", { command }, { debug: true });
      if (await hasCommand(command)) {
        writeDependencyLog("find-command:found", { command });
        return command;
      }
    }
    writeDependencyLog("find-command:missing", { commands: commands.join(",") });
    return "";
  }

  return {
    findAvailableCommand,
    hasCommand,
    hasMacAppBundle,
    hasWindowsRegistryInstallPath,
    hasWindowsWingetPackage,
    isDependencyInstalled,
    parseWindowsRegistryDefaultValue,
    waitForDependencyInstalled,
  };
}
