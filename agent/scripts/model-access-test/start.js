/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { loadTestModels } from "./config.js";
import { createModelAccessServer } from "./server.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const { values } = parseArgs({
  options: {
    port: { type: "string", default: "0" },
    user: { type: "string", default: "admin" },
    config: { type: "string", default: path.join(repoRoot, "service/config/global.config.json") },
    workspace: { type: "string", default: path.join(repoRoot, "workspace") },
  },
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port / 端口无效");
const models = await loadTestModels({
  configPath: values.config,
  workspaceRoot: values.workspace,
  userId: values.user,
});
const server = createModelAccessServer({ models });
server.listen(port, "127.0.0.1", () => {
  console.log(`Noobot 模型访问测试 / Model access test: http://127.0.0.1:${server.address().port}`);
  console.log(
    `已加载 ${models.length} 个模型 / ${models.length} models loaded. Ctrl+C 退出 / exit.`,
  );
});
