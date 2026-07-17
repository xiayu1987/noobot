import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { searchFilesWithRipgrep } from "../../../src/system-core/tools/execution/file-search.js";

test("ripgrep file search treats a leading-dash query as a literal pattern", async () => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "noobot-file-search-"));
  try {
    await writeFile(path.join(rootPath, "theme.css"), ":root { --surface-color: white; }\n", "utf8");

    const result = await searchFilesWithRipgrep({
      rootPath,
      workspacePath: rootPath,
      query: "--",
      isRegex: false,
      glob: "*.css",
    });

    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].filePath, "theme.css");
    assert.match(result.matches[0].text, /--surface-color/);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
