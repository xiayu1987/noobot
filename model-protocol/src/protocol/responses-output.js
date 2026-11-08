/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { ModelProtocolError } from "./error.js";

function requireStructure(valid, path, expected, responseId) {
  if (!valid)
    throw new ModelProtocolError(`Responses ${path} requires ${expected}`, {
      details: { responseId, path },
    });
}

function requireTypedObject(value, path, responseId) {
  requireStructure(
    isPlainObject(value) && typeof value.type === "string" && value.type.trim().length > 0,
    path,
    "an object with a non-empty type",
    responseId,
  );
}

function requireTypedArray(value, path, responseId, visit) {
  requireStructure(Array.isArray(value), path, "an array", responseId);
  for (let index = 0; index < value.length; index++) {
    const itemPath = `${path}[${index}]`;
    requireTypedObject(value[index], itemPath, responseId);
    if (visit) visit(value[index], itemPath, responseId);
  }
}

function requireContent(part, path, responseId) {
  if (part.type === "output_text") {
    requireStructure(typeof part.text === "string", `${path}.text`, "a string", responseId);
    requireTypedArray(part.annotations, `${path}.annotations`, responseId);
  } else if (part.type === "refusal") {
    requireStructure(typeof part.refusal === "string", `${path}.refusal`, "a string", responseId);
  }
}

function requireSummary(part, path, responseId) {
  requireStructure(typeof part.text === "string", `${path}.text`, "a string", responseId);
}

function requireOutputItem(item, path, responseId) {
  if (item.type === "message")
    requireTypedArray(item.content, `${path}.content`, responseId, requireContent);
  else if (item.type === "reasoning")
    requireTypedArray(item.summary, `${path}.summary`, responseId, requireSummary);
}

export function requireResponsesOutput(response) {
  requireStructure(Array.isArray(response.output), "output", "an output array", response.id);
  requireTypedArray(response.output, "output", response.id, requireOutputItem);
}
