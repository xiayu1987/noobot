/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const expected = new Map([
  ["noobot-service", { cwd: path.join(root, "service"), script: "app.js" }],
  ["noobot-agent-proxy", { cwd: path.join(root, "agent-proxy"), script: "agent-proxy.js" }],
  ["noobot-model-proxy", { cwd: path.join(root, "model-proxy"), script: "src/index.js" }],
  ["noobot-client", { cwd: path.join(root, "client/noobot-chat"), script: "deploy/run-caddy.sh" }],
]);

const apps = JSON.parse(await new Promise((resolve, reject) => {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => resolve(input));
  process.stdin.on("error", reject);
}));

const errors = [];
const seenPids = new Set();
for (const [name, definition] of expected) {
  const app = apps.find((candidate) => candidate.name === name);
  if (!app || app.pm2_env?.status !== "online") {
    errors.push(`${name}: not online`);
    continue;
  }
  const env = app.pm2_env;
  const pmExecPath = path.resolve(env.pm_exec_path || "");
  const expectedScript = path.join(definition.cwd, definition.script);
  const actualCwd = path.resolve(env.pm_cwd || "");
  if (actualCwd !== definition.cwd) errors.push(`${name}: cwd=${actualCwd}`);
  if (pmExecPath !== expectedScript) errors.push(`${name}: entry=${pmExecPath}, expected=${expectedScript}`);
  const pid = Number(app.pid);
  if (!Number.isInteger(pid) || pid <= 0) errors.push(`${name}: invalid pid=${app.pid}`);
  else if (seenPids.has(pid)) errors.push(`${name}: duplicate pid=${pid}`);
  else seenPids.add(pid);
  if (pid > 0) {
    try {
      const actualProcCwd = fs.realpathSync(`/proc/${pid}/cwd`);
      if (actualProcCwd !== definition.cwd) errors.push(`${name}: process cwd=${actualProcCwd}`);
    } catch (error) {
      errors.push(`${name}: pid ${pid} unavailable (${error.code || error.message})`);
    }
  }
}

if (errors.length) {
  console.error(`PM2 process identity validation failed:\n${errors.join("\n")}`);
  process.exit(1);
}
console.log(`PM2 process identity validated: ${[...seenPids].join(", ")}`);
