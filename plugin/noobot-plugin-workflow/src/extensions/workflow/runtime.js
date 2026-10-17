/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { getWorkflowExtensionApi } from "./extension-api.js";
import { createDefaultWorkflowExtension } from "./default-extension.js";

export function createWorkflowExtensionRuntime({
  getWorkflowExtensionApi: resolveExtensionApi,
  createDefaultWorkflowExtension: createDefaultExtension,
}) {
  let mounted = false;

  function mount({ options = {}, meta = {} } = {}) {
    if (mounted) return;
    createDefaultExtension()({ api: resolveExtensionApi(), options, meta });
    mounted = true;
  }

  return { mount };
}

const workflowExtensionRuntime = createWorkflowExtensionRuntime({
  getWorkflowExtensionApi,
  createDefaultWorkflowExtension,
});

export function mountWorkflowExtensions(params = {}) {
  workflowExtensionRuntime.mount(params);
}
