/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { getWorkflowExtensionApi } from "./extension-api.js";
import { createDefaultWorkflowExtension } from "./default-extension.js";

function normalizeExtensionList(input = null) {
  if (!Array.isArray(input)) return [];
  return input.filter((item) => typeof item === "function");
}

export function createWorkflowExtensionRuntime(deps = {}) {
  const getWorkflowExtensionApiFn = deps.getWorkflowExtensionApi || getWorkflowExtensionApi;
  const createDefaultWorkflowExtensionFn =
    deps.createDefaultWorkflowExtension || createDefaultWorkflowExtension;
  let mounted = false;

  function buildExtensions(options = {}) {
    const defaults = [createDefaultWorkflowExtensionFn()];
    const userExtensions = normalizeExtensionList(options?.workflowExtensions);
    return [...defaults, ...userExtensions];
  }

  function mount({ options = {}, meta = {} } = {}) {
    if (mounted) return;
    const api = getWorkflowExtensionApiFn();
    const extensionContext = { api, options, meta };
    const extensionMounter =
      typeof options?.workflowExtensionMounter === "function" ? options.workflowExtensionMounter : null;
    if (extensionMounter) {
      extensionMounter(extensionContext);
    }
    const extensions = buildExtensions(options);
    for (const extension of extensions) {
      extension(extensionContext);
    }
    mounted = true;
  }

  function resetForTest() {
    mounted = false;
  }

  return {
    mount,
    resetForTest,
  };
}

export const workflowExtensionRuntime = createWorkflowExtensionRuntime();

export function mountWorkflowExtensions(params = {}) {
  workflowExtensionRuntime.mount(params);
}

