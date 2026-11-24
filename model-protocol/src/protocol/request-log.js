/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function formatModelRequestBodyCompleteness(complete) {
  if (typeof complete !== "boolean")
    throw new TypeError("Request body completeness must be boolean");
  return `BodyComplete: ${complete}`;
}

export function readModelRequestBodyCompleteness(headerText) {
  const fields = [...headerText.matchAll(/^BodyComplete: (.*)$/gm)];
  if (fields.length !== 1 || !["true", "false"].includes(fields[0][1]))
    throw new Error("Request log requires exactly one boolean BodyComplete field");
  return fields[0][1] === "true";
}

export function validateModelIncompleteRequestTerminal(requestHeader, terminalHeaders) {
  const readField = (header, name) => {
    const fields = [...header.matchAll(new RegExp(`^${name}: (.*)$`, "gm"))];
    if (fields.length !== 1 || !fields[0][1].trim())
      throw new Error(`Request log requires exactly one nonempty ${name} field`);
    return fields[0][1];
  };
  const requestId = readField(requestHeader, "RequestId");
  const matching = terminalHeaders.filter((header) => readField(header, "RequestId") === requestId);
  if (matching.length !== 1)
    throw new Error(`Incomplete request ${requestId} requires exactly one matching terminal`);
  const terminal = matching[0];
  for (const name of ["Model", "Flow", "SessionId", "ParentSessionId"]) {
    if (readField(requestHeader, name) !== readField(terminal, name))
      throw new Error(`Incomplete request ${requestId} terminal ${name} mismatch`);
  }
  const outcome = readField(terminal, "Outcome");
  if (
    ![
      "client_aborted",
      "proxy_error",
      "upstream_aborted",
      "upstream_error",
      "response_decode_error",
    ].includes(outcome)
  )
    throw new Error(`Incomplete request ${requestId} requires an error terminal, got ${outcome}`);
}
