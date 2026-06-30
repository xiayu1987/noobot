/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createDependencyDetector } from "./dependency-detect.js";
import { createDependencyInstaller } from "./dependency-installer.js";
import { createMacDependencyInstallerTools } from "./dependency-managed-mac.js";
import { createDependencyProcessTools } from "./dependency-process.js";

export function createDesktopDependencyManager({
  app,
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
    getDependencyProxyUrl,
  });

  return { ensureSelectedDependencies };
}
