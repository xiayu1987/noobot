/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const objectValue = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
};

export function normalizeConnectorAccessRequest(request = {}) {
  const connectorId = String(request.connectorId || "").trim();
  const operation = String(request.operation || "").trim();
  if (!connectorId) throw new TypeError("connectorId is required");
  if (!operation) throw new TypeError("connector operation is required");
  return Object.freeze({
    connectorId,
    operation,
    input: Object.freeze({ ...objectValue(request.input, "connector input") }),
  });
}

export function normalizeConnectorAccessResult(result = {}) {
  const source = objectValue(result, "connector result");
  if (typeof source.ok !== "boolean") throw new TypeError("connector result ok must be boolean");
  const attachments = source.attachments ?? [];
  if (!Array.isArray(attachments))
    throw new TypeError("connector result attachments must be an array");
  return Object.freeze({
    ok: source.ok,
    status: String(source.status || (source.ok ? "completed" : "failed")).trim(),
    output: Object.freeze({ ...objectValue(source.output ?? {}, "connector result output") }),
    attachments: Object.freeze([...attachments]),
    diagnostics: Object.freeze({
      ...objectValue(source.diagnostics ?? {}, "connector result diagnostics"),
    }),
  });
}
