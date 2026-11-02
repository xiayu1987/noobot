/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { initializeRuntimeParams } from "@noobot/shared/runtime-params-node";
import { WORKSPACE_ROOT_LAYOUT } from "@noobot/workspace-protocol/layout";
import { tModelRuntime } from "@noobot/model-runtime/locale";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const { values } = parseArgs({
  options: {
    port: { type: "string", default: "0" },
    locale: { type: "string", default: "zh-CN" },
    user: { type: "string", default: "admin" },
    config: { type: "string", default: path.join(repoRoot, "service/config/global.config.json") },
    workspace: { type: "string", default: path.join(repoRoot, "workspace") },
  },
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error(tModelRuntime(values.locale, "diagnostic.invalidPort"));
initializeRuntimeParams(path.resolve(values.workspace, WORKSPACE_ROOT_LAYOUT.RUNTIME_PARAMS_FILE));
const [{ loadTestModels }, { createModelAccessServer }] = await Promise.all([
  import("./config.js"),
  import("./server.js"),
]);
const models = await loadTestModels({
  configPath: values.config,
  workspaceRoot: values.workspace,
  userId: values.user,
  locale: values.locale,
});
const server = createModelAccessServer({ models });
server.listen(port, "127.0.0.1", () => {
  console.log(
    tModelRuntime(values.locale, "diagnostic.startUrl", {
      url: `http://127.0.0.1:${server.address().port}`,
    }),
  );
  console.log(tModelRuntime(values.locale, "diagnostic.modelsLoaded", { count: models.length }));
});
