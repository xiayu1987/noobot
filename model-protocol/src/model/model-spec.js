/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeProviderSpec } from "./provider-spec.js";

export function requireModelSpec(input = {}) {
  const model = String(input.model || "").trim();
  if (!model) throw new TypeError("model spec.model is required");
  const provider = normalizeProviderSpec(input);
  // The transport is a protocol constant carried by adapterId. A spec still
  // naming a format comes from a producer that has not been converged, so it is
  // rejected rather than silently tolerated.
  if (input.format !== undefined) {
    throw new TypeError("model spec.format is not part of this protocol");
  }
  return Object.freeze({
    ...input,
    model,
    alias: String(input.alias || "").trim(),
    operatorId: provider.operatorId,
    adapterId: provider.adapterId,
  });
}
