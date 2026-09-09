/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeProviderSpec } from "./provider-spec.js";

export function requireModelSpec(input = {}) {
  const model = String(input.model || "").trim();
  if (!model) throw new TypeError("model spec.model is required");
  const provider = normalizeProviderSpec(input);

  if (input.format !== undefined) {
    throw new TypeError("model spec.format is not part of this protocol");
  }
  const { adapterId: _adapterId, adapter_id: _adapter_id, ...canonicalInput } = input;
  return Object.freeze({
    ...canonicalInput,
    model,
    alias: String(input.alias || "").trim(),
    operatorId: provider.operatorId,
    adapterId: provider.adapterId,
  });
}
