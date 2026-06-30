import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
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
