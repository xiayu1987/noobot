/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { decorateProxyResponseHeaders } from "../http/http-proxy.js";

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js" || extension === ".mjs") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".ico") return "image/x-icon";
  if (extension === ".woff") return "font/woff";
  if (extension === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

function isFrontendBypassPath(pathname = "") {
  return (
    pathname === "/health" ||
    pathname === "/internal/connect" ||
    pathname === "/api/internal/connect" ||
    pathname === "/agent-proxy/ws" ||
    pathname === "/api/agent-proxy/ws" ||
    pathname === "/chat/ws" ||
    pathname === "/api/chat/ws" ||
    pathname === "/logs/ws" ||
    pathname === "/api/logs/ws" ||
    pathname.startsWith("/api/") ||
    pathname === "/ide" ||
    pathname.startsWith("/ide/")
  );
}

export function createFrontendStaticHandler(frontendRoot) {
  const frontendIndexPath = frontendRoot ? path.join(frontendRoot, "index.html") : "";
  const shouldServeFrontend = Boolean(frontendRoot && fs.existsSync(frontendIndexPath));

  return tryServeFrontend;

  function tryServeFrontend(request, response, pathname) {
    if (!shouldServeFrontend || isFrontendBypassPath(pathname)) return false;
    if (!["GET", "HEAD"].includes(String(request?.method || "GET").toUpperCase())) return false;
    let decodedPathname = "/";
    try {
      decodedPathname = decodeURIComponent(pathname || "/");
    } catch {
      response.writeHead(
        400,
        decorateProxyResponseHeaders({ "content-type": "text/plain; charset=utf-8" }),
      );
      response.end("Bad Request");
      return true;
    }
    const relativePath =
      decodedPathname === "/" ? "index.html" : decodedPathname.replace(/^\/+/, "");
    const candidatePath = path.resolve(frontendRoot, relativePath);
    const normalizedRoot = path.resolve(frontendRoot);
    if (
      !candidatePath.startsWith(`${normalizedRoot}${path.sep}`) &&
      candidatePath !== normalizedRoot
    ) {
      response.writeHead(
        403,
        decorateProxyResponseHeaders({ "content-type": "text/plain; charset=utf-8" }),
      );
      response.end("Forbidden");
      return true;
    }
    const filePath =
      fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()
        ? candidatePath
        : frontendIndexPath;
    response.writeHead(
      200,
      decorateProxyResponseHeaders({ "content-type": getContentType(filePath) }),
    );
    if (String(request?.method || "GET").toUpperCase() === "HEAD") {
      response.end();
      return true;
    }
    fs.createReadStream(filePath).pipe(response);
    return true;
  }
}
