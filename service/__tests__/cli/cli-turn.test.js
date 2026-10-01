/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { AGENT_COMMAND, parseAgentCommand } from "@noobot/agent-transport-protocol";
import { TURN_EVENT, TURN_LIFECYCLE_WIRE_EVENT } from "@noobot/session-protocol";
import { INTERACTION_EVENT_TYPE } from "@noobot/event-protocol";
import { MESSAGE_EVENT_TYPE, MESSAGE_EVENT_WIRE_EVENT } from "@noobot/event-protocol/message-event";
import { CLI_ACTION, parseCliArgs } from "../../cli/cli-args.js";
import {
  buildInteractionResponse,
  classifyInteractionRequest,
} from "../../cli/interaction-prompt.js";
import { buildResult, createRenderer } from "../../cli/output.js";
import {
  buildRunCommand,
  CLI_EXIT_CODE,
  CLIENT_CLOSE_REASON,
  createCliTurnIdentity,
  runCliTurn,
  TURN_STATUS_REJECTED_REASON,
} from "../../cli/run-turn.js";
import { createTurnTracker, readMessageDelta } from "../../cli/turn-events.js";

const lifecycle = (eventType, revision, extra = {}) => ({
  event: TURN_LIFECYCLE_WIRE_EVENT,
  data: {
    payload: { eventType, revision, dialogProcessId: "dp-1", executionId: "ex-1", ...extra },
  },
});
const message = (eventType, extra = {}) => ({
  event: MESSAGE_EVENT_WIRE_EVENT,
  data: { payload: { eventType, ...extra } },
});

function sink() {
  let text = "";
  return { write: (chunk) => (text += chunk), isTTY: false, read: () => text };
}

function createFakeTransport(script, signalSource) {
  const sent = [];
  return {
    sent,
    openConnection({ onEvent }) {
      let open = true;
      let resolveClosed;
      const closed = new Promise((resolve) => (resolveClosed = resolve));
      const connection = {
        closed,
        isOpen: () => open,
        send(command) {
          sent.push(command);
          setImmediate(() => script({ command, emit: onEvent, close, signalSource }));
        },
        close: (reason) => close(reason, 1),
      };
      function close(reason, exitCode = 0) {
        if (!open) return;
        open = false;
        resolveClosed({ code: 1000, reason, exitCode });
      }
      return connection;
    },
  };
}

test("run command passes the shared protocol validation for send and continue", () => {
  const identity = createCliTurnIdentity();
  assert.match(identity.turnScopeId, /^cli-turn:/);
  const send = buildRunCommand({
    invocation: parseCliArgs(["hello"]),
    identity,
    attachments: [],
    aggregateVersion: 0,
    createSession: true,
  });
  assert.equal(parseAgentCommand(send).commandType, AGENT_COMMAND.SEND);
  assert.equal(send.session.createIfAbsent, true);
  const invocation = parseCliArgs([
    "continue",
    "--session",
    "s",
    "--dialog",
    "d",
    "--turn",
    "t",
    "go",
  ]);
  assert.equal(invocation.action, CLI_ACTION.CONTINUE);
  const cont = buildRunCommand({
    invocation,
    identity: createCliTurnIdentity({ sessionId: "s" }),
    attachments: [],
    aggregateVersion: 3,
    createSession: false,
  });
  assert.equal(parseAgentCommand(cont).commandType, AGENT_COMMAND.CONTINUE);
  assert.deepEqual(cont.continuation, { dialogProcessId: "d", turnScopeId: "t" });
});

