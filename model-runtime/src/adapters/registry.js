/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireProviderAdapter, resolveModelAdapterId } from "@noobot/model-protocol";

import { openAiCompatibleAdapter } from "./openai-compatible-adapter.js";
import { anthropicMessagesAdapter } from "./anthropic-messages-adapter.js";

export function createProviderAdapterRegistry(
  adapters = [openAiCompatibleAdapter, anthropicMessagesAdapter],
) {
  const byId = new Map();
  for (const candidate of adapters) {
    const adapter = requireProviderAdapter(candidate);
    if (byId.has(adapter.id)) throw new TypeError(`duplicate provider adapter: ${adapter.id}`);
    byId.set(adapter.id, adapter);
  }
  return Object.freeze({
    resolve(spec = {}) {
      const explicitAdapterId = String(spec.adapterId || "")
        .trim()
        .toLowerCase();
      const modelFamily = String(spec.modelFamily || "")
        .trim()
        .toLowerCase();
      if (!explicitAdapterId && !modelFamily) {
        throw new TypeError("model spec.adapterId is required");
      }
      const adapterId = String(
        modelFamily ? resolveModelAdapterId({ modelFamily }) : explicitAdapterId,
      )
        .trim()
        .toLowerCase();
      if (!adapterId) throw new TypeError("model spec.adapterId is required");
      const adapter = byId.get(adapterId);
      if (!adapter) throw new TypeError(`unknown provider adapter: ${adapterId}`);
      return adapter;
    },
    list() {
      return [...byId.values()];
    },
  });
}
