/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { WORKSPACE_ROOT_LAYOUT } from "@noobot/workspace-protocol";
import { createRuntimeParamsStore } from "@noobot/shared/runtime-params-node";
import {
  RUNTIME_PARAMS_API,
  RUNTIME_PARAMS_SNAPSHOT_API,
  activeRuntimeParams,
} from "@noobot/shared/runtime-params";

export function registerRuntimeParamsRoutes(
  app,
  { requireApiKey, requireSuperAdmin, workspaceRootPath },
) {
  const store = createRuntimeParamsStore(
    path.join(workspaceRootPath(), WORKSPACE_ROOT_LAYOUT.RUNTIME_PARAMS_FILE),
  );
  const respond = (action) => (req, res, next) => {
    try {
      res.json(action(req));
    } catch (error) {
      if (!error.statusCode) {
        next(error);
        return;
      }
      res.status(error.statusCode).json({ ok: false, code: error.code, error: error.message });
    }
  };
  app.get(RUNTIME_PARAMS_SNAPSHOT_API, (...[, res]) => {
    const { schemaVersion, revision, overrides } = activeRuntimeParams();
    res.setHeader("Cache-Control", "no-store");
    res.json({ schemaVersion, revision, overrides });
  });
  app.get(
    RUNTIME_PARAMS_API,
    requireApiKey,
    requireSuperAdmin,
    respond(() => store.read()),
  );
  app.put(
    RUNTIME_PARAMS_API,
    requireApiKey,
    requireSuperAdmin,
    respond((req) => store.save(req.body, req.auth.userId)),
  );
}