test("tracker follows lifecycle revision and prefers authoritative final content", () => {
  const tracker = createTurnTracker({ sessionId: "s", turnScopeId: "t" });
  tracker.apply(lifecycle(TURN_EVENT.ACTION_ACCEPTED, 1));
  tracker.apply(message(MESSAGE_EVENT_TYPE.LLM_DELTA, { text: "he" }));
  tracker.apply(message(MESSAGE_EVENT_TYPE.LLM_DELTA, { text: "llo" }));
  assert.equal(tracker.content(), "hello");
  tracker.apply(message(MESSAGE_EVENT_TYPE.AUTHORITATIVE_FINAL_CONTENT, { text: "final" }));
  tracker.apply(lifecycle(TURN_EVENT.COMPLETED, 3));
  assert.equal(tracker.content(), "final");
  tracker.apply(message(MESSAGE_EVENT_TYPE.LLM_DELTA, { text: " late" }));
  assert.equal(tracker.content(), "final");
  assert.equal(tracker.state.revision, 3);
  assert.equal(tracker.state.terminal, true);
  tracker.apply(lifecycle(TURN_EVENT.FAILED, 9, { turnScopeId: "other" }));
  assert.equal(tracker.state.revision, 3);
});

test("tracker ignores activity deltas which belong to the activity timeline", () => {
  const tracker = createTurnTracker({ sessionId: "s", turnScopeId: "t" });
  const activity = message(MESSAGE_EVENT_TYPE.ACTIVITY_DELTA, {
    text: "analysis",
    activityKind: "main_model_analysis",
  });
  tracker.apply(activity);
  assert.equal(tracker.content(), "");
  assert.equal(readMessageDelta(activity), null);
});

test("interaction classification and response shapes", () => {
  assert.equal(classifyInteractionRequest({ lifecycle: "resolved" }).kind, "ignore");
  assert.equal(classifyInteractionRequest({ ackMode: "auto" }).kind, "ignore");
  assert.equal(classifyInteractionRequest({}, { allowInteraction: false }).kind, "unavailable");
  assert.equal(
    classifyInteractionRequest({ requireEncryption: true }, { allowInteraction: true }).reason,
    "interaction_encryption_required",
  );
  assert.equal(classifyInteractionRequest({}, { allowInteraction: true }).kind, "answer");
  assert.deepEqual(buildInteractionResponse({ confirmed: false }), {
    confirmed: false,
    response: "",
  });
  assert.deepEqual(
    buildInteractionResponse({ fields: [{ name: "a" }], answers: { a: "1", b: "x" } }),
    { confirmed: true, a: "1" },
  );
});

test("text renderer streams deltas and stream-json passes packets verbatim", () => {
  const out = sink();
  const err = sink();
  const text = createRenderer("text", { stdout: out, stderr: err });
  text.event(message(MESSAGE_EVENT_TYPE.LLM_DELTA, { text: "hi" }));
  text.event(message(MESSAGE_EVENT_TYPE.TOOL_CALL_START, { tool: "read_file" }));
  text.result({ content: "hi", exitCode: 0 });
  assert.equal(out.read(), "hi\n");
  assert.match(err.read(), /\[tool\] read_file/);

  const ndjson = sink();
  const stream = createRenderer("stream-json", { stdout: ndjson, stderr: sink() });
  const packet = lifecycle(TURN_EVENT.ACTION_ACCEPTED, 1);
  stream.event(packet);
  stream.result({ status: "done" });
  const lines = ndjson
    .read()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(lines[0], packet);
  assert.deepEqual(lines[1], { type: "result", status: "done" });
});

async function runScripted(script, options = {}) {
  const signalSource = new EventEmitter();
  const transport = createFakeTransport(script, signalSource);
  const identity = createCliTurnIdentity();
  const command = buildRunCommand({
    invocation: parseCliArgs(["hello"]),
    identity,
    attachments: [],
    aggregateVersion: 0,
    createSession: true,
  });
  const promise = runCliTurn({
    transport,
    authInfo: { userId: "admin" },
    command,
    identity,
    renderer: createRenderer("json", { stdout: sink(), stderr: sink() }),
    askInteraction: async () => ({ confirmed: true, response: "ok" }),
    signalSource,
    ...options,
  });
  return { transport, signalSource, promise };
}

test("completed turn returns the service exit code and content", async () => {
  const { promise } = await runScripted(({ command, emit, close }) => {
    if (command.commandType !== AGENT_COMMAND.SEND) return;
    emit(lifecycle(TURN_EVENT.ACTION_ACCEPTED, 1));
    emit(message(MESSAGE_EVENT_TYPE.AUTHORITATIVE_FINAL_CONTENT, { text: "answer" }));
    emit(lifecycle(TURN_EVENT.COMPLETED, 2));
    close("done", 0);
  });
  const run = await promise;
  assert.equal(run.exitCode, CLI_EXIT_CODE.DONE);
  assert.equal(buildResult(run).content, "answer");
  assert.equal(buildResult(run).dialogProcessId, "dp-1");
});

