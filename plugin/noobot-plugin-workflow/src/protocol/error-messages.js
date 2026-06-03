/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { DSL_ERROR, DSL_PROTOCOL } from "./constants.js";

export const DSL_ERROR_MESSAGE = Object.freeze({
  EMPTY_TEXT: "empty text",
  MISSING_HEADER: `missing protocol header '${DSL_PROTOCOL.HEADER}'`,
  NO_NODE: "no NODE",
  NO_EDGE: "no EDGE",
  NODE_ID_REQUIRED: "NODE requires id=<id>",
  EDGE_FROM_TO_REQUIRED: "EDGE requires from=<id> to=<id>",
});

export function dslError(message = "") {
  return `${DSL_ERROR.PREFIX}: ${String(message || "").trim()}`;
}

export function dslLineError(lineNo = 0, message = "") {
  return `${DSL_ERROR.PREFIX} (line ${lineNo}): ${String(message || "").trim()}`;
}

export function dslEdgeUndefinedNode(from = "", to = "") {
  return `EDGE references undefined node (${String(from || "").trim()} -> ${String(to || "").trim()})`;
}
