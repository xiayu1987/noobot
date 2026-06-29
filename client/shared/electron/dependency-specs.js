/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const desktopDependencyTimeouts = Object.freeze({
  commandProbeMs: 15000,
  checkMs: 45000,
  packageQueryMs: 30000,
  installCommandMs: 15000,
  downloadMs: 15 * 60 * 1000,
  dmgAttachMs: 2 * 60 * 1000,
  appCopyMs: 10 * 60 * 1000,
  dmgDetachMs: 60 * 1000,
  installMs: 20 * 60 * 1000,
});

export const dependencySpecs = {
  libreoffice: {
    label: "LibreOffice",
    checkCommands: ["libreoffice", "soffice"],
    win32ExecutableCandidates: [
      "LibreOffice\\program\\soffice.exe",
      "LibreOffice\\program\\libreoffice.exe",
      "The Document Foundation\\LibreOffice\\program\\soffice.exe",
      "The Document Foundation\\LibreOffice\\program\\libreoffice.exe",
    ],
    win32RegistryKeys: [
      "HKLM\\SOFTWARE\\LibreOffice\\UNO\\InstallPath",
      "HKLM\\SOFTWARE\\WOW6432Node\\LibreOffice\\UNO\\InstallPath",
      "HKCU\\SOFTWARE\\LibreOffice\\UNO\\InstallPath",
    ],
    win32WingetPackages: ["TheDocumentFoundation.LibreOffice"],
    packages: {
      win32: { winget: "TheDocumentFoundation.LibreOffice", choco: "libreoffice-fresh" },
      darwin: { brew: "libreoffice" },
      linux: { apt: "libreoffice", dnf: "libreoffice", yum: "libreoffice", pacman: "libreoffice-fresh" },
    },
    darwinAppBundle: "LibreOffice.app",
    darwinDmg: {
      version: process.env.NOOBOT_LIBREOFFICE_MAC_VERSION || "",
      url: process.env.NOOBOT_LIBREOFFICE_MAC_DMG_URL || "",
    },
  },
  ffmpeg: {
    label: "FFmpeg",
    checkCommands: ["ffmpeg"],
    managedCommand: "ffmpeg",
    win32ExecutableCandidates: [
      "ffmpeg\\bin\\ffmpeg.exe",
      "Gyan\\FFmpeg\\bin\\ffmpeg.exe",
      "Gyan\\ffmpeg\\bin\\ffmpeg.exe",
      "chocolatey\\bin\\ffmpeg.exe",
    ],
    win32WingetPackages: ["Gyan.FFmpeg"],
    packages: {
      win32: { winget: "Gyan.FFmpeg", choco: "ffmpeg" },
      darwin: { brew: "ffmpeg" },
      linux: { apt: "ffmpeg", dnf: "ffmpeg", yum: "ffmpeg", pacman: "ffmpeg" },
    },
    darwinManaged: {
      url: process.env.NOOBOT_FFMPEG_MAC_URL || "",
      manualUrl: "https://evermeet.cx/ffmpeg/",
    },
  },
  nodejs: {
    label: "Node.js",
    checkCommands: ["node"],
    managedCommand: "node",
    win32ExecutableCandidates: [
      "nodejs\\node.exe",
      "node\\node.exe",
      "node.exe",
      "chocolatey\\bin\\node.exe",
    ],
    win32RegistryKeys: [
      "HKLM\\SOFTWARE\\Node.js",
      "HKLM\\SOFTWARE\\WOW6432Node\\Node.js",
      "HKCU\\SOFTWARE\\Node.js",
    ],
    win32WingetPackages: ["OpenJS.NodeJS.LTS", "OpenJS.NodeJS"],
    packages: {
      win32: { winget: "OpenJS.NodeJS.LTS", choco: "nodejs-lts" },
      darwin: { brew: "node" },
      linux: { apt: "nodejs", dnf: "nodejs", yum: "nodejs", pacman: "nodejs" },
    },
    darwinManaged: {
      version: process.env.NOOBOT_NODEJS_MAC_VERSION || "",
      url: process.env.NOOBOT_NODEJS_MAC_URL || "",
      manualUrl: "https://nodejs.org/en/download",
    },
  },
};
