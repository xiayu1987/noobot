/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { createServer } from "vite";

export async function createTestViteServer(t, options) {
  const cacheDir = await mkdtemp(path.join(tmpdir(), "noobot-browser-vite-"));
  const server = createServer({ ...options, cacheDir });
  t.after(async () => {
    try {
      await (await server).close();
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
  return server;
}
