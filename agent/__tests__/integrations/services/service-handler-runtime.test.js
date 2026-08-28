/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { invokeServiceHandler } from "../../../src/integrations/services/index.js";

test("service handler receives the authoritative runtime and its shared fetch", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-service-runtime-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const userId = "service-user";
  const servicesDir = path.join(workspaceRoot, userId, "services");
  await mkdir(servicesDir, { recursive: true });
  await writeFile(path.join(servicesDir, "package.json"), '{"type":"module"}\n', "utf8");
  await writeFile(
    path.join(servicesDir, "runtime-probe.js"),
    [
      "export default async function runtimeProbe({ runtime }) {",
      "  const response = await runtime.sharedTools.fetch('https://service.test/probe');",
      "  return { runtimeMarker: runtime.marker, body: await response.text() };",
      "}",
    ].join("\n"),
    "utf8",
  );
  const runtime = {
    marker: "authoritative-runtime",
    sharedTools: {
      fetch: async () => new Response("fetch-ok", { status: 200 }),
    },
  };

  const result = await invokeServiceHandler({
    agentContext: Object.freeze({}),
    runtime,
    globalConfig: { workspaceRoot },
    userId,
    serviceName: "runtime-probe",
    endpointName: "probe",
    serviceCfg: { handler: "runtime-probe" },
    endpointCfg: { url: "https://service.test/probe" },
  });

  assert.deepEqual(result, {
    runtimeMarker: "authoritative-runtime",
    body: "fetch-ok",
  });
});
