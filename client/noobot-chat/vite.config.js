/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import { defaultExclude } from "vitest/config";
import wasm from "vite-plugin-wasm";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { addressPort, resolveRuntimeTopology } from "@noobot/runtime-topology-protocol/ports";
import { createChunkBudgetPlugin } from "./build/chunk-budget.js";
import { text } from "@noobot/shared/value";

const runtimeTopology = resolveRuntimeTopology(process.env);
const devServerPort = Number(addressPort(runtimeTopology.clientAddr));
const devProxyTarget = `http://${runtimeTopology.agentProxyUpstream}`;

const VENDOR_CHUNK_RULES = Object.freeze([
  ["vendor-vue", ["/vue/", "/@vue/", "/pinia/"]],
  ["vendor-element-plus", ["/element-plus/", "/@element-plus/"]],
  ["vendor-markdown", ["/markdown-it/", "/linkify-it/", "/mdurl/", "/uc.micro/"]],
]);

function resolveVendorChunk(moduleId = "") {
  const normalizedId = String(moduleId || "").replaceAll("\\", "/");
  if (!normalizedId.includes("/node_modules/")) return undefined;
  return VENDOR_CHUNK_RULES.find(([, packageMarkers]) =>
    packageMarkers.some((packageMarker) => normalizedId.includes(packageMarker)),
  )?.[0];
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const connectToken = text(env.VITE_PROXY_CONNECT_TOKEN) || "5fd50423-d915-49d7-8e9a-62d93f33777b";

  return {
    plugins: [vue(), wasm(), createChunkBudgetPlugin()],
    resolve: {
      dedupe: ["vue"],
    },
    build: {
      chunkSizeWarningLimit: 3000,
      rolldownOptions: {
        output: {
          manualChunks: resolveVendorChunk,
        },
      },
    },
    test: {
      setupFiles: ["../../shared/testing/runtime-params.js"],
      projects: [
        {
          extends: true,
          test: {
            name: "browser",
            environment: "jsdom",
            include: [
              "tests/unit/**/*.spec.js",
              "tests/integration/**/*.spec.js",
              "../../plugin/noobot-plugin-harness/frontend/__tests__/**/*.spec.js",
              "../../plugin/noobot-plugin-workflow/frontend/__tests__/**/*.spec.js",
            ],
            exclude: [...defaultExclude, "tests/unit/e2e/**"],
          },
        },
        {
          extends: true,
          test: {
            name: "e2e-helpers",
            environment: "node",
            include: ["tests/unit/e2e/**/*.spec.js"],
          },
        },
      ],
    },
    server: {
      host: "0.0.0.0",
      port: devServerPort,
      fs: {
        allow: [path.resolve(process.cwd(), "../..")],
      },
      proxy: {
        "/api/internal/connect": {
          target: devProxyTarget,
          changeOrigin: true,
          ws: true,
          rewrite: (requestPath) => requestPath.replace(/^\/api/, ""),
          ...(connectToken
            ? {
                headers: {
                  "x-proxy-token": connectToken,
                },
              }
            : {}),
        },
        "/api": {
          target: devProxyTarget,
          changeOrigin: true,
          ws: true,
          rewrite: (requestPath) => requestPath.replace(/^\/api/, ""),
        },
      },
    },
  };
});
