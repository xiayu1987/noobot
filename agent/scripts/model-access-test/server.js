/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { testModelAccess, redactModelDiagnostic } from "@noobot/model-runtime/diagnostics";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { publicModelList } from "./config.js";

const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html"]],
  ["/app.js", ["app.js", "text/javascript"]],
  ["/editor.js", ["editor.js", "text/javascript"]],
  ["/i18n.js", ["i18n.js", "text/javascript"]],
  ["/style.css", ["style.css", "text/css"]],
]);

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > QUANTITY_THRESHOLDS.diagnostics.modelAccessBodyMaxBytes)
      throw new Error("Request too large / 请求体过大");
    chunks.push(chunk);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Invalid JSON / JSON 无效");
  return body;
}

function sendJson(response, status, value) {
  if (response.destroyed) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

export function createModelAccessServer({ models, execute = testModelAccess }) {
  const token = randomBytes(32).toString("hex");
  const secrets = models.map((model) => model.api_key).filter(Boolean);
  const server = http.createServer(async (request, response) => {
    const requestSecrets = [...secrets];
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader(
      "content-security-policy",
      "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
    );
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      TIME_THRESHOLDS.diagnostics.modelAccessTimeoutMs,
    );
    response.on("close", () => controller.abort());
    try {
      const host = request.headers.host;
      const port = server.address().port;
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) {
        sendJson(response, 403, { error: "Invalid host / 主机无效" });
        return;
      }
      const origin = request.headers.origin;
      if (
        (origin && origin !== `http://${host}`) ||
        request.headers["sec-fetch-site"] === "cross-site"
      ) {
        sendJson(response, 403, { error: "Invalid origin / 来源无效" });
        return;
      }
      const pathname = new URL(request.url, `http://${host}`).pathname;
      if (request.method === "GET" && STATIC_FILES.has(pathname)) {
        const [fileName, contentType] = STATIC_FILES.get(pathname);
        const content = await readFile(new URL(`./public/${fileName}`, import.meta.url));
        response.writeHead(200, { "content-type": `${contentType}; charset=utf-8` });
        response.end(content);
        return;
      }
      if (request.method === "GET" && pathname === "/api/models") {
        sendJson(response, 200, { models: publicModelList(models), token });
        return;
      }
      if (request.method !== "POST" || !["/api/preview", "/api/run"].includes(pathname)) {
        sendJson(response, 404, { error: "Not found / 未找到" });
        return;
      }
      const supplied = Buffer.from(String(request.headers["x-diagnostic-token"] || ""));
      const expected = Buffer.from(token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        sendJson(response, 403, { error: "Invalid token / 校验失败" });
        return;
      }
      const input = await readJson(request);
      const selected = models.find((model) => model.alias === input.alias);
      if (!selected) throw new Error("Model not found / 未找到模型");
      const spec = { ...selected };
      for (const field of ["model", "base_url", "api_key"]) {
        if (typeof input[field] === "string" && input[field].trim())
          spec[field] = input[field].trim();
      }
      if (input.api_key) requestSecrets.push(input.api_key);
      if (input.protocol === "responses") spec.useResponsesApi = true;
      else if (input.protocol === "chat") spec.useResponsesApi = false;
      else if (input.protocol !== "default") throw new Error("Invalid protocol / 接口选项无效");
      const endpoint = new URL(spec.base_url);
      if (
        !["http:", "https:"].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password
      ) {
        throw new Error("Invalid endpoint / 接口地址无效");
      }
      const preview = pathname === "/api/preview";
      if (
        !preview &&
        (!input.body || typeof input.body !== "object" || Array.isArray(input.body))
      ) {
        throw new Error("Request body required / 需要请求体");
      }
      const result = await execute({
        modelSpec: spec,
        messages: input.messages,
        body: preview ? undefined : input.body,
        tools: preview ? input.tools : undefined,
        toolBinding: preview ? input.toolBinding : undefined,
        preview,
        signal: controller.signal,
      });
      sendJson(response, 200, redactModelDiagnostic(result, requestSecrets));
    } catch (error) {
      sendJson(response, 400, {
        error: redactModelDiagnostic(String(error.message), requestSecrets),
      });
    } finally {
      clearTimeout(timer);
    }
  });
  return server;
}
