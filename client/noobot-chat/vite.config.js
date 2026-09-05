/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { addressPort, resolveRuntimeTopology } from "@noobot/runtime-topology-protocol/ports";

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
  const connectToken = String(
    env.VITE_PROXY_CONNECT_TOKEN || "5fd50423-d915-49d7-8e9a-62d93f33777b",
  ).trim();

  return {
    plugins: [vue()],
    resolve: {
      dedupe: ["vue"],
    },
    build: {
      rolldownOptions: {
        output: {
          manualChunks: resolveVendorChunk,
        },
      },
    },
    test: {
      environment: "jsdom",
      include: [
        "tests/unit/**/*.spec.js",
        "../../plugin/noobot-plugin-harness/frontend/__tests__/**/*.spec.js",
        "../../plugin/noobot-plugin-workflow/frontend/__tests__/**/*.spec.js",
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
