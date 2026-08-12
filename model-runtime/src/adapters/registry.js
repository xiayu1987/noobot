/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { openAiCompatibleAdapter } from "./openai-compatible-adapter.js";
import { dashscopeAdapter } from "./dashscope-adapter.js";

export function createProviderAdapterRegistry(
  adapters = [dashscopeAdapter, openAiCompatibleAdapter],
) {
  const byId = new Map();
  for (const adapter of adapters) {
    if (
      !adapter?.id ||
      !Array.isArray(adapter.formats) ||
      typeof adapter.createClient !== "function" ||
      typeof adapter.classifyError !== "function"
    ) {
      throw new TypeError("provider adapter requires id, formats, createClient and classifyError");
    }
    if (byId.has(adapter.id)) throw new TypeError(`duplicate provider adapter: ${adapter.id}`);
    byId.set(adapter.id, adapter);
  }
  return Object.freeze({
    resolve(spec = {}) {
      const adapterId = String(spec.adapterId || "")
        .trim()
        .toLowerCase();
      if (!adapterId) throw new TypeError("model spec.adapterId is required");
      const adapter = byId.get(adapterId);
      if (!adapter) throw new TypeError(`unknown provider adapter: ${adapterId}`);
      const format = String(spec.format || "")
        .trim()
        .toLowerCase();
      if (!adapter.formats.includes(format)) {
        throw new TypeError(
          `provider adapter ${adapterId} does not support format: ${format || "missing"}`,
        );
      }
      return adapter;
    },
    list() {
      return [...byId.values()];
    },
  });
}
