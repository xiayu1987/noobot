/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, text, isFunction } from "@noobot/shared/value";
import { HARNESS_PLANNING_GUIDANCE_MODE } from "../../../../core/constants.js";

export function resolvePlanningGuidanceMode(meta = {}) {
  return meta.harness.planningGuidanceMode;
}

export function shouldUseSeparateModel(meta = {}) {
  return resolvePlanningGuidanceMode(meta) === HARNESS_PLANNING_GUIDANCE_MODE.SEPARATE_MODEL;
}

export function readCapabilityModelInvoker(meta = {}) {
  return meta.harness.capabilityModelInvoker;
}

function normalizeCapabilityModelMap(source = {}) {
  if (!isPlainObject(source)) return {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, value]) => [
        text(key),
        String(isPlainObject(value) ? value.model : value || "").trim(),
      ])
      .filter(([key, value]) => key && value),
  );
}

export function resolveCapabilityModelName(meta = {}, { purpose = "", domain = "" } = {}) {
  const byPurpose = {
    ...normalizeCapabilityModelMap(meta?.harness?.capabilityModelByPurpose),
    ...normalizeCapabilityModelMap(meta?.harness?.stepModels),
  };
  const normalizedPurpose = text(purpose);
  const normalizedDomain = text(domain);
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

export function resolveCapabilityModelMessages(meta = {}, { ctx = {}, purpose = "" } = {}) {
  const resolver = meta?.harness?.resolveModelMessages;
  if (!isFunction(resolver)) {
    throw new Error("capability model messages require the authoritative modelContext resolver");
  }
  const resolved = resolver({
    ctx,
    purpose: text(purpose),
  });
  if (!Array.isArray(resolved)) {
    throw new Error("authoritative modelContext resolver must return a message array");
  }
  return resolved;
}

export function resolveCapabilityToolAllowlist(meta = {}, purpose = "") {
  const normalizedPurpose = text(purpose);
  const byPurpose =
    meta?.harness?.capabilityToolAllowlistByPurpose &&
    typeof meta.harness.capabilityToolAllowlistByPurpose === "object"
      ? meta.harness.capabilityToolAllowlistByPurpose
      : {};
  const scoped = Array.isArray(byPurpose?.[normalizedPurpose])
    ? byPurpose[normalizedPurpose]
    : null;
  if (scoped) {
    const normalized = scoped.map((item) => text(item)).filter(Boolean);
    if (normalized.includes("*")) return ["*"];
    return normalized;
  }
  const globalAllowlist = Array.isArray(meta?.harness?.capabilityToolAllowlist)
    ? meta.harness.capabilityToolAllowlist
    : [];
  const normalized = globalAllowlist.map((item) => text(item)).filter(Boolean);
  if (normalized.includes("*")) return ["*"];
  return normalized;
}

export function resolvePlanningToolAllowlist(meta = {}) {
  const allowlist = resolveCapabilityToolAllowlist(meta, "planning");
  if (!Array.isArray(allowlist) || !allowlist.length) return [];
  if (allowlist.includes("*")) return ["*"];
  return allowlist;
}
