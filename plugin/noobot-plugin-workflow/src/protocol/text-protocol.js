/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { DSL_DEFAULTS, DSL_ERROR, DSL_PROTOCOL, DSL_TYPES } from "./constants.js";
import {
  DSL_ERROR_MESSAGE,
  dslEdgeUndefinedNode,
  dslError,
  dslLineError,
} from "./error-messages.js";

function stripCodeFence(text = "") {
  const trimmed = String(text || "").trim();
  const match = trimmed.match(/^```(?:text|plain|workflow)?\s*([\s\S]*?)\s*```$/i);
  return match ? String(match[1] || "").trim() : trimmed;
}

function tokenize(line = "") {
  return String(line || "").match(/"[^"]*"|'[^']*'|\S+/g) || [];
}

function unquote(value = "") {
  const raw = String(value || "").trim();
  if (
    (raw.startsWith("\"") && raw.endsWith("\"")) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function parseAttrs(tokens = []) {
  const attrs = {};
  for (const token of tokens) {
    const idx = String(token).indexOf("=");
    if (idx <= 0) continue;
    const key = String(token.slice(0, idx)).trim();
    const value = unquote(String(token.slice(idx + 1)).trim());
    if (!key) continue;
    attrs[key] = value;
  }
  return attrs;
}

function toStateType(value = "") {
  const key = String(value || "").trim().toLowerCase();
  if (key === "start") return 0;
  if (key === "end") return 1;
  if (key === "branch") return 2;
  if (key === "merge") return 3;
  if (key === "normal") return 0;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return 0;
}

function fail(lineNo = 0, message = "") {
  throw new Error(dslLineError(lineNo, message));
}

export function parseWorkflowDslText(text = "") {
  const normalized = stripCodeFence(text);
  if (!normalized) throw new Error(dslError(DSL_ERROR_MESSAGE.EMPTY_TEXT));
  if (/^\s*[\[{]/.test(normalized)) {
    throw new Error(dslError(DSL_ERROR.JSON_NOT_ALLOWED));
  }

  const lines = normalized
    .split(/\r?\n/)
    .map((line, i) => ({ lineNo: i + 1, text: String(line || "").trim() }))
    .filter((item) => item.text && !item.text.startsWith("#") && !item.text.startsWith("//"));

  const semantic = { nodes: [], flowtos: [], autoActions: [] };
  const nodeSet = new Set();
  let edgeIndex = 0;
  let headerSeen = false;

  for (const item of lines) {
    const { lineNo, text: line } = item;
    const tokens = tokenize(line);
    if (!tokens.length) continue;
    const head = String(tokens[0] || "").trim().toUpperCase();

    if (
      head === DSL_PROTOCOL.HEADER ||
      (head === DSL_PROTOCOL.LEGACY_HEADER_KEYWORD &&
        String(tokens[1] || "") === DSL_PROTOCOL.LEGACY_HEADER_VERSION)
    ) {
      headerSeen = true;
      continue;
    }
    if (head === DSL_PROTOCOL.CMD_END) break;

    if (head === DSL_PROTOCOL.CMD_NODE) {
      const attrs = parseAttrs(tokens.slice(1));
      const id = String(attrs.id || "").trim();
      const type = String(attrs.type || DSL_TYPES.NODE_STATE).trim().toLowerCase();
      const name = String(attrs.name || id).trim();
      if (!id) fail(lineNo, DSL_ERROR_MESSAGE.NODE_ID_REQUIRED);
      if (nodeSet.has(id)) fail(lineNo, `duplicate NODE id: ${id}`);
      if (![DSL_TYPES.NODE_STATE, DSL_TYPES.NODE_ACTION].includes(type)) {
        fail(lineNo, `NODE type must be state/action, got: ${type}`);
      }
      nodeSet.add(id);
      const task = String(
        attrs.task || attrs.taskText || attrs.instruction || attrs.mission || "",
      ).trim();
      semantic.nodes.push({
        id,
        name: name || id,
        type,
        stateType: toStateType(attrs.stateType || attrs.state || ""),
        ...(task ? { task } : {}),
      });
      continue;
    }

    if (head === DSL_PROTOCOL.CMD_EDGE) {
      const attrs = parseAttrs(tokens.slice(1));
      const from = String(attrs.from || "").trim();
      const to = String(attrs.to || "").trim();
      if (!from || !to) fail(lineNo, DSL_ERROR_MESSAGE.EDGE_FROM_TO_REQUIRED);
      if (String(attrs.when || attrs.condition || "").trim()) {
        fail(lineNo, "EDGE condition is not supported");
      }
      edgeIndex += 1;
      semantic.flowtos.push({
        from,
        to,
        name: String(attrs.name || `${from}->${to}#${edgeIndex}`).trim(),
      });
      continue;
    }

    if (head === DSL_PROTOCOL.CMD_AUTO) {
      const attrs = parseAttrs(tokens.slice(1));
      const type = String(attrs.type || DSL_TYPES.AUTO_SUBMIT).trim().toLowerCase();
      if (![DSL_TYPES.AUTO_SUBMIT, DSL_TYPES.AUTO_AUDIT, DSL_TYPES.AUTO_BACK, DSL_TYPES.AUTO_STOP].includes(type)) {
        fail(lineNo, `AUTO type invalid: ${type}`);
      }
      const stepRaw = attrs.stepIndex ?? attrs.step ?? "0";
      const stepIndex = Number.isFinite(Number(stepRaw)) ? Math.floor(Number(stepRaw)) : 0;
      semantic.autoActions.push({ type, stepIndex });
      continue;
    }

    fail(lineNo, `unknown command: ${head}`);
  }

  if (!headerSeen) {
    throw new Error(dslError(DSL_ERROR_MESSAGE.MISSING_HEADER));
  }

  if (!semantic.nodes.length) throw new Error(dslError(DSL_ERROR_MESSAGE.NO_NODE));
  if (!semantic.flowtos.length) throw new Error(dslError(DSL_ERROR_MESSAGE.NO_EDGE));

  for (const edge of semantic.flowtos) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) {
      throw new Error(dslError(dslEdgeUndefinedNode(edge.from, edge.to)));
    }
  }

  // Robustness for LLM generated DSL: the workflow engine only allows multiple
  // simultaneously valid outgoing edges from a branch state (stateType=2), and
  // multi-branch joins should be represented as merge states (stateType=3).
  // Normalize common valid-intent DSL such as `start -> taskA` and `start -> taskB`
  // where the model forgot to mark `start` as branch.
  const outgoingCount = new Map();
  const incomingCount = new Map();
  for (const edge of semantic.flowtos) {
    outgoingCount.set(edge.from, Number(outgoingCount.get(edge.from) || 0) + 1);
    incomingCount.set(edge.to, Number(incomingCount.get(edge.to) || 0) + 1);
  }
  for (const node of semantic.nodes) {
    if (String(node?.type || DSL_TYPES.NODE_STATE).trim().toLowerCase() !== DSL_TYPES.NODE_STATE) {
      continue;
    }
    const id = String(node?.id || "").trim();
    if (Number(outgoingCount.get(id) || 0) > 1 && Number(node.stateType) === 0) {
      node.stateType = 2;
    }
    if (Number(incomingCount.get(id) || 0) > 1 && Number(node.stateType) === 1) {
      node.stateType = 3;
    }
  }

  if (!semantic.nodes.some((n) => n.id === DSL_DEFAULTS.START_NODE_ID)) {
    semantic.nodes.unshift({
      id: DSL_DEFAULTS.START_NODE_ID,
      name: DSL_DEFAULTS.START_NODE_NAME,
      type: DSL_TYPES.NODE_STATE,
      stateType: DSL_DEFAULTS.STATE_TYPE_START,
    });
  }
  if (!semantic.nodes.some((n) => n.id === DSL_DEFAULTS.END_NODE_ID)) {
    semantic.nodes.push({
      id: DSL_DEFAULTS.END_NODE_ID,
      name: DSL_DEFAULTS.END_NODE_NAME,
      type: DSL_TYPES.NODE_STATE,
      stateType: DSL_DEFAULTS.STATE_TYPE_END,
    });
  }

  return semantic;
}
