import { normalizeOptions } from "./options.js";

export function assertHookManager(hookManager = null) {
  if (!hookManager || typeof hookManager.on !== "function") {
    throw new Error("workflow plugin requires a bot hook manager with on()");
  }
}

export function createPluginRuntimeContext(api = {}, userOptions = {}) {
  const options = normalizeOptions(userOptions);
  const botHookManager =
    api?.botHookManager && typeof api.botHookManager === "object"
      ? api.botHookManager
      : api?.hookManager && typeof api.hookManager === "object"
        ? api.hookManager
        : null;
  return {
    options,
    hookManager: botHookManager,
  };
}
