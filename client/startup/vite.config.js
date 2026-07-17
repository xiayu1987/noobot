/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { clientFilePath as path } from "../shared/path-resolver.js";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  base: "./",
  plugins: [vue()],
  build: {
    outDir: path.resolve(__dirname, "../shared/electron/startup"),
    emptyOutDir: true,
  },
});
