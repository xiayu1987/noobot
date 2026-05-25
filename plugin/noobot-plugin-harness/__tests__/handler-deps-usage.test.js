/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const handlersRoot = path.resolve(__dirname, "../src/capabilities/handlers");
const ALLOWED_UNUSED_EXPORTS = Object.freeze({
  planning: new Set(["getTaskTemplate"]),
  guidance: new Set(["GUIDANCE_WEB_SERVICE_NAME", "GUIDANCE_WEB_TOOL_NAMES"]),
});

function extractNamedExports(source = "") {
  const names = [];
  const re = /export\s*\{([\s\S]*?)\}\s*from\s*['\"][^'\"]+['\"];/g;
  let match = null;
  while ((match = re.exec(source))) {
    const group = String(match[1] || "").trim();
    if (!group) continue;
    for (const segment of group.split(",")) {
      const raw = String(segment || "").trim();
      if (!raw) continue;
      const left = raw.split(/\s+as\s+/i)[0];
      const name = String(left || "").trim();
      if (name) names.push(name);
    }
  }
  return [...new Set(names)];
}

function listJsFiles(dir = "") {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".js") && name !== "deps.js")
    .map((name) => path.join(dir, name));
}

for (const domain of ["planning", "guidance", "acceptance", "review"]) {
  test(`deps exports are all used in ${domain}`, () => {
    const domainDir = path.join(handlersRoot, domain);
    const depsPath = path.join(domainDir, "deps.js");
    const depsSource = fs.readFileSync(depsPath, "utf8");
    const exportNames = extractNamedExports(depsSource);
    const files = listJsFiles(domainDir);
    const joined = files.map((filePath) => fs.readFileSync(filePath, "utf8")).join("\n\n");

    const allowed = ALLOWED_UNUSED_EXPORTS[domain] || new Set();
    const unused = exportNames.filter((name) => {
      if (allowed.has(name)) return false;
      const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "g");
      return !pattern.test(joined);
    });

    assert.deepEqual(
      unused,
      [],
      `${domain}/deps.js has unused exports: ${unused.join(", ")}`,
    );
  });
}
