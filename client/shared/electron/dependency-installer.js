/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { dependencySpecs, desktopDependencyTimeouts } from "./dependency-specs.js";
import { createDependencyError, getDependencyErrorMeta, withTimeout } from "./dependency-process.js";

export function createDependencyInstaller({
  appendEarlyLog = () => {},
  writeDependencyLog = () => {},
  sendStatus = () => {},
  runProcess,
  findAvailableCommand,
  isDependencyInstalled,
  waitForDependencyInstalled,
  installLibreOfficeFromDmg,
  installManagedDependencyMac,
} = {}) {
  async function buildDependencyInstallCommand(spec) {
    writeDependencyLog("install-command:build:start", { label: spec.label, platform: process.platform }, { debug: true });
    const packages = spec.packages?.[process.platform] || {};
    if (process.platform === "win32") {
      if (packages.winget && await findAvailableCommand(["winget"])) return { command: "winget", args: ["install", "--id", packages.winget, "--exact", "--accept-package-agreements", "--accept-source-agreements"] };
      if (packages.choco && await findAvailableCommand(["choco"])) return { command: "choco", args: ["install", packages.choco, "-y"] };
    }
    if (process.platform === "darwin") {
      if (packages.brew && await findAvailableCommand(["brew"])) return { command: "brew", args: ["install", "--cask", packages.brew] };
    }
    if (process.platform === "linux") {
      if (packages.apt && await findAvailableCommand(["apt-get"])) {
        const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
        return isRoot ? { command: "apt-get", args: ["install", "-y", packages.apt] } : { command: "sudo", args: ["-n", "apt-get", "install", "-y", packages.apt] };
      }
      const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
      if (packages.dnf && await findAvailableCommand(["dnf"])) return isRoot ? { command: "dnf", args: ["install", "-y", packages.dnf] } : { command: "sudo", args: ["-n", "dnf", "install", "-y", packages.dnf] };
      if (packages.yum && await findAvailableCommand(["yum"])) return isRoot ? { command: "yum", args: ["install", "-y", packages.yum] } : { command: "sudo", args: ["-n", "yum", "install", "-y", packages.yum] };
      if (packages.pacman && await findAvailableCommand(["pacman"])) return isRoot ? { command: "pacman", args: ["-S", "--noconfirm", packages.pacman] } : { command: "sudo", args: ["-n", "pacman", "-S", "--noconfirm", packages.pacman] };
    }
    writeDependencyLog("install-command:build:missing", { label: spec.label, platform: process.platform });
    return null;
  }

  async function ensureSelectedDependencies(dependencies = {}) {
    const selected = Object.entries(dependencySpecs).filter(([key]) => dependencies?.[key] === true);
    const results = [];
    for (const [key, spec] of selected) {
      writeDependencyLog("ensure:start", { key, label: spec.label });
      sendStatus({ phase: "dependency", message: `Checking ${spec.label}...` });
      let installed = false;
      try {
        writeDependencyLog("check:start", { key, label: spec.label, timeoutMs: desktopDependencyTimeouts.checkMs });
        installed = await withTimeout(
          isDependencyInstalled(spec),
          desktopDependencyTimeouts.checkMs,
          `dependency check ${spec.label}`,
          { appendEarlyLog },
        );
        writeDependencyLog("check:finish", { key, label: spec.label, installed });
      } catch (error) {
        writeDependencyLog("check:error", { key, label: spec.label, error });
        sendStatus({ phase: "dependency", message: `${spec.label} check timed out or failed. Continuing with installer lookup...` });
      }
      if (installed) {
        writeDependencyLog("ensure:installed", { key, label: spec.label });
        sendStatus({ phase: "dependency", message: `${spec.label} is already installed. Skipping.` });
        results.push({ key, ok: true, skipped: true });
        continue;
      }
      writeDependencyLog("missing:start", { key, label: spec.label, platform: process.platform });
      sendStatus({ phase: "dependency", message: `${spec.label} is not installed. Looking for an installer...` });
      writeDependencyLog("install-command:start", { key, label: spec.label, timeoutMs: desktopDependencyTimeouts.installCommandMs });
      const installCommand = await withTimeout(
        buildDependencyInstallCommand(spec),
        desktopDependencyTimeouts.installCommandMs,
        `dependency installer lookup ${spec.label}`,
        { appendEarlyLog },
      );
      writeDependencyLog("install-command:finish", { key, label: spec.label, command: installCommand ? [installCommand.command, ...(installCommand.args || [])].join(" ") : "" });
      if (!installCommand) {
        if (process.platform === "darwin" && key === "libreoffice") {
          writeDependencyLog("dmg:install:start", { key, label: spec.label });
          try {
            await installLibreOfficeFromDmg(spec);
            writeDependencyLog("dmg:install:finish", { key, label: spec.label });
            sendStatus({ phase: "dependency", message: `${spec.label} DMG installer finished. Verifying availability...` });
            writeDependencyLog("verify:start", { key, label: spec.label, method: "dmg" });
            if (!(await waitForDependencyInstalled(spec))) {
              writeDependencyLog("verify:failed", { key, label: spec.label, method: "dmg" });
              throw createDependencyError(`${spec.label} DMG installation finished, but it is not available yet. Please restart Noobot or install it manually if /Applications/LibreOffice.app is still missing.`, { failureKind: "verification" });
            }
            writeDependencyLog("verify:finish", { key, label: spec.label, method: "dmg" });
            sendStatus({ phase: "dependency", message: `${spec.label} installed.` });
            results.push({ key, ok: true, installed: true, method: "dmg" });
            continue;
          } catch (error) {
            const meta = getDependencyErrorMeta(error);
            const message = `Failed to auto-install ${spec.label} without Homebrew. ${error?.message || String(error)}`;
            writeDependencyLog("dmg:install:error", { key, label: spec.label, error });
            sendStatus({ phase: "dependency-missing", message, dependency: key, retryable: meta.retryable, failureKind: meta.failureKind });
            throw createDependencyError(message, meta);
          }
        }
        if (process.platform === "darwin" && (key === "ffmpeg" || key === "nodejs")) {
          writeDependencyLog("managed:install:start", { key, label: spec.label });
          try {
            const managedInstallResult = await installManagedDependencyMac(key, spec);
            writeDependencyLog("managed:install:finish", {
              key,
              label: spec.label,
              ok: managedInstallResult?.ok === true,
              method: managedInstallResult?.method || "managed",
              path: managedInstallResult?.path || "",
            });
            if (managedInstallResult?.ok === true) {
              sendStatus({ phase: "dependency", message: `${spec.label} installed.` });
              results.push({ key, ok: true, installed: true, method: managedInstallResult.method || "managed", path: managedInstallResult.path || "" });
              continue;
            }
            sendStatus({ phase: "dependency", message: `${spec.label} managed installer finished. Verifying availability...` });
            writeDependencyLog("verify:start", { key, label: spec.label, method: "managed" });
            if (!(await waitForDependencyInstalled(spec))) {
              writeDependencyLog("verify:failed", { key, label: spec.label, method: "managed" });
              throw createDependencyError(`${spec.label} managed installation finished, but it is not available yet. Please restart Noobot or install it manually.`, { failureKind: "verification" });
            }
            writeDependencyLog("verify:finish", { key, label: spec.label, method: "managed" });
            sendStatus({ phase: "dependency", message: `${spec.label} installed.` });
            results.push({ key, ok: true, installed: true, method: "managed" });
            continue;
          } catch (error) {
            const meta = getDependencyErrorMeta(error);
            const envHint = key === "ffmpeg" ? "NOOBOT_FFMPEG_MAC_URL" : "NOOBOT_NODEJS_MAC_URL / NOOBOT_NODEJS_MAC_VERSION";
            const message = `Failed to auto-install ${spec.label} without Homebrew. ${error?.message || String(error)} You can override the download with ${envHint}.`;
            writeDependencyLog("managed:install:error", { key, label: spec.label, error });
            sendStatus({ phase: "dependency-missing", message, dependency: key, retryable: meta.retryable, failureKind: meta.failureKind });
            throw createDependencyError(message, meta);
          }
        }
        const message = process.platform === "darwin"
          ? `Cannot auto-install ${spec.label}: Homebrew was not found. Please install ${spec.label} manually or install Homebrew and run: brew install --cask ${spec.packages?.darwin?.brew || spec.packages?.darwin?.brew || spec.label}`
          : `Cannot auto-install ${spec.label}: no supported package manager was found.`;
        writeDependencyLog("missing:no-installer", { key, label: spec.label, message });
        sendStatus({ phase: "dependency-missing", message, dependency: key, retryable: false, failureKind: "installer-unavailable" });
        throw createDependencyError(message, { failureKind: "installer-unavailable" });
      }
      writeDependencyLog("install:start", { key, label: spec.label, command: [installCommand.command, ...(installCommand.args || [])].join(" "), timeoutMs: desktopDependencyTimeouts.installMs });
      sendStatus({ phase: "dependency", message: `Installing ${spec.label}...` });
      const result = await runProcess(installCommand.command, installCommand.args, {
        timeoutMs: desktopDependencyTimeouts.installMs,
      });
      writeDependencyLog("install:finish", { key, label: spec.label, ok: result.ok, code: result.code, error: result.error });
      if (!result.ok) {
        const detail = String(result.stderr || result.stdout || result.error || "").trim().slice(0, 1000);
        throw createDependencyError(`Failed to install ${spec.label}.${detail ? ` ${detail}` : ""}`, { failureKind: "installer" });
      }
      sendStatus({ phase: "dependency", message: `${spec.label} installer finished. Verifying availability...` });
      writeDependencyLog("verify:start", { key, label: spec.label });
      if (!(await waitForDependencyInstalled(spec))) {
        writeDependencyLog("verify:failed", { key, label: spec.label });
        throw createDependencyError(`${spec.label} installation finished, but it is not available yet. Please restart Noobot or install it manually if the command is still missing from PATH.`, { failureKind: "verification" });
      }
      writeDependencyLog("verify:finish", { key, label: spec.label });
      sendStatus({ phase: "dependency", message: `${spec.label} installed.` });
      results.push({ key, ok: true, installed: true });
    }
    return results;
  }

  return { buildDependencyInstallCommand, ensureSelectedDependencies };
}
