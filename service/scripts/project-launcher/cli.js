/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import process from "node:process";
import { resolveServiceGlobalConfigPath } from "../../services/global-config-source.js";
import { text } from "@noobot/shared/value";

export function parseCliOptions(argv = []) {
  const items = Array.isArray(argv) ? argv : [];
  const options = {
    nonInteractive: items.includes("--non-interactive"),
    lang: "",
    globalConfigPath: "",
  };

  for (let index = 0; index < items.length; index += 1) {
    const item = text(items[index]);
    if (item.startsWith("--lang=")) {
      options.lang = item.slice("--lang=".length).trim();
      continue;
    }
    if (item === "--lang") {
      options.lang = text(items[index + 1]);
      index += 1;
    }
    if (item.startsWith("--global-config-path=")) {
      options.globalConfigPath = item.slice("--global-config-path=".length).trim();
      continue;
    }
    if (item === "--global-config-path") {
      options.globalConfigPath = text(items[index + 1]);
      index += 1;
    }
  }

  return options;
}

export function resolveLauncherGlobalConfigPath({
  serviceRoot,
  cliOptions = {},
  env = process.env,
} = {}) {
  return resolveServiceGlobalConfigPath({
    filePath: cliOptions?.globalConfigPath || "",
    cwd: serviceRoot,
    env,
  });
}
