/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveAgentContextIdentity } from "./agent-context-identity.js";

export function getAgentContextIdentity(context = {}) {
  return resolveAgentContextIdentity(context);
}

export function getAgentContextWorkspace(context = {}) {
  return context?.environment?.workspace || {};
}

export function getAgentContextModelContext(context = {}) {
  return context?.modelContext || null;
}

export function getAgentContextExecutionFlags(context = {}) {
  return context?.execution?.flags || {};
}
