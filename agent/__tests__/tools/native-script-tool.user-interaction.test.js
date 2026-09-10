/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createNativeScriptTool } from "../../src/tools/execution/native-script-tool.js";
import { createPendingInteractionClock } from "../../src/tools/execution/native-script-ipc.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";
import { IDENTITY, createRuntime } from "./native-script-tool.fixtures.js";

function createClockProbe() {
  const events = [];
  const clock = createPendingInteractionClock({
    start: () => events.push("start"),
    stop: () => events.push("stop"),
  });
  return { clock, events };
}

test("pending interaction clock stops the timeout only while a user is answering", () => {
  const { clock, events } = createClockProbe();
  assert.equal(clock.pending, 0);

  clock.suspend();
  assert.equal(clock.pending, 1);
  assert.deepEqual(events, ["stop"]);

  clock.resume();
  assert.equal(clock.pending, 0);
  assert.deepEqual(events, ["stop", "start"]);
});

test("pending interaction clock keeps the timeout stopped across nested waits", () => {
  const { clock, events } = createClockProbe();

  clock.suspend();
  clock.suspend();
  clock.suspend();
  assert.equal(clock.pending, 3);
  assert.deepEqual(events, ["stop"], "only the first wait stops the clock");

  clock.resume();
  clock.resume();
  assert.deepEqual(events, ["stop"], "the clock stays stopped while waits remain");

  clock.resume();
  assert.deepEqual(events, ["stop", "start"], "the last wait restarts the clock");
  assert.equal(clock.pending, 0);
});

test("pending interaction clock ignores unbalanced resume calls", () => {
  const { clock, events } = createClockProbe();

  clock.resume();
  clock.resume();
  assert.equal(clock.pending, 0);
  assert.deepEqual(events, [], "a resume without a wait must not restart the clock");

  clock.suspend();
  clock.resume();
  clock.resume();
  assert.deepEqual(events, ["stop", "start"]);
});

async function runInteractionScript({ scriptBody, bridge, userId }) {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-script-ui-"));
  const runtime = createRuntime(basePath, {
    userInteractionBridge: bridge,
    ...(userId === undefined ? {} : { userId }),
  });
  const [tool] = createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) });
  try {
    return JSON.parse(
      await tool.invoke(
        { script_body: scriptBody },
        { configurable: { transferIdentity: IDENTITY } },
      ),
    );
  } finally {
    await fs.rm(basePath, { recursive: true, force: true });
  }
}

test("ui.waitForUser returns the answer collected through the interaction bridge", async () => {
  const requests = [];
  const result = await runInteractionScript({
    scriptBody: `const answer = await ui.waitForUser({ content: "sign in", fields: [{ name: "done", displayName: "Done", required: true, description: "" }] });
log("ANSWER:" + answer.done);`,
    bridge: {
      async requestUserInteraction(request) {
        requests.push(request);
        return { confirmed: true, done: "yes" };
      },
    },
  });

  assert.equal(result.ok, true, result.error || "");
  assert.match(result.stdout, /ANSWER:yes/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].content, "sign in");
  assert.equal(requests[0].toolName, "execute_native_script");
  assert.deepEqual(
    requests[0].fields.map((field) => field.name),
    ["done"],
  );
});

test("ui.waitForUser surfaces a cancelled interaction as a script failure", async () => {
  const result = await runInteractionScript({
    scriptBody: 'await ui.waitForUser({ content: "sign in" });',
    bridge: {
      async requestUserInteraction() {
        return { confirmed: false };
      },
    },
  });

  assert.equal(result.ok, false);
  assert.match(String(result.error || result.stderr), /cancelled/);
});

test("ui.waitForUser fails when no interaction bridge is available", async () => {
  const result = await runInteractionScript({
    scriptBody: 'await ui.waitForUser({ content: "sign in" });',
    bridge: null,
  });

  assert.equal(result.ok, false);
  assert.match(String(result.error || result.stderr), /interaction bridge is unavailable/);
});

test("ui.waitForUser resolves a plain bridge answer into a response field", async () => {
  const result = await runInteractionScript({
    scriptBody:
      'const answer = await ui.waitForUser({ content: "ping" });\nlog("ANSWER:" + answer.response);',
    bridge: {
      async requestUserInteraction() {
        return "pong";
      },
    },
  });

  assert.equal(result.ok, true, result.error || "");
  assert.match(result.stdout, /ANSWER:pong/);
});

test("ui.waitForUser keeps running past a wait longer than a fast timeout budget", async () => {
  const started = Date.now();
  const result = await runInteractionScript({
    scriptBody:
      'const answer = await ui.waitForUser({ content: "slow" });\nlog("ANSWER:" + answer.response);',
    bridge: {
      async requestUserInteraction() {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return "late";
      },
    },
  });

  assert.equal(result.ok, true, result.error || "");
  assert.match(result.stdout, /ANSWER:late/);
  assert.ok(Date.now() - started >= 1500, "the script must have waited for the human answer");
});

test("browser.closeProfile reports an untracked profile as already closed", async () => {
  const result = await runInteractionScript({
    scriptBody:
      'const closed = await browser.closeProfile({ profile: "work" });\nlog("CLOSED:" + closed.closed + ":" + closed.profileName);',
    bridge: null,
  });

  assert.equal(result.ok, true, result.error || "");
  assert.match(result.stdout, /CLOSED:false:work/);
});

test("browser.closeProfile defaults to the default profile name", async () => {
  const result = await runInteractionScript({
    scriptBody:
      'const closed = await browser.closeProfile();\nlog("CLOSED:" + closed.profileName);',
    bridge: null,
  });

  assert.equal(result.ok, true, result.error || "");
  assert.match(result.stdout, /CLOSED:default/);
});

test("browser.closeProfile rejects a traversing profile name", async () => {
  const result = await runInteractionScript({
    scriptBody: 'await browser.closeProfile({ profile: "../peer" });',
    bridge: null,
  });

  assert.equal(result.ok, false);
  assert.match(String(result.error || result.stderr), /profile name is not allowed/);
});

test("browser.closeProfile fails when the script has no profile owner", async () => {
  const result = await runInteractionScript({
    scriptBody: 'await browser.closeProfile({ profile: "work" });',
    bridge: null,
    userId: "",
  });

  assert.equal(result.ok, false);
  assert.match(String(result.error || result.stderr), /profile owner is unavailable/);
});
