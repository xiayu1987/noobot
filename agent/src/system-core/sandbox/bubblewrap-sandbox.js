/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { exec } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { filePath as path } from "../utils/path-resolver.js";

export async function bwrapSupportsOption(optionName = "") {
  return new Promise((resolve) => {
    exec("bwrap --help", (error, stdout) => {
      if (error) return resolve(false);
      resolve(String(stdout || "").includes(String(optionName || "")));
    });
  });
}

export function buildBubblewrapCommand({ userRoot, command }) {
  const sandboxRoot = path.join(userRoot, "runtime/sandbox/bubblewrap");
  const overlayUpper = path.join(sandboxRoot, "overlay-upper");
  const overlayWork = path.join(sandboxRoot, "overlay-work");
  const persistDir = "/workspace/runtime/sandbox/persist";
  const argv = [
    "bwrap",
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    "--share-net",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--ro-bind",
    "/sys",
    "/sys",
    "--overlay-src",
    "/",
    "--overlay",
    JSON.stringify(overlayUpper),
    JSON.stringify(overlayWork),
    "/",
    "--bind",
    JSON.stringify(userRoot),
    "/workspace",
    "--chdir",
    persistDir,
    "--setenv",
    "HOME",
    persistDir,
    "--setenv",
    "PWD",
    persistDir,
    // cross-platform-allow: bubblewrap is a Linux sandbox provider; these are sandbox-internal Unix paths and shell.
    "--tmpfs",
    "/tmp",
    "--tmpfs",
    // cross-platform-allow: bubblewrap is a Linux sandbox provider; /var/tmp is sandbox-internal.
    "/var/tmp",
    "--",
    // cross-platform-allow: bubblewrap commands run inside a Linux sandbox.
    "bash",
    "-lc",
    JSON.stringify(`mkdir -p "${persistDir}" && cd "${persistDir}" && ${command}`),
  ];
  return {
    cmd: argv.join(" "),
    sandboxRoot,
    overlayUpper,
    overlayWork,
    persistDir,
  };
}

export async function ensureBubblewrapOverlayReady({ overlayUpper, overlayWork }) {
  await mkdir(overlayUpper, { recursive: true });
  await mkdir(overlayWork, { recursive: true });
  await access(overlayUpper, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
  await access(overlayWork, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
  const probePath = path.join(overlayUpper, ".write-probe");
  await writeFile(probePath, "ok");
  await unlink(probePath).catch(() => {});
}
