/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import {
  isBrowserProfileNameAllowed,
  resolveBrowserProfileRoot,
  supportsHeadedBrowser,
} from "@noobot/platform-compatibility/process";

export const DEFAULT_BROWSER_PROFILE_NAME = "default";
const DEVTOOLS_PORT_FILE = "DevToolsActivePort";
const DEVTOOLS_PORT_READ_ATTEMPTS = TURN_THRESHOLDS.tools.browserDevtoolsPortReadAttempts;
const DEVTOOLS_PORT_READ_INTERVAL_MS = TIME_THRESHOLDS.tools.browserDevtoolsPortPollIntervalMs;

const sessions = new Map();

function sessionKey({ userId, profileName }) {
  return `${userId}\u0000${profileName}`;
}

export function resolveBrowserProfileName(value) {
  const name = String(value || "").trim() || DEFAULT_BROWSER_PROFILE_NAME;
  if (!isBrowserProfileNameAllowed(name)) {
    throw new Error(`browser profile name is not allowed: ${name}`);
  }
  return name;
}

export function resolveBrowserProfileDirectory({ profileRoot, userId, profileName }) {
  const root = String(profileRoot || "").trim();
  if (!root) throw new Error("browser profile root is not configured");
  const owner = String(userId || "").trim();
  if (!owner) throw new Error("browser profile owner is required");
  if (!isBrowserProfileNameAllowed(owner)) {
    throw new Error("browser profile owner is not allowed");
  }
  return path.join(root, owner, resolveBrowserProfileName(profileName));
}

async function readDevToolsEndpoint(profileDirectory) {
  const portFile = path.join(profileDirectory, DEVTOOLS_PORT_FILE);
  for (let attempt = 0; attempt < DEVTOOLS_PORT_READ_ATTEMPTS; attempt += 1) {
    try {
      const [port] = (await readFile(portFile, "utf8")).split("\n");
      const parsed = Number(String(port || "").trim());
      if (Number.isInteger(parsed) && parsed > 0) return `http://127.0.0.1:${parsed}`;
    } catch {
      void 0;
    }
    await new Promise((resolve) => setTimeout(resolve, DEVTOOLS_PORT_READ_INTERVAL_MS));
  }
  throw new Error("browser devtools endpoint did not become available");
}

async function launchPersistentSession({
  profileDirectory,
  headed,
  executablePath,
  proxy,
  playwrightModule,
}) {
  await mkdir(profileDirectory, { recursive: true });
  const playwright = playwrightModule || (await import("playwright"));
  const context = await playwright.chromium.launchPersistentContext(profileDirectory, {
    headless: !headed,
    executablePath,
    proxy,
    args: ["--remote-debugging-port=0"],
  });
  const endpoint = await readDevToolsEndpoint(profileDirectory);
  return { context, endpoint };
}

export async function acquireBrowserSession({
  userId,
  profileName,
  profileRoot = "",
  headed = false,
  executablePath = "",
  proxy = undefined,
  sourceEnv = process.env,
  platform = process.platform,
  playwrightModule = null,
} = {}) {
  if (!String(executablePath || "").trim()) {
    throw new Error("Playwright Chromium executable is not configured");
  }
  if (headed && !supportsHeadedBrowser({ platform, sourceEnv })) {
    throw new Error("headed browser requires an active display session");
  }
  const resolvedProfileName = resolveBrowserProfileName(profileName);
  const key = sessionKey({ userId: String(userId || ""), profileName: resolvedProfileName });
  const existing = sessions.get(key);
  if (existing) {
    const session = await existing;
    if (session.headed !== headed) {
      throw new Error(
        `browser profile ${resolvedProfileName} is already open in ${session.headed ? "headed" : "headless"} mode`,
      );
    }
    return { endpoint: session.endpoint, profileName: resolvedProfileName, headed: session.headed };
  }
  const profileDirectory = resolveBrowserProfileDirectory({
    profileRoot: String(profileRoot || "").trim() || resolveBrowserProfileRoot({ sourceEnv }),
    userId,
    profileName: resolvedProfileName,
  });
  const pending = launchPersistentSession({
    profileDirectory,
    headed,
    executablePath,
    proxy,
    playwrightModule,
  }).then(({ context, endpoint }) => {
    context.on("close", () => {
      if (sessions.get(key) === pending) sessions.delete(key);
    });
    return { context, endpoint, headed, profileName: resolvedProfileName };
  });
  sessions.set(key, pending);
  try {
    const session = await pending;
    return { endpoint: session.endpoint, profileName: resolvedProfileName, headed };
  } catch (error) {
    sessions.delete(key);
    throw error;
  }
}

export async function closeBrowserSession({ userId, profileName } = {}) {
  const resolvedProfileName = resolveBrowserProfileName(profileName);
  const key = sessionKey({ userId: String(userId || ""), profileName: resolvedProfileName });
  const pending = sessions.get(key);
  if (!pending) return { closed: false, profileName: resolvedProfileName };
  sessions.delete(key);
  const session = await pending.catch(() => null);
  await session?.context?.close?.().catch(() => undefined);
  return { closed: Boolean(session), profileName: resolvedProfileName };
}

export async function closeAllBrowserSessions() {
  const pendings = [...sessions.values()];
  sessions.clear();
  const settled = await Promise.allSettled(pendings);
  await Promise.allSettled(
    settled.map((entry) =>
      entry.status === "fulfilled" ? entry.value.context.close() : Promise.resolve(),
    ),
  );
  return { closed: settled.filter((entry) => entry.status === "fulfilled").length };
}

export function listBrowserSessions() {
  return [...sessions.keys()].map((key) => {
    const [userId, profileName] = key.split("\u0000");
    return { userId, profileName };
  });
}
