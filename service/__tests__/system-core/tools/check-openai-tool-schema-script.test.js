import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

test("scripts/check-openai-tool-schema.js: 非 live 模式应通过", async () => {
  const cwd = path.resolve(process.cwd());
  const scriptPath = path.join(cwd, "scripts/check-openai-tool-schema.js");

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [scriptPath, "--userId", "admin"],
    {
      cwd,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  const output = `${stdout || ""}\n${stderr || ""}`;
  assert.match(output, /\[tool-schema-check\] convert pass:/);
  assert.match(output, /\[tool-schema-check\] skip live validation/);
}, { timeout: 120000 });
