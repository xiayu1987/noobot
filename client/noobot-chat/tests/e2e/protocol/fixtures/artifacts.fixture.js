/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { captureTest } from "./protocol-capture.fixture.js";
import {
  findAgentCommands,
  findLifecycleEnvelopes,
  findLifecycleReceipts,
} from "../helpers/websocket-capture.js";

async function writeJsonLines(filePath, records) {
  const file = await fs.open(filePath, "a");
  try {
    for (const record of records) await file.write(`${JSON.stringify(record)}\n`);
  } finally {
    await file.close();
  }
}

export const artifactTest = captureTest.extend({
  protocolArtifacts: [
    async ({ protocolCapture }, use, testInfo) => {
      const outputDir = testInfo.outputPath("protocol-evidence");
      await fs.mkdir(outputDir, { recursive: true });
      const names = new Set();
      const flush = async () => {
        const snapshot = Object.fromEntries(
          Object.entries(protocolCapture).map(([key, records]) => [key, records.slice()]),
        );
        const files = [
          ["browser-console.jsonl", snapshot.console],
          ["http-requests.jsonl", snapshot.httpRequests],
          ["http-responses.jsonl", snapshot.httpResponses],
          ["websocket-sent.jsonl", snapshot.websocketSent],
          ["websocket-received.jsonl", snapshot.websocketReceived],
          ["agent-commands.jsonl", findAgentCommands(snapshot.websocketSent)],
          ["turn-lifecycle.jsonl", findLifecycleEnvelopes(snapshot.websocketReceived)],
          ["turn-lifecycle-receipts.jsonl", findLifecycleReceipts(snapshot.websocketSent)],
        ];
        for (const [name, records] of files) {
          await writeJsonLines(path.join(outputDir, name), records);
          names.add(name);
        }
        for (const [key, records] of Object.entries(snapshot))
          protocolCapture[key].splice(0, records.length);
      };
      await use({ outputDir, flush });
      await flush();
      for (const name of names) {
        const filePath = path.join(outputDir, name);
        await testInfo.attach(name, { path: filePath, contentType: "application/x-ndjson" });
      }
    },
    { auto: true },
  ],
});
