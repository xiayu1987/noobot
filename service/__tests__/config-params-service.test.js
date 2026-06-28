import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { createConfigParamsService } from "../services/config-params-service.js";

async function createTempDir(prefix = "noobot-config-params-test-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test("collectConfigTemplateKeys: 只收集大写模板变量", async () => {
  const tempDir = await createTempDir();
  const workspaceRoot = path.join(tempDir, "workspace");
  const templateRoot = path.join(tempDir, "template");
  try {
    await mkdir(templateRoot, { recursive: true });
    await writeFile(
      path.join(templateRoot, "config.json"),
      JSON.stringify({
        provider: {
          api_key: "${API_KEY}",
          lower: "${api_key}",
          mixed: "${Api_Key}",
          url: "${BASE_URL}",
        },
      }),
      "utf8",
    );

    const service = createConfigParamsService({
      workspaceRootPath: () => workspaceRoot,
      templateRootPath: () => templateRoot,
      getGlobalConfigRaw: () => ({
        globalKey: "${GLOBAL_KEY}",
        oldKey: "${global_key}",
      }),
    });

    assert.deepEqual(await service.collectConfigTemplateKeys(), [
      "API_KEY",
      "BASE_URL",
      "GLOBAL_KEY",
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
