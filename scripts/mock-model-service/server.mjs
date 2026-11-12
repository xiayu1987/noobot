/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { MOCK_MODEL, nextReply } from "./scenario.mjs";

async function readRequest(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new Error("Request too large");
  }
  return raw;
}

function streamResponse({ res, envelope, message, finishReason, usage }) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  const chunk = (delta, finish_reason = null) =>
    res.write(
      `data: ${JSON.stringify({ ...envelope, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
    );
  chunk({ role: "assistant" });
  const tool = message.tool_calls?.[0];
  if (tool) {
    chunk({
      tool_calls: [{ index: 0, ...tool, function: { name: tool.function.name, arguments: "" } }],
    });
    chunk({ tool_calls: [{ index: 0, function: { arguments: tool.function.arguments } }] });
  } else chunk({ content: message.content });
  chunk({}, finishReason);
  res.write(
    `data: ${JSON.stringify({ ...envelope, object: "chat.completion.chunk", choices: [], usage })}\n\ndata: [DONE]\n\n`,
  );
  res.end();
}

export function createMockModelServer() {
  return createServer(async (req, res) => {
    if (req.url === "/health") {
      res.end("ok");
      return;
    }
    if (req.url?.startsWith("/search?")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          results: [
            {
              title: "NOOBOT-PERF-SEARCH",
              url: "http://noobot-mock-model:8081/health",
              content: "Hermetic search fixture",
            },
          ],
        }),
      );
      return;
    }
    if (req.method === "POST" && req.url === "/v1/images/generations") {
      await readRequest(req);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data: [
            {
              b64_json:
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=",
            },
          ],
        }),
      );
      return;
    }
    if (req.method === "POST" && req.url === "/v1/responses") {
      const body = JSON.parse(await readRequest(req));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: `resp_${randomUUID()}`,
          object: "response",
          status: "completed",
          model: body.model,
          output: [
            {
              id: `msg_${randomUUID()}`,
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "NOOBOT-PERF-PARSED-IMAGE", annotations: [] }],
            },
          ],
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        }),
      );
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404).end();
      return;
    }
    const started = performance.now();
    try {
      const raw = await readRequest(req);
      const body = JSON.parse(raw);
      const reply = nextReply(body);
      const message = reply.tool
        ? {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: reply.callId || `call_${randomUUID().replaceAll("-", "")}`,
                type: "function",
                function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) },
              },
            ],
          }
        : { role: "assistant", content: reply.content };
      const finishReason = reply.tool ? "tool_calls" : "stop";
      const envelope = {
        id: `chatcmpl-${randomUUID()}`,
        model: body.model,
        created: Math.floor(Date.now() / 1000),
      };
      const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
      if (body.stream) {
        streamResponse({ res, envelope, message, finishReason, usage });
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ...envelope,
            object: "chat.completion",
            choices: [{ index: 0, message, finish_reason: finishReason }],
            usage,
          }),
        );
      }
      console.log(
        JSON.stringify({
          event: "mock.request.finished",
          tool: reply.tool?.name || null,
          requestBytes: Buffer.byteLength(raw),
          durationMs: performance.now() - started,
        }),
      );
    } catch (error) {
      console.error(JSON.stringify({ event: "mock.request.failed", message: error.message }));
      if (!res.headersSent) res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: error.message, type: "invalid_request_error" } }));
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createMockModelServer().listen(MOCK_MODEL.port, "0.0.0.0");
}
