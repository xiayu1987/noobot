/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { RUNTIME_EVENTS_CONFIG_ENVS } from "@noobot/shared/runtime-events-config";
import { applyRuntimeEventsEnv } from "../src/testing.js";

export { markSessionDeleted, persistSession } from "../src/testing.js";

const CONTROL_ENV_NAMES = [
  ...Object.values(RUNTIME_EVENTS_CONFIG_ENVS.runtimeEvents),
  ...Object.values(RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.log),
  ...Object.values(RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.debug),
];

export async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-events-"));
  process.env.NOOBOT_WORKSPACE_ROOT = root;
  for (const name of CONTROL_ENV_NAMES) delete process.env[name];
  return root;
}

export function useRuntimeEventsEnv(declaration = {}) {
  applyRuntimeEventsEnv(declaration);
}

export async function readJsonl(file) {
  const raw = await fs.readFile(file, "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function writeArchive(file, ageMs = 0) {
  await fs.writeFile(file, `${JSON.stringify({ archived: path.basename(file) })}\n`, "utf8");
  const time = new Date(Date.now() - ageMs);
  await fs.utimes(file, time, time);
  return file;
}
