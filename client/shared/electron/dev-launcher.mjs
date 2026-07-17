#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
/*
 * Cross-platform Electron dev launcher.
 */
import { spawn } from "node:child_process";

const electronCommand = process.platform === "win32" ? "electron.cmd" : "electron";
const child = spawn(electronCommand, ["."], {
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    NOOBOT_CLIENT_URL: process.env.NOOBOT_CLIENT_URL || "http://127.0.0.1:10060",
  },
});

child.on("error", (error) => {
  console.error(`[desktop-dev] failed to start Electron: ${error?.message || String(error)}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(Number(code || 0));
});
