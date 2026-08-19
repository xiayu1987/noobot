/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function extractJsonBodies(text = "") {
  const bodies = [];
  let cursor = 0;
  while (cursor < text.length) {
    const bodyIndex = text.indexOf("Body:", cursor);
    if (bodyIndex < 0) break;
    const start = text.indexOf("{", bodyIndex);
    if (start < 0) break;
    let depth = 0;
    let quote = "";
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (quote) {
        if (char === "\\") index += 1;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}" && --depth === 0) {
        bodies.push(text.slice(start, index + 1));
        cursor = index + 1;
        break;
      }
    }
    if (cursor <= start) break;
  }
  return bodies;
}

function messageRole(message = {}) {
  return String(message?.role || message?.lc_kwargs?.role || "")
    .trim()
    .toLowerCase();
}

function isSystemLike(message) {
  const role = messageRole(message);
  return role === "system" || role === "developer";
}

function hasOnlyHarnessSystem(messages) {
  const systemMessages = messages.filter(isSystemLike);
  return (
    systemMessages.length > 0 &&
    systemMessages.every((message) => {
      const content = String(message?.content || "");
      return (
        content.includes("HARNESS_POLICY_SELECTION") ||
        content.includes("noobot-harness-current-task-goal") ||
        content.includes("[CURRENT_TASK_GOAL]")
      );
    })
  );
}

function findLateSystemMessages(messages) {
  let seenConversation = false;
  const late = [];
  messages.forEach((message, index) => {
    if (!isSystemLike(message)) {
      seenConversation = true;
      return;
    }
    if (!seenConversation) return;
    const content =
      typeof message?.content === "string"
        ? message.content
        : JSON.stringify(message?.content ?? "");
    late.push(
      `${index}:${messageRole(message)}:${String(content).slice(0, 80).replace(/\s+/g, " ")}`,
    );
  });
  return late;
}

export function validateRequestLogOrder(logPath = "", { fail, pass }) {
  const fullPath = path.isAbsolute(logPath) ? logPath : path.join(process.cwd(), logPath);
  if (!existsSync(fullPath)) {
    fail(`missing request log: ${logPath}`);
    return;
  }
  const bodies = extractJsonBodies(readFileSync(fullPath, "utf8"));
  if (!bodies.length) {
    fail(`request log has no parseable Body JSON: ${logPath}`);
    return;
  }
  let checked = 0;
  for (const [bodyIndex, bodyText] of bodies.entries()) {
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (error) {
      fail(`request log Body JSON parse failed: ${logPath}`, error?.message || String(error));
      continue;
    }
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    if (!messages.length) continue;
    checked += 1;
    if (!messages.some(isSystemLike)) {
      fail(
        `request log missing constructed system block: ${logPath} Body#${bodyIndex + 1}`,
        "model request must include constructed system/developer messages before history/incremental.",
      );
    } else if (hasOnlyHarnessSystem(messages)) {
      fail(
        `request log system block only contains harness injections: ${logPath} Body#${bodyIndex + 1}`,
        "constructed agent system context was not present; harness policy/goal cannot replace system.",
      );
    }
    const late = findLateSystemMessages(messages);
    if (late.length) {
      fail(
        `request log order violation: ${logPath} Body#${bodyIndex + 1}`,
        `system/developer must be before history/incremental, but found after conversation:\n  ${late.join("\n  ")}`,
      );
    }
  }
  if (checked) pass(`request log order checked: ${logPath}`);
}
