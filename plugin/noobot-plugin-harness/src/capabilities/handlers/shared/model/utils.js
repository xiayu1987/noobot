/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function resolvePlanningGuidanceMode(meta = {}) {
  return String(meta?.harness?.planningGuidanceMode || "separate_model").trim().toLowerCase();
}

export function shouldUseSeparateModel(meta = {}) {
  return resolvePlanningGuidanceMode(meta) === "separate_model";
}

export function resolveCapabilityModelInvoker(meta = {}) {
  return typeof meta?.harness?.capabilityModelInvoker === "function"
    ? meta.harness.capabilityModelInvoker
    : null;
}

function normalizeCapabilityModelMap(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, value]) => [
        String(key || "").trim(),
        String(
          value && typeof value === "object" && !Array.isArray(value)
            ? value.model
            : value || "",
        ).trim(),
      ])
      .filter(([key, value]) => key && value),
  );
}

export function resolveCapabilityModelName(meta = {}, { purpose = "", domain = "" } = {}) {
  const byPurpose = {
    ...normalizeCapabilityModelMap(meta?.harness?.capabilityModelByPurpose),
    ...normalizeCapabilityModelMap(meta?.harness?.stepModels),
  };
  const normalizedPurpose = String(purpose || "").trim();
  const normalizedDomain = String(domain || "").trim();
  const lowerPurpose = normalizedPurpose.toLowerCase();
  const candidates = [
    normalizedPurpose,
    lowerPurpose,
    lowerPurpose.includes("planning") ? "planning" : "",
    lowerPurpose.includes("acceptance") ? "acceptance" : "",
    lowerPurpose === "summary" ? "summary" : "",
    lowerPurpose.includes("guidance") ? "guidance" : "",
    normalizedDomain,
    normalizedDomain.toLowerCase(),
    "default",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (byPurpose[candidate]) return byPurpose[candidate];
  }
  return "";
}

function collectPayloadMessages(payloadMessages = null) {
  if (!payloadMessages || typeof payloadMessages !== "object" || Array.isArray(payloadMessages)) {
    return [];
  }
  return [
    ...(Array.isArray(payloadMessages.system) ? payloadMessages.system : []),
    ...(Array.isArray(payloadMessages.history) ? payloadMessages.history : []),
    ...(Array.isArray(payloadMessages.incremental) ? payloadMessages.incremental : []),
  ];
}

function shouldUsePayloadMessageFallback(purpose = "") {
  const normalizedPurpose = String(purpose || "").trim().toLowerCase();
  return (
    normalizedPurpose.includes("acceptance") ||
    normalizedPurpose.includes("review") ||
    normalizedPurpose.includes("final")
  );
}

function resolveContextMessages(ctx = {}, { includePayloadMessages = false } = {}) {
  if (Array.isArray(ctx?.messages) && ctx.messages.length) return ctx.messages;
  if (!includePayloadMessages) return [];
  const agentPayloadMessages = collectPayloadMessages(ctx?.agentContext?.payload?.messages);
  if (agentPayloadMessages.length) return agentPayloadMessages;
  const runtimePayloadMessages = collectPayloadMessages(ctx?.runtimeAgentContext?.payload?.messages);
  if (runtimePayloadMessages.length) return runtimePayloadMessages;
  return [];
}

function resolveAgentModelMessages(ctx = {}, fallbackMessages = [], { includePayloadMessages = false } = {}) {
  if (Array.isArray(fallbackMessages) && fallbackMessages.length) {
    return fallbackMessages;
  }
  return resolveContextMessages(ctx, { includePayloadMessages });
}

export function resolveCapabilityModelMessages(
  meta = {},
  { ctx = {}, purpose = "", messages = [] } = {},
) {
  const includePayloadMessages = shouldUsePayloadMessageFallback(purpose);
  const sourceMessages = Array.isArray(messages) && messages.length
    ? messages
    : resolveContextMessages(ctx, { includePayloadMessages });
  const resolver = meta?.harness?.resolveModelMessages;
  if (typeof resolver === "function") {
    try {
      const resolved = resolver({
        ctx,
        purpose: String(purpose || "").trim(),
        messages: sourceMessages,
      });
      if (Array.isArray(resolved)) return resolved;
    } catch {
      // fall through to local compatibility fallback
    }
  }
  return resolveAgentModelMessages(ctx, sourceMessages, { includePayloadMessages });
}

export function resolveCapabilityToolAllowlist(meta = {}, purpose = "") {
  const normalizedPurpose = String(purpose || "").trim();
  const byPurpose =
    meta?.harness?.capabilityToolAllowlistByPurpose &&
    typeof meta.harness.capabilityToolAllowlistByPurpose === "object"
      ? meta.harness.capabilityToolAllowlistByPurpose
      : {};
  const scoped = Array.isArray(byPurpose?.[normalizedPurpose]) ? byPurpose[normalizedPurpose] : null;
  if (scoped) {
    const normalized = scoped.map((item) => String(item || "").trim()).filter(Boolean);
    if (normalized.includes("*")) return ["*"];
    return normalized;
  }
  const globalAllowlist = Array.isArray(meta?.harness?.capabilityToolAllowlist)
    ? meta.harness.capabilityToolAllowlist
    : [];
  const normalized = globalAllowlist.map((item) => String(item || "").trim()).filter(Boolean);
  if (normalized.includes("*")) return ["*"];
  return normalized;
}

export function resolvePlanningToolAllowlist(meta = {}) {
  const allowlist = resolveCapabilityToolAllowlist(meta, "planning");
  if (!Array.isArray(allowlist) || !allowlist.length) return [];
  if (allowlist.includes("*")) return ["*"];
  return allowlist;
}
