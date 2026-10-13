/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function sliceJsonObject(text = "", start = 0) {
  let depth = 0;
  let quote = "";
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"') quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return text.slice(start, index + 1);
  }
  return text.slice(start);
}

function extractRequestBodies(text = "") {
  const bodies = [];
  for (const entry of text.split(/^(?=\[(?:Request|Terminal)\]\s*$)/m)) {
    if (!entry.startsWith("[Request]")) continue;
    const bodyIndex = entry.search(/^Body:/m);
    if (bodyIndex < 0) continue;
    const start = entry.indexOf("{", bodyIndex);
    bodies.push({
      text: start < 0 ? "" : sliceJsonObject(entry, start),
      operationKind: requestOperationKind(entry.slice(0, bodyIndex)),
    });
  }
  return bodies;
}

function requestOperationKind(headerText = "") {
  const match = headerText.match(/"x-model-operation"\s*:\s*"([^"]*)"/i);
  return String(match?.[1] || "chat")
    .trim()
    .toLowerCase();
}

function requestMessages(body = {}) {
  if (Array.isArray(body?.messages)) return body.messages;
  const input =
    typeof body?.input === "string"
      ? [{ role: "user", content: body.input }]
      : Array.isArray(body?.input)
        ? body.input
        : [];
  const instructions = String(body?.instructions || "").trim();
  return instructions ? [{ role: "system", content: instructions }, ...input] : input;
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
  const bodies = extractRequestBodies(readFileSync(fullPath, "utf8"));
  let checked = 0;
  for (const [bodyIndex, { text: bodyText, operationKind }] of bodies.entries()) {
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (error) {
      fail(`request log Body JSON parse failed: ${logPath}`, error?.message || String(error));
      continue;
    }
    const messages = requestMessages(body);
    if (!messages.length) continue;
    checked += 1;
    const requiresConstructedSystem = operationKind === "chat";
    if (requiresConstructedSystem && !messages.some(isSystemLike)) {
      fail(
        `request log missing constructed system block: ${logPath} Body#${bodyIndex + 1}`,
        "model request must include constructed system/developer messages before history/incremental.",
      );
    } else if (requiresConstructedSystem && hasOnlyHarnessSystem(messages)) {
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
  if (checked) pass(`request log order checked: ${logPath} (${checked} requests)`);
  else fail(`request log has no auditable request messages: ${logPath}`);
}
