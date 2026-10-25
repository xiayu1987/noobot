/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createPluginActivationResult, PLUGIN_SURFACE } from "@noobot/plugin-protocol";
import { createHarnessRegistration } from "../core/plugin.js";
import { PLUGIN_ID } from "../core/constants.js";
import { createRegisterHarnessHooks } from "../core/hooks.js";
import { assertHarnessAgentHostCapabilities } from "../core/options.js";
import { cleanupOldRuns } from "../utils/cleanup.js";
import { formatHarnessCoreError, HARNESS_CORE_ERROR } from "../core/error-messages.js";
import { text } from "@noobot/shared/value";

function scheduleRunRetentionCleanup(options) {
  cleanupOldRuns(text(options.basePath), options).catch((error) => {
    console.warn(
      formatHarnessCoreError(HARNESS_CORE_ERROR.CLEANUP_OLD_RUNS_FAILED, {
        locale: text(options.locale) || "en-US",
        params: { message: String(error?.message || error) },
      }),
    );
  });
}

const registerAgentHooks = createRegisterHarnessHooks({ sessionCleanupPoints: [] });
const registerAgentPlugin = createHarnessRegistration({
  registerHarnessHooks: (registration) => {
    assertHarnessAgentHostCapabilities(registration.options);
    scheduleRunRetentionCleanup(registration.options);
    return registerAgentHooks(registration);
  },
});

export function activate(host = {}, config = {}) {
  const registration = registerAgentPlugin(
    {
      hookManager: { on: host?.hooks?.register, emit: host?.hooks?.emit },
      policy: host?.policy,
    },
    config,
  );
  return createPluginActivationResult({
    pluginId: PLUGIN_ID,
    surface: PLUGIN_SURFACE.AGENT,
    dispose: () => registration.disposers.forEach((dispose) => dispose()),
  });
}
