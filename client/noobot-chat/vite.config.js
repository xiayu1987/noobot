/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    host: "0.0.0.0", // 允许局域网访问，可改成具体 IP
    port: 10060, // 指定端口
    proxy: {
      "/api": {
        target: "http://localhost:10061",
        changeOrigin: true,
        ws: true, 
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
