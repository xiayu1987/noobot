import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const launcherPath = path.resolve(testDir, "../scripts/project-launcher.js");

const minimalGlobalExample = {
  workspace_root: "../workspace",
  workspace_template_path: "../user-template/default-user",
  preferences: {
    language: "zh-CN",
  },
  tools: {
    web_search: {
      search_engine: {
        endpoints: {
          search: {
            url: "${WEB_SEARCH_ENGINE_SEARCH_ADDRESS}",
          },
        },
      },
    },
  },
  providers: {
    example_openai: {
      enabled: true,
      used_for_conversation: true,
      api_key: "${OPENAI_API_KEY}",
      base_url: "${OPENAI_API_ADDRESS}",
      model: "example-openai",
      format: "openai_compatible",
    },
  },
};

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function makeServiceRoot() {
  const serviceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-project-launcher-"));
  await writeJson(path.join(serviceRoot, "config", "global.config.example.json"), minimalGlobalExample);
  return serviceRoot;
}

async function runLauncher(serviceRoot, { env = {}, args = [] } = {}) {
  return execFileAsync(process.execPath, [launcherPath, ...args], {
    cwd: serviceRoot,
    env: {
      ...process.env,
      AGENT_GLOBAL_CONFIG_PATH: "",
      NOOBOT_GLOBAL_CONFIG_PATH: "",
      NOOBOT_SETUP_LANG: "en",
      ...env,
    },
  });
}

test("project launcher uses NOOBOT_GLOBAL_CONFIG_PATH when resolving global config", async (t) => {
  const serviceRoot = await makeServiceRoot();
  t.after(() => rm(serviceRoot, { recursive: true, force: true }));
  const customConfigPath = path.join(serviceRoot, "custom-config", "global.config.json");
  await writeJson(customConfigPath, {
    workspace_root: "./custom-workspace",
    workspace_template_path: "./custom-template",
    preferences: {
      language: "en-US",
    },
  });
  await writeJson(path.join(serviceRoot, "custom-template", "config.example.json"), {
    preferences: {
      language: "en-US",
    },
  });

  await runLauncher(serviceRoot, {
    env: {
      NOOBOT_GLOBAL_CONFIG_PATH: customConfigPath,
    },
  });

  const customConfig = await readJson(customConfigPath);
  assert.equal(customConfig.workspace_root, "./custom-workspace");
  assert.equal(customConfig.workspace_template_path, "./custom-template");
  assert.ok(customConfig.providers?.example_openai);
  assert.equal(await exists(path.join(serviceRoot, "config", "global.config.json")), false);
  assert.equal(await exists(path.join(serviceRoot, "custom-workspace", "config-params.json")), true);
});

test("project launcher resolves camelCase workspace config keys for existing configs", async (t) => {
  const serviceRoot = await makeServiceRoot();
  t.after(() => rm(serviceRoot, { recursive: true, force: true }));
  await writeJson(path.join(serviceRoot, "config", "global.config.json"), {
    workspaceRoot: "./camel-workspace",
    workspaceTemplatePath: "./camel-template",
    superAdmin: {
      userId: "root-admin",
    },
    preferences: {
      language: "zh-CN",
    },
  });
  await writeJson(path.join(serviceRoot, "camel-template", "config.example.json"), {
    preferences: {
      language: "zh-CN",
    },
  });

  await runLauncher(serviceRoot);

  assert.equal(await exists(path.join(serviceRoot, "camel-workspace", "config-params.json")), true);
  assert.equal(await exists(path.join(serviceRoot, "workspace", "config-params.json")), false);
});
