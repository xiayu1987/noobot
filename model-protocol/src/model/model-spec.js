/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeProviderSpec } from "./provider-spec.js";
import { text } from "@noobot/shared/value";

export function requireModelSpec(input = {}) {
  const model = text(input.model);
  if (!model) throw new TypeError("model spec.model is required");
  const provider = normalizeProviderSpec(input);

  if (input.format !== undefined) {
    throw new TypeError("model spec.format is not part of this protocol");
  }
  const { adapterId: _adapterId, adapter_id: _adapter_id, ...canonicalInput } = input;
  return Object.freeze({
    ...canonicalInput,
    model,
    alias: text(input.alias),
    operatorId: provider.operatorId,
    adapterId: provider.adapterId,
  });
}
