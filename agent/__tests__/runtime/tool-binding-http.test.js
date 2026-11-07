/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { AIMessage, ToolMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { structuredTool } from "../../src/tools/core/structured-tool.js";
import { tool as externalTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  MODEL_CONTEXT_SEQUENCE_POLICY,
  compileToolNamePrompt,
  createToolNameBinding,
  restoreToolOutputNames,
  projectToolMessageNames,
  TOOL_CALL_NAME_BINDING,
} from "@noobot/model-protocol";
import { runWithToolNameBinding } from "@noobot/model-protocol/tool-binding-scope-node";
import { projectSessionRecordsToContextMessages } from "@noobot/context-protocol/message/session-projection";
import { createModelContext } from "@noobot/context-protocol/assembly/hook-context";
import { assignContextMessageIdentity } from "@noobot/context-protocol/message/codec";
import { appendMessage } from "@noobot/context-protocol/message/store";
import { buildContextMessageBlocks } from "../../src/context/assembly/message-builder.js";
import { normalizeMessageEntity } from "../../src/session/entities.js";
import { createPersistedCurrentUserMessage } from "./core/message-builder-current-user-fixture.js";
import { formatToolCallsForStorage } from "../../src/runtime/turn/tool-call-message.js";
import { initializeAgentModelHost } from "../../src/runtime/model-port-host.js";
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";
import { TEST_MODEL_GLOBAL_CONFIG } from "../helpers/test-model-config.js";
import { tToolTemplate } from "../../src/tools/core/tool-i18n.js";
import { composeSystemInfoSections } from "../../src/context/formatters/system-prompt-formatter.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";
import { createHelpTool } from "../../src/tools/collaboration/help-tool.js";
import { executeToolCall } from "../../src/runtime/tool-execution/tool-runner.js";
import {
  bindTestIdentityToRuntime,
  deriveTestTurnIdentity,
} from "../helpers/test-turn-identity.js";

import { appendToolResultModelMessage } from "../../src/runtime/message-context/message-store.js";
import { buildHistoryMessages } from "../../src/context/assembly/message-builder/history.js";
import { attachmentEnvelope } from "./core/tool-runner.test-helpers.js";

const invocation = {
  flow: "test.binding",
  purpose: "test",
  domain: "primary",
  contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
};

async function createFixture(t, { bindingName = "nb_read", strict = false } = {}) {
  const requests = [];
  let respond = () => ({ name: bindingName });
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    const result = await respond(body);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "chatcmpl-binding",
        object: "chat.completion",
        created: 0,
        model: body.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-next",
                  type: "function",
                  function: {
                    name: result.name,
                    arguments: JSON.stringify(result.args || { path: "read_file" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const globalConfig = structuredClone(TEST_MODEL_GLOBAL_CONFIG);
  globalConfig.providers.test_default.base_url = `http://127.0.0.1:${server.address().port}/v1`;
  globalConfig.tools = { bindings: { read_file: { bindingName } } };
  const runtime = createTestRuntimeContext({
    globalConfig,
    userConfig: {},
    runConfig: { hookManager: null, selectedModel: "", scenario: "programming" },
  });
  const host = initializeAgentModelHost({
    runtime,
    invocationIdentity: {
      sessionId: "binding-session",
      parentSessionId: "",
      dialogProcessId: "binding-dialog",
      turnScopeId: "binding-turn",
      runId: "binding-run",
    },
  });
  const readTool = structuredTool(runtime, async ({ path }) => `executed:${path}`, {
    name: "read_file",
    description: tToolTemplate(runtime, "tools.help.description"),
    schema: z.object({
      path: z.string().describe(tToolTemplate(runtime, "tools.help.fieldCommand")),
    }),
  });
  const options = { streaming: false, toolBinding: { strict, tool_choice: "read_file" } };
  return {
    requests,
    runtime,
    readTool,
    options,
    host,
    setResponder(fn) {
      respond = fn;
    },
  };
}

for (const strict of [false, true]) {
  test(`HTTP binding projects declarations, choice and history; restores execution identity (strict=${strict})`, async (t) => {
    const fixture = await createFixture(t, { strict });
    const { requests, readTool, options, host } = fixture;
    const history = new AIMessage({
      content: "",
      tool_calls: [{ id: "call-old", name: "read_file", args: { path: "read_file" } }],
    });
    const messages = [
      new SystemMessage({ content: compileToolNamePrompt("Use {{tool:read_file}}") }),
      new HumanMessage("literal read_file"),
      history,
      new ToolMessage({
        tool_call_id: "call-old",
        name: "read_file",
        content: JSON.stringify({ ok: true, toolName: "read_file", data: "literal read_file" }),
      }),
    ];
    const response = await host.modelPort.invoke({
      messages,
      tools: [readTool],
      options,
      invocation,
    });
    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.tools[0].function.name, "nb_read");
    assert.match(request.tools[0].function.description, /--name nb_read/);
    assert.match(
      request.tools[0].function.parameters.properties.path.description,
      /--name nb_read/,
    );
    assert.equal(request.tool_choice.function.name, "nb_read");
    assert.deepEqual(request.messages[0].content, [{ type: "text", text: "Use nb_read" }]);
    assert.equal(request.messages[1].content, "literal read_file");
    assert.equal(request.messages[2].tool_calls[0].function.name, "nb_read");
    assert.equal(request.messages[3].name, "nb_read");
    assert.deepEqual(JSON.parse(request.messages[3].content), {
      ok: true,
      toolName: "nb_read",
      data: "literal read_file",
    });
    assert.equal(JSON.parse(messages[3].content).toolName, "read_file");
    assert.equal(history.tool_calls[0].name, "read_file");
    const call = response.output.toolCalls[0];
    assert.equal(call.name, "read_file");
    assert.equal(
      await runWithToolNameBinding(call[TOOL_CALL_NAME_BINDING], () => readTool.invoke(call.args)),
      "executed:read_file",
    );
    assert.equal(response.execution.attempts[0].output.toolCalls[0].name, "read_file");
    fixture.runtime.globalConfig.tools.bindings.read_file.bindingName = "renamed_read";
    fixture.setResponder(() => ({ name: "renamed_read" }));
    await host.modelPort.invoke({ messages, tools: [readTool], options, invocation });
    assert.equal(requests[1].messages[2].tool_calls[0].function.name, "renamed_read");
    assert.equal(JSON.parse(requests[1].messages[3].content).toolName, "renamed_read");
    assert.equal(requests[1].tools[0].function.name, "renamed_read");
    assert.match(JSON.stringify(requests[1].messages[0].content), /renamed_read/);
    assert.match(requests[1].tools[0].function.description, /--name renamed_read/);
    assert.match(
      requests[1].tools[0].function.parameters.properties.path.description,
      /--name renamed_read/,
    );
    assert.doesNotMatch(requests[1].tools[0].function.description, /nb_read|\{\{tool:/);
  });
}

test("in-flight config updates cannot alter the response binding", async (t) => {
  const fixture = await createFixture(t);
  fixture.setResponder(() => {
    fixture.runtime.globalConfig.tools.bindings.read_file.bindingName = "changed_during_request";
    return { name: "nb_read" };
  });
  const response = await fixture.host.modelPort.invoke({
    messages: [new HumanMessage("read")],
    tools: [fixture.readTool],
    options: fixture.options,
    invocation,
  });
  assert.equal(response.output.toolCalls[0].name, "read_file");
});

for (const ok of [true, false]) {
  test(`HTTP projects unnamed tool result identity (ok=${ok})`, async (t) => {
    const fixture = await createFixture(t);
    const result = {
      toolName: "read_file",
      ok,
      ...(ok ? {} : { code: "READ_FAILED", error: "read_file.txt unavailable" }),
      data: { toolName: "business identity", path: "read_file.txt" },
    };
    const toolMessage = new ToolMessage({
      tool_call_id: "call-old",
      content: JSON.stringify(result),
    });
    await fixture.host.modelPort.invoke({
      messages: [
        new HumanMessage("read"),
        new AIMessage({
          content: "",
          tool_calls: [{ id: "call-old", name: "read_file", args: {} }],
        }),
        toolMessage,
      ],
      tools: [fixture.readTool],
      options: fixture.options,
      invocation,
    });
    const sent = fixture.requests[0].messages[2];
    assert.deepEqual(JSON.parse(sent.content), { ...result, toolName: "nb_read" });
    assert.deepEqual(JSON.parse(toolMessage.content), result);
  });
}

test("canonical active-turn context projects tool results after metadata cloning", async (t) => {
  const fixture = await createFixture(t);
  const result = { ok: true, toolName: "read_file" };
  const context = createModelContext({
    activeTurnIdentity: { dialogProcessId: "dialog", turnScopeId: "turn" },
    messageBlocks: { system: [], history: [], incremental: [] },
  });
  for (const message of [
    new AIMessage({ content: "", tool_calls: [{ id: "read", name: "read_file", args: {} }] }),
    new ToolMessage({ tool_call_id: "read", content: JSON.stringify(result) }),
  ]) {
    appendMessage(context, assignContextMessageIdentity(message), { block: "incremental" });
  }
  const original = context.messages[1];
  assert.equal(original.type, "tool");
  assert.equal(original.getType, undefined);
  await fixture.host.modelPort.invoke({
    messages: context.messages,
    tools: [fixture.readTool],
    options: fixture.options,
    invocation,
  });
  assert.deepEqual(JSON.parse(fixture.requests[0].messages[1].content), {
    ...result,
    toolName: "nb_read",
  });
  assert.deepEqual(JSON.parse(original.content), result);
});

test("invalid tool result identity or JSON fails before HTTP", async (t) => {
  const fixture = await createFixture(t);
  for (const [content, expected] of [
    ["invalid JSON", /tool_result_not_json/],
    [JSON.stringify({ ok: true, toolName: "search" }), /tool result identity mismatch/],
  ]) {
    await assert.rejects(
      fixture.host.modelPort.invoke({
        messages: [
          new AIMessage({ content: "", tool_calls: [{ id: "bad", name: "read_file", args: {} }] }),
          new ToolMessage({ name: "read_file", tool_call_id: "bad", content }),
        ],
        tools: [fixture.readTool],
        options: fixture.options,
        invocation,
      }),
      expected,
    );
  }
  assert.equal(fixture.requests.length, 0);
});

test("unnamed results cannot claim another declared tool or an absent call over HTTP", async (t) => {
  const fixture = await createFixture(t);
  const search = externalTool(async () => "unused", {
    name: "search",
    description: "search",
    schema: z.object({}),
  });
  const history = new AIMessage({
    content: "",
    tool_calls: [{ id: "read", name: "read_file", args: {} }],
  });
  for (const [result, expected] of [
    [
      { tool_call_id: "read", content: JSON.stringify({ ok: true, toolName: "search" }) },
      /tool result identity mismatch/,
    ],
    [
      {
        tool_call_id: "read",
        name: "search",
        content: JSON.stringify({ ok: true, toolName: "search" }),
      },
      /message identity mismatch/,
    ],
    [
      { tool_call_id: "missing", content: JSON.stringify({ ok: true, toolName: "read_file" }) },
      /requires its matching call/,
    ],
  ]) {
    await assert.rejects(
      fixture.host.modelPort.invoke({
        messages: [history, new ToolMessage(result)],
        tools: [fixture.readTool, search],
        options: fixture.options,
        invocation,
      }),
      expected,
    );
  }
  assert.equal(fixture.requests.length, 0);
});

test("model calls using the old identity fail instead of reaching execution", async (t) => {
  const fixture = await createFixture(t);
  fixture.setResponder(() => ({ name: "read_file" }));
  await assert.rejects(
    fixture.host.modelPort.invoke({
      messages: [new HumanMessage("read")],
      tools: [fixture.readTool],
      options: fixture.options,
      invocation,
    }),
    /undeclared tool bindingName: read_file/,
  );
});

test("system context projects only explicit references and preserves business data over HTTP", async (t) => {
  const fixture = await createFixture(t);
  const literal = "{{tool:bad.name}} {{tool:read_file}}.txt";
  const sections = composeSystemInfoSections({
    locale: "en-US",
    systemPrompt: "Use {{tool:read_file}}",
    longMemory: literal,
    workspaceDirectories: [literal],
    skills: [{ name: literal }],
    services: [{ name: literal }],
    mcpServers: [{ name: literal }],
    scenarioSection: {
      key: literal,
      description: "Use {{tool:read_file}}",
      tools: ["read_file", "*"],
    },
  });
  const messages = buildContextMessageBlocks(
    createTestAgentExecutionScope(fixture.runtime, {
      messageBlocks: { system: JSON.parse(JSON.stringify(sections)), history: [], incremental: [] },
    }),
    { currentUserMessage: createPersistedCurrentUserMessage("read") },
  ).system;
  messages.push(new SystemMessage(`Unmarked ${literal}`));
  const invoke = () =>
    fixture.host.modelPort.invoke({
      messages,
      tools: [fixture.readTool],
      options: fixture.options,
      invocation,
    });
  await invoke();
  const sent = fixture.requests[0].messages;
  assert.deepEqual(sent[0].content, [{ type: "text", text: "Use nb_read" }]);
  assert.equal(
    sent.filter((message) => JSON.stringify(message.content).includes(literal)).length,
    7,
  );
  const scenario = sent.find((message) =>
    JSON.stringify(message.content).includes("Current scenario"),
  );
  const scenarioText = scenario.content.map((block) => block.text).join("");
  const data = JSON.parse(scenarioText.slice(scenarioText.indexOf("\n") + 1));
  assert.equal(data.key, literal);
  assert.equal(data.description, "Use nb_read");
  assert.deepEqual(data.tools, ["nb_read", "*"]);
  fixture.runtime.globalConfig.tools.bindings.read_file.bindingName = "next_read";
  fixture.setResponder(() => ({ name: "next_read" }));
  await invoke();
  assert.deepEqual(fixture.requests[1].messages[0].content, [
    { type: "text", text: "Use next_read" },
  ]);
});

for (const strict of [false, true]) {
  for (const toolId of ["read_file", "__proto__"]) {
    test(`HTTP preserves external descriptions and dynamic identity ${toolId} (strict=${strict})`, async (t) => {
      const fixture = await createFixture(t, { strict });
      fixture.runtime.globalConfig.tools.bindings = Object.fromEntries([
        [toolId, { bindingName: "safe_read" }],
      ]);
      fixture.setResponder(() => ({ name: "safe_read" }));
      const literal = "{{tool:bad.name}} {{tool:read_file}}.txt";
      const tool = externalTool(async () => "done", {
        name: toolId,
        description: literal,
        schema: z.object({ path: z.string().describe(literal) }),
      });
      const response = await fixture.host.modelPort.invoke({
        messages: [new HumanMessage("read")],
        tools: [tool],
        options: { streaming: false, toolBinding: { strict, tool_choice: toolId } },
        invocation,
      });
      const definition = fixture.requests[0].tools[0].function;
      assert.equal(definition.name, "safe_read");
      assert.equal(definition.description, literal);
      assert.equal(definition.parameters.properties.path.description, literal);
      assert.equal(response.output.toolCalls[0].name, toolId);
      assert.equal(Object.hasOwn(response.toolNameBindings, toolId), true);
    });
  }
}

test("historical-only tool choices fail before sending HTTP", async (t) => {
  const fixture = await createFixture(t);
  await assert.rejects(
    fixture.host.modelPort.invoke({
      messages: [
        new AIMessage({ content: "", tool_calls: [{ id: "retired", name: "retired", args: {} }] }),
      ],
      tools: [fixture.readTool],
      options: { toolBinding: { tool_choice: "retired" } },
      invocation,
    }),
    /undeclared tool identity: retired/,
  );
  assert.equal(fixture.requests.length, 0);
});

test("in-flight rename retains help execution, manuals and available tools from the request", async (t) => {
  const fixture = await createFixture(t);
  fixture.runtime.runConfig.scenario = "";
  fixture.runtime.globalConfig.tools.bindings.help = { bindingName: "old_help" };
  const agentContext = createTestAgentExecutionScope(fixture.runtime, {
    tools: [fixture.readTool],
  });
  const [help] = createHelpTool({ agentContext });
  agentContext.bindings.tools.push(help);
  fixture.setResponder(() => {
    fixture.runtime.globalConfig.tools.bindings.read_file.bindingName = "new_read";
    fixture.runtime.globalConfig.tools.bindings.help.bindingName = "new_help";
    return { name: "old_help", args: { command: "--tools --name nb_read" } };
  });
  const response = await fixture.host.modelPort.invoke({
    messages: [new HumanMessage("help")],
    tools: [help, fixture.readTool],
    invocation,
    options: { streaming: false, toolBinding: { tool_choice: "help" } },
  });
  const call = { ...response.output.toolCalls[0] };
  const identity = deriveTestTurnIdentity(fixture.runtime, {
    runId: "run-help",
    presentationMessageId: "presentation-help",
  });
  bindTestIdentityToRuntime(fixture.runtime, identity);
  const executionContext = createTestAgentExecutionScope(fixture.runtime, { identity });
  const run = (call) =>
    executeToolCall({
      call,
      tool: help,
      runtime: fixture.runtime,
      agentContext: executionContext,
      abortSignal: fixture.runtime.abortSignal,
      toolStartedAtMs: Date.now(),
    });
  const result = await run(call);
  const manual = JSON.parse(result.toolResultText);
  assert.equal(manual.ok, true, JSON.stringify(manual));
  assert.notEqual(manual.manual, null);
  const index = await run({ ...call, id: "index", args: {} });
  const usage = JSON.stringify(JSON.parse(index.toolResultText).usage);
  assert.match(usage, /old_help|nb_read/);
  assert.doesNotMatch(usage, /new_help|new_read/);
  const listed = await run({ ...call, id: "list", args: { command: "--tools" } });
  assert.deepEqual(JSON.parse(listed.toolResultText).toolNames, ["nb_read", "old_help"]);
  const direct = JSON.parse(await help.invoke({ command: "--tools" }));
  assert.deepEqual(direct.toolNames, ["new_help", "new_read"]);
});

test("signed calls survive session normalization and history rebuilding without changing provider payload", () => {
  const binding = createToolNameBinding({
    tools: [{ name: "read_file" }],
    bindings: { read_file: { bindingName: "nb_read" } },
  });
  const providerCall = {
    type: "function_call",
    name: "nb_read",
    signature: "opaque",
    call_id: "call-signed",
    arguments: "{}",
  };
  const output = restoreToolOutputNames(
    {
      toolCalls: [{ id: "call-signed", name: "nb_read", args: {} }],
      content: [providerCall],
      responseOutput: [providerCall],
    },
    binding,
  );
  const record = normalizeMessageEntity({
    attachments: [],
    sessionId: "s-signed",
    messageUid: "message-signed",
    modelMessageId: "model-signed",
    presentationMessageId: "presentation-signed",
    role: "assistant",
    type: "tool_call",
    content: "",
    ts: "2026-01-01T00:00:00.000Z",
    dialogProcessId: "dialog-signed",
    turnScopeId: "turn-signed",
    rawModelContent: output.content,
    modelResponseMetadata: { output: output.responseOutput },
    tool_calls: formatToolCallsForStorage(output.toolCalls),
  });
  const history = projectSessionRecordsToContextMessages(JSON.parse(JSON.stringify([record])));
  const messages = buildContextMessageBlocks(
    createTestAgentExecutionScope(createTestRuntimeContext(), {
      messageBlocks: { system: [], history, incremental: [] },
    }),
    { currentUserMessage: createPersistedCurrentUserMessage("continue") },
  ).history;
  const assistant = messages.find((message) => message instanceof AIMessage);
  assert.ok(assistant);
  const replay = projectToolMessageNames(assistant, binding.toBindingName);
  assert.deepEqual(replay.content, [providerCall]);
  assert.deepEqual(replay.response_metadata.output, [providerCall]);
  assert.equal(replay.tool_calls[0].name, "nb_read");
  assert.throws(() => projectToolMessageNames(assistant, () => "renamed_read"), /signed tool call/);
});

for (const ok of [true, false]) {
  test(`HTTP projects canonical overflow results once (ok=${ok})`, async (t) => {
    const fixture = await createFixture(t);
    const envelope = attachmentEnvelope({
      callId: "call-overflow",
      attachmentId: "overflow-output",
      name: "output.txt",
      mimeType: "text/plain",
      size: 10000,
    });
    const result = {
      toolName: "read_file",
      ok,
      ...(ok ? {} : { code: "READ_FAILED", error: "read failed" }),
      overflowed: true,
      message: "Read the referenced output",
      transferEnvelopes: [envelope],
    };
    const context = createModelContext({
      activeTurnIdentity: { dialogProcessId: "dialog", turnScopeId: "turn" },
      messageBlocks: { system: [], history: [], incremental: [] },
    });
    appendMessage(
      context,
      assignContextMessageIdentity(
        new AIMessage({
          content: "",
          tool_calls: [{ id: "call-overflow", name: "read_file", args: {} }],
        }),
      ),
      { block: "incremental" },
    );
    appendToolResultModelMessage({
      modelContext: context,
      toolCallId: "call-overflow",
      content: JSON.stringify(result),
      messageUid: "overflow-result",
    });
    const message = context.messages[1];
    assert.deepEqual(JSON.parse(message.content), result);
    for (const messages of [
      context.messages,
      buildHistoryMessages({
        effectiveHistoryMessages: context.messages,
        runtime: fixture.runtime,
      }),
    ]) {
      await fixture.host.modelPort.invoke({
        messages,
        tools: [fixture.readTool],
        options: fixture.options,
        invocation,
      });
      const sent = JSON.parse(fixture.requests.at(-1).messages[1].content);
      assert.equal(sent.toolName, "nb_read");
      assert.equal(sent.overflowed, true);
      assert.equal(sent.ok, ok);
      assert.equal(sent.transferEnvelopes, undefined);
      assert.match(sent.transfers[0].attachments[0].attachmentRef, /overflow-output$/);
      assert.deepEqual(JSON.parse(message.content), result);
    }
  });
}
