/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WORKSPACE_ROOT_LAYOUT } from "@noobot/workspace-protocol/layout";
import { createRuntimeParamsStore } from "../runtime-params-node.js";
import { createDefaultRuntimeParamsDocument } from "../runtime-params.js";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const repositoryUrl = (relative) => new URL(relative, new URL("../../", import.meta.url)).href;

function hookScript({ root, replacements = {} }) {
  const sources = Object.fromEntries(
    Object.entries(replacements).map(([relative, source]) => [repositoryUrl(relative), source]),
  );
  return `
    import {registerHooks} from 'node:module';
    const replacements = ${JSON.stringify(sources)};
    registerHooks({
      resolve(specifier, context, next) {
        if (specifier === 'electron') return {url: 'test:electron', shortCircuit: true};
        return next(specifier, context);
      },
      load(url, context, next) {
        if (url === 'test:electron') return {format: 'module', shortCircuit: true,
          source: ${JSON.stringify(`export const app = {getPath: () => ${JSON.stringify(root)}};`)}};
        if (Object.hasOwn(replacements, url))
          return {format: 'module', source: replacements[url], shortCircuit: true};
        return next(url, context);
      }
    });
  `;
}

function runProbe(script, env) {
  const inherited = { ...process.env };
  delete inherited.NOOBOT_WORKSPACE_ROOT;
  delete inherited.NOOBOT_GLOBAL_CONFIG_PATH;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: path.join(repository, "service"),
    env: { ...inherited, ...env },
    encoding: "utf8",
  });
}

test("snapshot-owning entries install the persisted revision before loading business modules", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-params-bootstrap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const file = path.join(workspace, WORKSPACE_ROOT_LAYOUT.RUNTIME_PARAMS_FILE);
  const store = createRuntimeParamsStore(file, { active: createDefaultRuntimeParamsDocument });
  store.save(
    {
      revision: 0,
      overrides: { "quantity.memory.maxItems": 42, "length.modelProxy.logFileBytes": 4096 },
    },
    "admin",
  );
  const config = path.join(root, "global.config.json");
  fs.writeFileSync(config, JSON.stringify({ workspace_root: workspace }));
  const report = `
    import {activeRuntimeParams} from ${JSON.stringify(repositoryUrl("shared/runtime-params.js"))};
    import {QUANTITY_THRESHOLDS} from ${JSON.stringify(repositoryUrl("shared/quantity-thresholds.js"))};
    import {LENGTH_THRESHOLDS} from ${JSON.stringify(repositoryUrl("shared/length-thresholds.js"))};
    console.log(JSON.stringify({revision: activeRuntimeParams().revision, value: QUANTITY_THRESHOLDS.memory.maxItems, proxy: LENGTH_THRESHOLDS.modelProxy.logFileBytes}));
  `;
  const workspaceEnv = { NOOBOT_WORKSPACE_ROOT: workspace };
  const entries = [
    { entry: "service/app.js", replacements: { "service/app-runtime.js": report } },
    {
      entry: "service/bin/noobot.js",
      replacements: {
        "service/cli/noobot.js": `${report}\nexport async function runCli() { return 0; }`,
      },
    },
    {
      entry: "client/noobot-chat/src/main.js",
      replacements: { "client/noobot-chat/src/app-runtime.js": report },
    },
    {
      entry: "agent/scripts/model-access-test/start.js",
      argv: ["--workspace", workspace],
      replacements: {
        "agent/scripts/model-access-test/config.js": `${report}\nexport async function loadTestModels() { return []; }`,
        "agent/scripts/model-access-test/server.js": `export function createModelAccessServer() {
          return {listen() {}, address: () => ({port: 0})};
        }`,
      },
    },
    {
      entry: "agent-proxy/agent-proxy.js",
      env: workspaceEnv,
      replacements: { "agent-proxy/src/server/main.js": report },
    },
    {
      entry: "model-proxy/src/index.js",
      env: workspaceEnv,
      replacements: { "model-proxy/src/main.js": report },
    },
  ];
  for (const { entry, argv = [], env = {}, replacements } of entries) {
    const script = `
      ${hookScript({ root, replacements })}
      process.argv.push(...${JSON.stringify(argv)});
      const {readFileSync} = await import('node:fs');
      globalThis.fetch = async (url, options) => {
        if (url !== '/api/internal/runtime-params/snapshot' || options.cache !== 'no-store') throw new Error('invalid snapshot request');
        return {ok: true, json: async () => JSON.parse(readFileSync(${JSON.stringify(file)}, 'utf8'))};
      };
      await import(${JSON.stringify(repositoryUrl(entry))});
    `;
    const child = runProbe(script, { NOOBOT_GLOBAL_CONFIG_PATH: config, ...env });
    assert.equal(child.status, 0, `${entry}: ${child.stderr}`);
    assert.deepEqual(JSON.parse(child.stdout), { revision: 1, value: 42, proxy: 4096 }, entry);
  }
});

test("processes without a snapshot import their modules and read fixed thresholds", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-params-unowned-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modules = ["runtime-events/src/index.js", "client/shared/electron/runtime/services.js"];
  for (const modulePath of modules) {
    const script = `
      ${hookScript({ root })}
      await import(${JSON.stringify(repositoryUrl(modulePath))});
      const {TIME_THRESHOLDS} = await import(${JSON.stringify(repositoryUrl("shared/time-thresholds.js"))});
      const {QUANTITY_THRESHOLDS} = await import(${JSON.stringify(repositoryUrl("shared/quantity-thresholds.js"))});
      console.log(JSON.stringify([
        TIME_THRESHOLDS.service.startupStallTimeoutMs,
        QUANTITY_THRESHOLDS.runtimeEvents !== undefined,
      ]));
    `;
    const child = runProbe(script, {});
    assert.equal(child.status, 0, `${modulePath}: ${child.stderr}`);
    const [stallTimeoutMs, hasRuntimeEvents] = JSON.parse(child.stdout.trim().split("\n").at(-1));
    assert.ok(Number.isSafeInteger(stallTimeoutMs), modulePath);
    assert.equal(hasRuntimeEvents, true, modulePath);
  }
});
