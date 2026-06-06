/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const connectToken = String(
    env.VITE_PROXY_CONNECT_TOKEN || "5fd50423-d915-49d7-8e9a-62d93f33777b",
  ).trim();

  return {
    plugins: [vue()],
    test: {
      environment: "jsdom",
      include: ["tests/unit/**/*.spec.js"],
    },
    server: {
      host: "0.0.0.0", // 允许局域网访问，可改成具体 IP
      port: 10060, // 指定端口
      fs: {
        allow: [path.resolve(process.cwd(), "../..")],
      },
      proxy: {
        "/api/internal/connect": {
          target: "http://localhost:10062",
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
          target: "http://localhost:10062",
          changeOrigin: true,
          ws: true,
          rewrite: (requestPath) => requestPath.replace(/^\/api/, ""),
        },
      },
    },
  };
});
