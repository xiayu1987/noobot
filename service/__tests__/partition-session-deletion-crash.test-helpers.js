/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { join } from "node:path";
import { resolvePluginDataRelativePath } from "@noobot/workspace-protocol";
import { createPluginServicePorts } from "../services/plugin-service-ports.js";
import { createServicePluginHost } from "../services/service-plugin-host.js";
import express from "./routes/session-routes.helpers.js";

export function runsDirectory(basePath) {
  return join(basePath, resolvePluginDataRelativePath("harness", "runs"));
}

export async function createDeletionHttpFixture(t, access) {
  const app = express();
  const pluginHost = createServicePluginHost();
  t.after(() => pluginHost.dispose());
  const translateText = (key) => key;
  await pluginHost.registerServiceRoutes(app, {
    runBotOperation: access.runOperation,
    ports: createPluginServicePorts({ bot: access, translateText }),
    enforceUserScopeParam: (_req, _res, next) => next(),
    translateText,
  });
  return { app, pluginHost };
}
