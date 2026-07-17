/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { clientFilePath as path } from "../path-resolver.js";

const desktopRipgrepPackages = {
  windows: [
    "@vscode/ripgrep-win32-x64",
    "@vscode/ripgrep-win32-arm64",
    "@vscode/ripgrep-win32-ia32",
  ],
  mac: [
    "@vscode/ripgrep-darwin-x64",
    "@vscode/ripgrep-darwin-arm64",
  ],
};

export function getDesktopRipgrepPackages(desktopPackageName, ripgrepVersion) {
  const platform = desktopPackageName === "noobot-windows-client"
    ? "windows"
    : desktopPackageName === "noobot-mac-client"
      ? "mac"
      : "";
  return (desktopRipgrepPackages[platform] || []).map((packageName) => `${packageName}@${ripgrepVersion}`);
}

export function getRipgrepBinaryRelativePath(packageSpec) {
  const packageName = packageSpec.slice(0, packageSpec.lastIndexOf("@"));
  const executableName = packageName.includes("-win32-") ? "rg.exe" : "rg";
  return path.join("node_modules", packageName, "bin", executableName);
}
