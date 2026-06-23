/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/

export function unquoteWorkflowDslValue(value = "") {
  const text = String(value || "").trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\"/g, '"');
  }
  return text;
}

export function parseWorkflowDslAttributes(line = "") {
  const attrs = {};
  const pattern = /(\w+)=("[^"]*"|\S+)/g;
  let match = pattern.exec(String(line || ""));
  while (match) {
    attrs[match[1]] = unquoteWorkflowDslValue(match[2]);
    match = pattern.exec(String(line || ""));
  }
  return attrs;
}

export function normalizeDslStateType(value = "", nodeId = "") {
  const normalized = String(value || nodeId || "").trim().toLowerCase();
  if (normalized === "start") return 0;
  if (normalized === "end") return 1;
  if (normalized === "branch") return 2;
  if (normalized === "merge") return 3;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function parseWorkflowDslPayload(content = "") {
  const text = String(content || "").trim();
  if (!text.startsWith("WORKFLOW_DSL/")) return null;
  const nodes = [];
  const flowtos = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = String(rawLine || "").trim();
    if (!line || line.startsWith("WORKFLOW_DSL/") || line === "END") continue;
    if (line.startsWith("NODE ")) {
      const attrs = parseWorkflowDslAttributes(line);
      const id = String(attrs.id || "").trim();
      const type = String(attrs.type || "").trim();
      if (!id || !type) continue;
      nodes.push({
        id,
        type,
        name: String(attrs.name || id).trim(),
        task: String(attrs.task || "").trim(),
        ...(type.toLowerCase() === "state"
          ? { stateType: normalizeDslStateType(attrs.stateType, id) }
          : {}),
      });
    } else if (line.startsWith("EDGE ")) {
      const attrs = parseWorkflowDslAttributes(line);
      const from = String(attrs.from || "").trim();
      const to = String(attrs.to || "").trim();
      if (from && to) flowtos.push({ from, to });
    }
  }
  if (!nodes.length) return null;
  return {
    semantic: { nodes, flowtos },
    interaction: { semanticTextPreview: text },
  };
}
