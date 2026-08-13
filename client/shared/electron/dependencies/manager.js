/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createDependencyDetector } from "./detect.js";
import { createDependencyInstaller } from "./installer.js";
import { createMacDependencyInstallerTools } from "./managed-mac.js";
import { createDependencyProcessTools } from "./process.js";
import { dependencySpecs } from "./specs.js";

export function createDesktopDependencyManager({
  app,
  backendRoot = "",
  appendEarlyLog = () => {},
  writeDependencyLog = () => {},
  sendStatus = () => {},
  getDependencyProxyUrl = () => "",
} = {}) {
  const { runProcess, hasExistingFile } = createDependencyProcessTools({ appendEarlyLog });

  const {
    getDarwinManagedKeyForSpec,
    getMacManagedCommandPath,
    installLibreOfficeFromDmg,
    installManagedDependencyMac,
    prependManagedDependencyPath,
  } = createMacDependencyInstallerTools({
    app,
    runProcess,
    hasExistingFile,
    writeDependencyLog,
    sendStatus,
    getDependencyProxyUrl,
  });

  const { findAvailableCommand, isDependencyInstalled, waitForDependencyInstalled } = createDependencyDetector({
    app,
    backendRoot,
    appendEarlyLog,
    writeDependencyLog,
    runProcess,
    hasExistingFile,
    getDarwinManagedKeyForSpec,
    getMacManagedCommandPath,
    prependManagedDependencyPath,
  });

  const { ensureSelectedDependencies } = createDependencyInstaller({
    appendEarlyLog,
    writeDependencyLog,
    sendStatus,
    runProcess,
    findAvailableCommand,
    isDependencyInstalled,
    waitForDependencyInstalled,
    installLibreOfficeFromDmg,
    installManagedDependencyMac,
    app,
    backendRoot,
    getDependencyProxyUrl,
  });

  async function inspectDependencies() {
    const dependencies = [];
    for (const [key, spec] of Object.entries(dependencySpecs)) {
      let available = false;
      try {
        available = await isDependencyInstalled(spec);
      } catch (error) {
        writeDependencyLog("inspect:error", { key, label: spec.label, error });
      }
      dependencies.push({ key, name: spec.label, available });
    }
    return dependencies;
  }

  return { ensureSelectedDependencies, inspectDependencies };
}
