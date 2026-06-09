/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  DSL_DEFAULTS,
  DSL_PROTOCOL,
  DSL_TYPES,
} from "./constants.js";
import {
  DSL_ERROR_MESSAGE,
  dslMessage,
  dslEdgeUndefinedNode,
  dslError,
  dslLineError,
  normalizeDslLocale,
} from "./error-messages.js";
import { getWorkflowDslDefaultNodeNames } from "../core/i18n.js";

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

function parseAttrs(input = "") {
  const source = Array.isArray(input) ? String(input.join(" ") || "") : String(input || "");
  const attrs = {};
  const matcher = /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/g;
  let match = null;
  while ((match = matcher.exec(source))) {
    const key = String(match[1] || "").trim();
    const value = unquote(String(match[2] || "").trim());
    if (!key) continue;
    attrs[key] = value;
  }
  return attrs;
}

function parseAttachmentRefs(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return [];
  if (["none", "null", "[]"].includes(raw.toLowerCase())) return [];
  return raw
    .split(/[,;，；]/)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
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

export function parseWorkflowDslText(text = "", options = {}) {
  return parseWorkflowDslTextWithOptions(text, options);
}

function resolveDslDefaultNodeNames(locale = "zh-CN") {
  return getWorkflowDslDefaultNodeNames(normalizeDslLocale(locale));
}

export function parseWorkflowDslTextWithOptions(text = "", options = {}) {
  const locale = normalizeDslLocale(options?.locale || "en-US");
  const { startName, endName } = resolveDslDefaultNodeNames(locale);
  const normalized = stripCodeFence(text);
  if (!normalized) {
    throw new Error(dslError(dslMessage(DSL_ERROR_MESSAGE.EMPTY_TEXT, { locale }), { locale }));
  }
  if (/^\s*[\[{]/.test(normalized)) {
    throw new Error(
      dslError(dslMessage(DSL_ERROR_MESSAGE.JSON_NOT_ALLOWED, { locale }), { locale }),
    );
  }

  const lines = normalized
    .split(/\r?\n/)
    .map((line, i) => ({ lineNo: i + 1, text: String(line || "").trim() }))
    .filter((item) => item.text && !item.text.startsWith("#") && !item.text.startsWith("//"));

  const semantic = { nodes: [], flowtos: [], autoActions: [] };
  const attachmentDeclarations = [];
  const attachmentMap = {};
  const nodeSet = new Set();
  let edgeIndex = 0;
  let headerSeen = false;

  function failWithLocale(lineNo = 0, message = "") {
    throw new Error(dslLineError(lineNo, message, { locale }));
  }

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

    if (head === DSL_PROTOCOL.CMD_ATTACHMENT) {
      const attrs = parseAttrs(line.slice(tokens[0].length).trim());
      const id = String(attrs.id || attrs.attachmentId || "").trim();
      if (!id) failWithLocale(lineNo, dslMessage(DSL_ERROR_MESSAGE.ATTACHMENT_ID_REQUIRED, { locale }));
      if (attachmentMap[id]) {
        failWithLocale(
          lineNo,
          dslMessage(DSL_ERROR_MESSAGE.ATTACHMENT_ID_DUPLICATE, {
            locale,
            params: { id },
          }),
        );
      }
      const attachment = {
        id,
        attachmentId: String(attrs.attachmentId || id).trim(),
        name: String(attrs.name || attrs.fileName || id).trim(),
        path: String(attrs.path || "").trim(),
        relativePath: String(attrs.relativePath || attrs.relative || "").trim(),
        mimeType: String(attrs.mimeType || attrs.type || "").trim(),
      };
      attachmentDeclarations.push(attachment);
      attachmentMap[id] = attachment;
      continue;
    }

    if (head === DSL_PROTOCOL.CMD_NODE) {
      const attrs = parseAttrs(line.slice(tokens[0].length).trim());
      const id = String(attrs.id || "").trim();
      const type = String(attrs.type || DSL_TYPES.NODE_STATE).trim().toLowerCase();
      const name = String(attrs.name || id).trim();
      if (!id) failWithLocale(lineNo, dslMessage(DSL_ERROR_MESSAGE.NODE_ID_REQUIRED, { locale }));
      if (nodeSet.has(id)) {
        failWithLocale(
          lineNo,
          dslMessage(DSL_ERROR_MESSAGE.NODE_ID_DUPLICATE, { locale, params: { id } }),
        );
      }
      if (![DSL_TYPES.NODE_STATE, DSL_TYPES.NODE_ACTION].includes(type)) {
        failWithLocale(
          lineNo,
          dslMessage(DSL_ERROR_MESSAGE.NODE_TYPE_INVALID, { locale, params: { type } }),
        );
      }
      nodeSet.add(id);
      const task = String(
        attrs.task || attrs.taskText || attrs.instruction || attrs.mission || "",
      ).trim();
      const attachments = parseAttachmentRefs(
        attrs.attachments || attrs.inputAttachments || attrs.attachmentIds || attrs.files || "",
      );
      semantic.nodes.push({
        id,
        name: name || id,
        type,
        stateType: toStateType(attrs.stateType || attrs.state || ""),
        ...(task ? { task } : {}),
        ...(attachments.length ? { attachments } : {}),
      });
      continue;
    }

    if (head === DSL_PROTOCOL.CMD_EDGE) {
      const attrs = parseAttrs(line.slice(tokens[0].length).trim());
      const from = String(attrs.from || "").trim();
      const to = String(attrs.to || "").trim();
      if (!from || !to) {
        failWithLocale(lineNo, dslMessage(DSL_ERROR_MESSAGE.EDGE_FROM_TO_REQUIRED, { locale }));
      }
      if (String(attrs.when || attrs.condition || "").trim()) {
        failWithLocale(lineNo, dslMessage(DSL_ERROR_MESSAGE.EDGE_CONDITION_UNSUPPORTED, { locale }));
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
      const attrs = parseAttrs(line.slice(tokens[0].length).trim());
      const type = String(attrs.type || DSL_TYPES.AUTO_SUBMIT).trim().toLowerCase();
      if (![DSL_TYPES.AUTO_SUBMIT, DSL_TYPES.AUTO_AUDIT, DSL_TYPES.AUTO_BACK, DSL_TYPES.AUTO_STOP].includes(type)) {
        failWithLocale(
          lineNo,
          dslMessage(DSL_ERROR_MESSAGE.AUTO_TYPE_INVALID, { locale, params: { type } }),
        );
      }
      const stepRaw = attrs.stepIndex ?? attrs.step ?? "0";
      const stepIndex = Number.isFinite(Number(stepRaw)) ? Math.floor(Number(stepRaw)) : 0;
      semantic.autoActions.push({ type, stepIndex });
      continue;
    }

    failWithLocale(
      lineNo,
      dslMessage(DSL_ERROR_MESSAGE.UNKNOWN_COMMAND, { locale, params: { command: head } }),
    );
  }

  if (!headerSeen) {
    throw new Error(
      dslError(dslMessage(DSL_ERROR_MESSAGE.MISSING_HEADER, { locale }), { locale }),
    );
  }

  if (!semantic.nodes.length) {
    throw new Error(dslError(dslMessage(DSL_ERROR_MESSAGE.NO_NODE, { locale }), { locale }));
  }
  if (!semantic.flowtos.length) {
    throw new Error(dslError(dslMessage(DSL_ERROR_MESSAGE.NO_EDGE, { locale }), { locale }));
  }

  if (attachmentDeclarations.length) {
    semantic.attachments = attachmentDeclarations;
    semantic.attachmentMap = attachmentMap;
  }

  for (const edge of semantic.flowtos) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) {
      throw new Error(
        dslError(dslEdgeUndefinedNode(edge.from, edge.to, { locale }), { locale }),
      );
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
      name: startName,
      type: DSL_TYPES.NODE_STATE,
      stateType: DSL_DEFAULTS.STATE_TYPE_START,
    });
  }
  if (!semantic.nodes.some((n) => n.id === DSL_DEFAULTS.END_NODE_ID)) {
    semantic.nodes.push({
      id: DSL_DEFAULTS.END_NODE_ID,
      name: endName,
      type: DSL_TYPES.NODE_STATE,
      stateType: DSL_DEFAULTS.STATE_TYPE_END,
    });
  }

  return semantic;
}