test("Ctrl-C after acceptance sends turn.stop with the latest revision", async () => {
  const { transport, promise } = await runScripted(({ command, emit, close, signalSource }) => {
    if (command.commandType === AGENT_COMMAND.SEND) {
      emit(lifecycle(TURN_EVENT.ACTION_ACCEPTED, 2));
      setImmediate(() => signalSource.emit("SIGINT"));
    } else if (command.commandType === AGENT_COMMAND.STOP) {
      emit(lifecycle(TURN_EVENT.STOP_COMPLETED, 4));
      close("user_stopped", 130);
    }
  });
  const run = await promise;
  const stop = transport.sent.find((item) => item.commandType === AGENT_COMMAND.STOP);
  assert.equal(stop.concurrency.expectedTurnRevision, 2);
  assert.equal(stop.identity.dialogProcessId, "dp-1");
  assert.equal(stop.stop.executionId, "ex-1");
  assert.equal(run.exitCode, CLI_EXIT_CODE.STOPPED);
});

test("status persistence failure is retryable only before acceptance", async () => {
  const rejectedBefore = await (
    await runScripted(({ close }) => close(TURN_STATUS_REJECTED_REASON, 2))
  ).promise;
  assert.equal(rejectedBefore.rejected, true);
  const rejectedAfter = await (
    await runScripted(({ command, emit, close }) => {
      if (command.commandType !== AGENT_COMMAND.SEND) return;
      emit(lifecycle(TURN_EVENT.ACTION_ACCEPTED, 1));
      close(TURN_STATUS_REJECTED_REASON, 2);
    })
  ).promise;
  assert.equal(rejectedAfter.rejected, false);
});

test("Ctrl-C before acceptance closes locally with a client reason", async () => {
  const { transport, promise } = await runScripted(({ signalSource }) => {
    setImmediate(() => signalSource.emit("SIGINT"));
  });
  const run = await promise;
  assert.equal(run.outcome.reason, CLIENT_CLOSE_REASON.INTERRUPTED);
  assert.equal(run.exitCode, CLI_EXIT_CODE.STOPPED);
  assert.equal(
    transport.sent.some((item) => item.commandType === AGENT_COMMAND.STOP),
    false,
  );
});

test("interaction is answered with interaction.response; unavailable stops with exit 3", async () => {
  const request = {
    event: INTERACTION_EVENT_TYPE.REQUEST,
    data: {
      payload: {
        requestId: "r1",
        dialogProcessId: "dp-1",
        lifecycle: "pending",
        ackMode: "manual",
      },
    },
  };
  const answered = await runScripted(
    ({ command, emit, close }) => {
      if (command.commandType === AGENT_COMMAND.SEND) {
        emit(lifecycle(TURN_EVENT.ACTION_ACCEPTED, 1));
        emit(request);
      } else if (command.commandType === AGENT_COMMAND.INTERACTION_RESPONSE) {
        close("done", 0);
      }
    },
    { allowInteraction: true },
  );
  await answered.promise;
  const response = answered.transport.sent.find(
    (item) => item.commandType === AGENT_COMMAND.INTERACTION_RESPONSE,
  );
  assert.equal(response.commandId, "interaction:r1");
  assert.deepEqual(response.interaction, {
    requestId: "r1",
    response: { confirmed: true, response: "ok" },
  });

  const blocked = await runScripted(({ command, emit, close }) => {
    if (command.commandType === AGENT_COMMAND.SEND) {
      emit(lifecycle(TURN_EVENT.ACTION_ACCEPTED, 1));
      emit(request);
    } else if (command.commandType === AGENT_COMMAND.STOP) {
      close("user_stopped", 130);
    }
  });
  const run = await blocked.promise;
  assert.equal(run.exitCode, CLI_EXIT_CODE.INTERACTION_UNAVAILABLE);
});
