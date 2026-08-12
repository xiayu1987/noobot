/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeProviderSpec } from "./provider-spec.js";

export function requireModelSpec(input = {}) {
  const model = String(input.model || "").trim();
  if (!model) throw new TypeError("model spec.model is required");
  const provider = normalizeProviderSpec(input);
  return Object.freeze({
    ...input,
    model,
    alias: String(input.alias || "").trim(),
    format: provider.format,
    providerId: provider.providerId,
    adapterId: provider.adapterId,
  });
}
