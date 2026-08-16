/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveModelFinalMessages } from "../policy/window-reducer.js";
import { MODEL_CONTEXT_PROTOCOL_VERSION } from "../agent-context/agent-context-schema.js";

export const MODEL_CONTEXT_LANE = Object.freeze({
  PRIMARY: "primary",
  AUXILIARY: "auxiliary",
});

function normalizeRole(message = {}) {
  const role = String(message?.role || message?.lc_kwargs?.role || "")
    .trim()
    .toLowerCase();
  if (role === "developer") return "system";
  if (role === "human") return "user";
  if (role === "ai") return "assistant";
  return role;
}

function isSystemRole(message = {}) {
  return normalizeRole(message) === "system";
}

function requireMessage(message = {}, label = "message") {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new TypeError(`${label} must be a message object`);
  }
  if (!normalizeRole(message)) throw new TypeError(`${label}.role is required`);
  return message;
}

function normalizeDeclaredMessages(items = [], defaultRole = "system", label = "messages") {
  if (!Array.isArray(items)) throw new TypeError(`${label} must be an array`);
  return items
    .map((item, index) => {
      if (typeof item === "string") {
        const content = item.trim();
        return content ? { role: defaultRole, content } : null;
      }
      return requireMessage(item, `${label}[${index}]`);
    })
    .filter(Boolean);
}

function projectSourceMessages(sourceMessages = [], projectSourceMessage = null) {
  if (!Array.isArray(sourceMessages)) throw new TypeError("sourceMessages must be an array");
  const projector =
    typeof projectSourceMessage === "function" ? projectSourceMessage : (message) => message;
  return sourceMessages.flatMap((message, index) => {
    const projected = projector(message, index);
    const items = Array.isArray(projected) ? projected : projected ? [projected] : [];
    return items.map((item, itemIndex) =>
      requireMessage(item, `projectedSourceMessages[${index}][${itemIndex}]`),
    );
  });
}

function projectPrimaryBlock(messages = [], projectPrimaryMessage = null, blockName = "") {
  const projector =
    typeof projectPrimaryMessage === "function" ? projectPrimaryMessage : (message) => message;
  return (Array.isArray(messages) ? messages : [])
    .map((message, index) => projector(message, { blockName, index }))
    .filter(Boolean);
}

export function buildDualLaneModelContext({
  lane = "",
  modelContext = null,
  sourceMessages = [],
  protocolSystemMessages = [],
  taskMessages = [],
  projectSourceMessage = null,
  projectPrimaryMessage = null,
  primaryHistoryLimit = Number.POSITIVE_INFINITY,
} = {}) {
  const normalizedLane = String(lane || "").trim();
  if (normalizedLane === MODEL_CONTEXT_LANE.PRIMARY) {
    if (Number(modelContext?.protocolVersion) !== MODEL_CONTEXT_PROTOCOL_VERSION) {
      throw new TypeError(
        `primary model context requires protocolVersion=${MODEL_CONTEXT_PROTOCOL_VERSION}`,
      );
    }
    const blocks = modelContext?.messageBlocks;
    if (!blocks || typeof blocks !== "object" || Array.isArray(blocks)) {
      throw new TypeError("primary model context requires authoritative messageBlocks");
    }
    const materialized = resolveModelFinalMessages({
      systemMessages: projectPrimaryBlock(blocks.system, projectPrimaryMessage, "system"),
      historyMessages: projectPrimaryBlock(blocks.history, projectPrimaryMessage, "history"),
      incrementalMessages: projectPrimaryBlock(
        blocks.incremental,
        projectPrimaryMessage,
        "incremental",
      ),
      historyLimit: primaryHistoryLimit,
    });
    return {
      lane: MODEL_CONTEXT_LANE.PRIMARY,
      messageBlocks: {
        system: materialized.system,
        history: materialized.history,
        incremental: materialized.incremental,
      },
      messages: materialized.messages,
    };
  }
  if (normalizedLane !== MODEL_CONTEXT_LANE.AUXILIARY) {
    throw new TypeError(`unsupported model context lane: ${normalizedLane || "<empty>"}`);
  }

  const projectedSource = projectSourceMessages(sourceMessages, projectSourceMessage);
  const sourceSystem = projectedSource.filter(isSystemRole);
  const history = projectedSource.filter((message) => !isSystemRole(message));
  const declaredSystem = normalizeDeclaredMessages(
    protocolSystemMessages,
    "system",
    "protocolSystemMessages",
  );
  if (declaredSystem.some((message) => !isSystemRole(message))) {
    throw new TypeError("protocolSystemMessages accepts only system messages");
  }
  const incremental = normalizeDeclaredMessages(taskMessages, "user", "taskMessages");
  if (incremental.some(isSystemRole)) {
    throw new TypeError("taskMessages cannot contain system messages");
  }
  const system = [...sourceSystem, ...declaredSystem];
  return {
    lane: MODEL_CONTEXT_LANE.AUXILIARY,
    messageBlocks: { system, history, incremental },
    messages: [...system, ...history, ...incremental],
  };
}
