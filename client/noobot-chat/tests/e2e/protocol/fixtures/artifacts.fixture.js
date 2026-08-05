/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { captureTest } from "./protocol-capture.fixture.js";
import { findAgentCommands, findLifecycleEnvelopes, findLifecycleReceipts } from "../helpers/websocket-capture.js";

async function writeJsonLines(filePath, records) {
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "", "utf8");
}

export const artifactTest = captureTest.extend({
  protocolArtifacts: [async ({ protocolCapture }, use, testInfo) => {
    const outputDir = testInfo.outputPath("protocol-evidence");
    await fs.mkdir(outputDir, { recursive: true });
    await use({ outputDir });
    const files = [
      ["browser-console.jsonl", protocolCapture.console],
      ["http-requests.jsonl", protocolCapture.httpRequests],
      ["http-responses.jsonl", protocolCapture.httpResponses],
      ["websocket-sent.jsonl", protocolCapture.websocketSent],
      ["websocket-received.jsonl", protocolCapture.websocketReceived],
      ["agent-commands.jsonl", findAgentCommands(protocolCapture.websocketSent)],
      ["turn-lifecycle.jsonl", findLifecycleEnvelopes(protocolCapture.websocketReceived)],
      ["turn-lifecycle-receipts.jsonl", findLifecycleReceipts(protocolCapture.websocketSent)],
    ];
    for (const [name, records] of files) {
      const filePath = path.join(outputDir, name);
      await writeJsonLines(filePath, records);
      await testInfo.attach(name, { path: filePath, contentType: "application/x-ndjson" });
    }
  }, { auto: true }],
});
