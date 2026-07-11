/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { writeRoutedRuntimeEvent } from "@noobot/runtime-events";
import { joinClientPath } from "../path-resolver.js";

const DESKTOP_RUNTIME_EVENTS_ROOT_ENV = "NOOBOT_RUNTIME_EVENTS_ROOT";
const SENSITIVE_KEY_PATTERN = /(token|cookie|authorization|secret|apikey|apiKey|headers|body|url|href|password|path|file)/i;

export function getDesktopRuntimeEventsRoot(app) {
  if (!app || typeof app.getPath !== "function") {
    throw new Error("getDesktopRuntimeEventsRoot requires an Electron app");
  }
  return joinClientPath(app.getPath("userData"), "runtime", "events");
}

export function initializeDesktopRuntimeEvents(app, { env = process.env, runtimeEventsRoot } = {}) {
  const root = runtimeEventsRoot || getDesktopRuntimeEventsRoot(app);
  if (!env[DESKTOP_RUNTIME_EVENTS_ROOT_ENV]) {
    env[DESKTOP_RUNTIME_EVENTS_ROOT_ENV] = root;
  }
  return env[DESKTOP_RUNTIME_EVENTS_ROOT_ENV];
}

function sanitizeDesktopValue(key, value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (value instanceof Error) {
    return {
      errorName: value.name,
      errorCode: value.code,
      errorMessage: String(value.message || "").slice(0, 500),
    };
  }
  if (SENSITIVE_KEY_PATTERN.test(String(key))) {
    if (key === "url" || key === "href") {
      try {
        const parsed = new URL(String(value));
        return { protocol: parsed.protocol, host: parsed.host, pathname: parsed.pathname };
      } catch {
        return { valueLength: String(value).length };
      }
    }
    return { valueLength: String(value).length };
  }
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return { itemCount: value.length };
  if (typeof value === "object") return { keys: Object.keys(value).slice(0, 50) };
  return String(value).slice(0, 500);
}

export function sanitizeDesktopRuntimeEventData(fields = {}) {
  const data = {};
  for (const [key, value] of Object.entries(fields || {})) {
    const sanitized = sanitizeDesktopValue(key, value);
    if (sanitized !== undefined) data[key] = sanitized;
  }
  return data;
}

export function createDesktopRuntimeEventWriter({ app, runtimeEventsRoot, env = process.env } = {}) {
  const root = initializeDesktopRuntimeEvents(app, { env, runtimeEventsRoot });
  function write(event = {}, fields = {}, options = {}) {
    const record = {
      source: "desktop",
      scope: event.scope || options.scope || "system",
      category: event.category || options.category || "system",
      level: event.level || options.level || "info",
      event: event.event || event.name,
      data: sanitizeDesktopRuntimeEventData({ ...(event.data || {}), ...(fields || {}) }),
    };
    if (!record.event) return Promise.resolve({ ok: false, error: new Error("Desktop runtime event name is required") });
    return writeRoutedRuntimeEvent(record, { runtimeEventsRoot: root, throwOnError: false });
  }
  return { runtimeEventsRoot: root, write };
}
