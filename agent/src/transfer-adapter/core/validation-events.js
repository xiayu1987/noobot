/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../events/index.js";
import { runAgentRuntimeHook } from "../../extensions/hooks/index.js";
import { HOOK_POINT } from "@noobot/hook-protocol";

function normalizeString(value = "") {
  return String(value || "").trim();
}

export async function emitSemanticTransferValidation({
  runtime = {},
  eventListener = null,
  scenario = "",
  stats = {},
  transferValidation = {},
} = {}) {
  const listener = eventListener || runtime?.eventListener || null;
  const payload = {
    scenario: normalizeString(scenario) || "unknown",
    inputCount: Number(stats?.inputCount || transferValidation?.inputCount || 0),
    outputCount: Number(stats?.outputCount || transferValidation?.outputCount || 0),
    filteredCount: Number(stats?.filteredCount || transferValidation?.filteredCount || 0),
    invalidCount: Number(stats?.invalidCount || transferValidation?.invalidCount || 0),
    strict: Boolean(stats?.strict ?? transferValidation?.strict),
    enforceProtocol: Boolean(stats?.enforceProtocol ?? transferValidation?.enforceProtocol),
  };
  emitEvent(listener, "semantic_transfer_validation", payload);
  await runAgentRuntimeHook({
    runtime,
    point: HOOK_POINT.AGENT.SEMANTIC_TRANSFER_VALIDATION,
    context: {
      phase: "semantic_transfer",
      status: payload.invalidCount > 0 ? "warning" : "success",
      ...payload,
    },
    eventListener: listener,
  });
  return payload;
}
