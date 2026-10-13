/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { writeRuntimeEvent } from "@noobot/runtime-events";
import { joinClientPath } from "../../path-resolver.js";

const SENSITIVE_KEY_PATTERN =
  /(token|cookie|authorization|secret|apikey|apiKey|headers|body|url|href|password|path|file)/i;

export function getDesktopRuntimeEventsRoot(app) {
  if (!app || typeof app.getPath !== "function") {
    throw new Error("getDesktopRuntimeEventsRoot requires an Electron app");
  }
  return joinClientPath(app.getPath("userData"), "runtime", "events");
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

export function createDesktopRuntimeEventWriter({ app } = {}) {
  const root = getDesktopRuntimeEventsRoot(app);
  function write(event = {}, fields = {}) {
    return writeRuntimeEvent(
      {
        source: "desktop",
        scope: event.scope,
        category: event.category,
        level: event.level,
        event: event.event,
        data: sanitizeDesktopRuntimeEventData({ ...(event.data || {}), ...(fields || {}) }),
      },
      { desktopRoot: root },
    );
  }
  return { runtimeEventsRoot: root, write };
}
