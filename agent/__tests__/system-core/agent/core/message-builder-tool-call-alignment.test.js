import test from "node:test";
import assert from "node:assert/strict";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";

import {
  buildContextMessages,
  buildContextMessageBlocks,
} from "../../../../src/system-core/agent/core/context/message-builder.js";
import { MAIN_MODEL_HISTORY_ROUND_LIMIT } from "../../../../src/system-core/session/utils/context-window-normalizer.js";

function buildRoundContents(fromRound, toRound) {
  return Array.from(
    { length: Math.max(0, toRound - fromRound + 1) },
    (_, index) => {
      const number = fromRound + index;
      return [`u-${number}`, `a-${number}`];
    },
  ).flat();
}

function buildDefaultHistoryRounds() {
  const totalRounds = MAIN_MODEL_HISTORY_ROUND_LIMIT + 2;
  return Array.from({ length: totalRounds }, (_, index) => [
    {
      role: "user",
      content: `u-${index + 1}`,
      dialogProcessId: `dlg-${index + 1}`,
    },
    {
      role: "assistant",
      content: `a-${index + 1}`,
      dialogProcessId: `dlg-${index + 1}`,
    },
  ]).flat();
}

function expectedDefaultHistoryContents() {
  const totalRounds = MAIN_MODEL_HISTORY_ROUND_LIMIT + 2;
  return buildRoundContents(totalRounds - MAIN_MODEL_HISTORY_ROUND_LIMIT + 1, totalRounds);
}

test("buildContextMessages drops orphan tool results without matching assistant tool_call", () => {
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {},
        },
      },
      payload: {
        messages: {
          system: [],
          history: [
            {
              role: "user",
              content: "q-1",
              dialogProcessId: "dlg-tool",
            },
            {
              role: "assistant",
              content: "",
              dialogProcessId: "dlg-tool",
              tool_calls: [
                {
                  id: "call_ok_1",
                  function: {
                    name: "task_summary",
                    arguments: "{}",
                  },
                },
              ],
            },
            {
              role: "tool",
              content: "{\"ok\":true}",
              tool_call_id: "call_ok_1",
              dialogProcessId: "dlg-tool",
            },
            {
              role: "tool",
              content: "{\"ok\":true}",
              tool_call_id: "call_orphan_1",
              dialogProcessId: "dlg-tool",
            },
            {
              role: "assistant",
              content: "final",
              dialogProcessId: "dlg-tool",
            },
          ],
        },
      },
    },
    { currentUserMessage: "" },
  );

  const toolMessages = messages.filter((item) => item instanceof ToolMessage);
  assert.equal(toolMessages.length, 1);
  assert.equal(toolMessages[0].tool_call_id, "call_ok_1");
});


test("buildContextMessages converts orphan task_summary tool result to user summary message", () => {
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {},
        },
      },
      payload: {
        messages: {
          system: [],
          history: [
            {
              role: "user",
              content: "q-summary",
              dialogProcessId: "dlg-summary",
            },
            {
              role: "tool",
              content: "{\"toolName\":\"task_summary\",\"ok\":true,\"phaseSummary\":\"孤立小结内容\"}",
              tool_call_id: "call_orphan_summary",
              dialogProcessId: "dlg-summary",
              turnScopeId: "turn-summary",
            },
            {
              role: "assistant",
              content: "done",
              dialogProcessId: "dlg-summary",
            },
          ],
        },
      },
    },
    { currentUserMessage: "" },
  );

  assert.equal(messages.some((item) => item instanceof ToolMessage), false);
  const humanMessage = messages.find(
    (item) => item instanceof HumanMessage && String(item.content || "").includes("[阶段小结]"),
  );
  assert.ok(humanMessage);
  assert.equal(String(humanMessage.content || "").includes("[阶段小结]"), true);
  assert.equal(String(humanMessage.content || "").includes("孤立小结内容"), true);
});

test("buildContextMessages keeps explicit history dialog groups in natural order", () => {
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {
            systemRuntime: {
              dialogProcessId: "dlg_current",
            },
          },
        },
      },
      payload: {
        messages: {
          system: [],
          history: [
            {
              role: "user",
              content: "当前问题",
              dialogProcessId: "dlg_newer",
            },
            {
              role: "assistant",
              content: "当前对话注入",
              injectedMessage: true,
              injectedBy: "agent-plugin",
              dialogProcessId: "dlg_newer",
            },
            {
              role: "assistant",
              content: "旧对话注入",
              injectedMessage: true,
              injectedBy: "agent-plugin",
              dialogProcessId: "dlg_old",
            },
          ],
        },
      },
    },
    { currentUserMessage: "" },
  );

  assert.equal(messages.some((item) => item?.content === "当前对话注入"), true);
  assert.equal(messages.some((item) => item?.content === "旧对话注入"), true);
});

test("buildContextMessages applies main model recent round window by default", () => {
  const history = buildDefaultHistoryRounds();
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {},
        },
      },
      payload: {
        messages: {
          system: [],
          history,
        },
      },
    },
    { currentUserMessage: "" },
  );

  assert.deepEqual(
    messages.map((item) => item?.content),
    expectedDefaultHistoryContents(),
  );
});

test("buildContextMessages keeps harness plugin history aligned with main recent rounds", () => {
  const history = buildDefaultHistoryRounds();
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {
            globalConfig: {
              plugins: {
                harness: {
                  enabled: true,
                  mode: "on",
                },
              },
            },
          },
        },
      },
      payload: {
        messages: {
          system: [],
          history,
        },
      },
    },
    { currentUserMessage: "" },
  );

  assert.deepEqual(
    messages.map((item) => item?.content),
    expectedDefaultHistoryContents(),
  );
});

test("buildContextMessageBlocks splits system/history/incremental and preserves concat order", () => {
  const blocks = buildContextMessageBlocks(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "u1",
            systemRuntime: {
              sessionId: "s1",
              dialogProcessId: "dlg1",
            },
          },
        },
      },
      payload: {
        messages: {
          system: ["sys-1"],
          history: [
            { role: "user", content: "h-u", dialogProcessId: "dlg-history" },
            { role: "assistant", content: "h-1", dialogProcessId: "dlg-history" },
          ],
        },
      },
    },
    { currentUserMessage: "u-1" },
  );

  assert.equal(Array.isArray(blocks.system), true);
  assert.equal(Array.isArray(blocks.history), true);
  assert.equal(Array.isArray(blocks.incremental), true);
  assert.equal(blocks.system.length, 1);
  assert.equal(blocks.history.length, 2);
  assert.equal(blocks.incremental.length, 2);
  assert.equal(blocks.messages.length, 5);
  assert.equal(blocks.messages[0]?.content, "sys-1");
  assert.equal(blocks.messages[1]?.content, "h-u");
  assert.equal(blocks.messages[2]?.content, "h-1");
  assert.equal(blocks.messages[3]?.content, "u-1");
});

test("buildContextMessageBlocks appends resume user message meta with attachments", () => {
  const blocks = buildContextMessageBlocks(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "admin",
            userMessageAttachments: [
              {
                attachmentId: "att-1",
                name: "resume.txt",
                mimeType: "text/plain",
                attachmentSource: "user",
                sessionId: "s1",
                parsedResult: { text: "parsed attachment" },
              },
            ],
            systemRuntime: {
              sessionId: "s1",
              parentSessionId: "parent-s1",
              dialogProcessId: "dlg-resume-new",
              parentDialogProcessId: "dlg-stopped",
              turnScopeId: "turn-resume-new",
            },
          },
        },
      },
      payload: {
        messages: {
          system: ["snapshot system"],
          history: [
            { role: "user", content: "snapshot user", dialogProcessId: "dlg-stopped", turnScopeId: "turn-stopped" },
            { role: "assistant", content: "snapshot assistant", dialogProcessId: "dlg-stopped", turnScopeId: "turn-stopped" },
          ],
        },
      },
    },
    { currentUserMessage: "resume question" },
  );

  assert.equal(blocks.system[0]?.content, "snapshot system");
  assert.equal(blocks.history[0]?.content, "snapshot user");
  assert.equal(
    blocks.history.some((message) => message?.content === "snapshot assistant"),
    true,
  );
  assert.equal(
    blocks.history.some(
      (message) => message?.additional_kwargs?.noobotInternalMessageType === "user_meta" &&
        String(message?.content || "").includes('"dialogProcessId": "dlg-stopped"'),
    ),
    true,
  );
  assert.equal(blocks.incremental[0]?.content, "resume question");
  const meta = blocks.incremental[1]?.content || "";
  assert.match(meta, /\[用户元信息\]/);
  assert.match(meta, /"attachmentId": "att-1"/);
  assert.match(meta, /"name": "resume.txt"/);
  assert.match(meta, /"dialogProcessId": "dlg-resume-new"/);
  assert.match(meta, /"turnScopeId": "turn-resume-new"/);
});

test("buildContextMessageBlocks restores stopped snapshot incremental before current resume input", () => {
  const blocks = buildContextMessageBlocks(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "admin",
            resumeFromStoppedSnapshot: true,
            resumedStoppedSnapshotMessageBlocks: {
              system: ["[HARNESS_POLICY_SELECTION]\nsnapshot policy"],
              history: [
                { role: "user", content: "snapshot history user", dialogProcessId: "dlg-stopped", turnScopeId: "turn-stopped" },
              ],
              incremental: [
                { role: "assistant", content: "snapshot partial assistant", dialogProcessId: "dlg-stopped", turnScopeId: "turn-stopped" },
              ],
            },
            userMessageAttachments: [
              { attachmentId: "att-resume", name: "resume.png", mimeType: "image/png" },
            ],
            systemRuntime: {
              sessionId: "s1",
              dialogProcessId: "dlg-current",
              parentDialogProcessId: "dlg-stopped",
              turnScopeId: "turn-current",
            },
          },
        },
      },
      payload: {
        messages: {
          system: ["[HARNESS_POLICY_SELECTION]\nsnapshot policy"],
          history: [
            { role: "user", content: "snapshot history user", dialogProcessId: "dlg-stopped", turnScopeId: "turn-stopped" },
          ],
        },
      },
    },
    { currentUserMessage: "resume user input" },
  );

  assert.equal(blocks.system.length, 1);
  assert.equal(blocks.system[0]?.content, "[HARNESS_POLICY_SELECTION]\nsnapshot policy");
  assert.equal(blocks.history[0]?.content, "snapshot history user");
  assert.equal(blocks.incremental[0]?.content, "snapshot partial assistant");
  assert.equal(blocks.incremental[1]?.content, "resume user input");
  assert.match(String(blocks.incremental[2]?.content || ""), /\[用户元信息\]/);
  assert.match(String(blocks.incremental[2]?.content || ""), /"attachmentId": "att-resume"/);
  const contents = blocks.messages.map((message) => message?.content);
  assert.equal(contents[0], "[HARNESS_POLICY_SELECTION]\nsnapshot policy");
  assert.equal(contents[1], "snapshot history user");
  assert.equal(contents.indexOf("snapshot partial assistant") < contents.indexOf("resume user input"), true);
  assert.equal(contents.indexOf("resume user input") < contents.length - 1, true);
  assert.match(String(contents[contents.length - 1] || ""), /"dialogProcessId": "dlg-current"/);
});

test("buildContextMessageBlocks preserves LangChain stopped snapshot tool messages on resume", async () => {
  const { AIMessage, ToolMessage } = await import("@langchain/core/messages");
  const blocks = buildContextMessageBlocks(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "admin",
            resumeFromStoppedSnapshot: true,
            resumedStoppedSnapshotMessageBlocks: {
              system: ["snapshot system"],
              history: [],
              incremental: [
                new AIMessage({
                  content: "",
                  tool_calls: [{ id: "call_resume_1", name: "read_file", args: { filePath: "a.txt" } }],
                }),
                new ToolMessage({
                  tool_call_id: "call_resume_1",
                  content: "tool result text",
                }),
              ],
            },
            userMessageAttachments: [],
            systemRuntime: {
              sessionId: "s1",
              dialogProcessId: "dlg-current",
              parentDialogProcessId: "dlg-stopped",
              turnScopeId: "turn-current",
            },
          },
        },
      },
      payload: {
        messages: {
          system: ["snapshot system"],
          history: [],
        },
      },
    },
    { currentUserMessage: "resume user input" },
  );

  assert.equal(blocks.incremental[0]?._getType?.(), "ai");
  assert.equal(blocks.incremental[0]?.tool_calls?.[0]?.id, "call_resume_1");
  assert.equal(blocks.incremental[1]?._getType?.(), "tool");
  assert.equal(blocks.incremental[1]?.tool_call_id, "call_resume_1");
  assert.equal(blocks.incremental[1]?.content, "tool result text");
  assert.equal(blocks.incremental[2]?._getType?.(), "human");
  assert.equal(blocks.incremental[2]?.content, "resume user input");
  assert.equal(
    blocks.messages.some((message) => message?._getType?.() === "human" && String(message?.content || "") === ""),
    false,
  );
});

test("buildContextMessageBlocks removes current turn user residue from history", () => {
  const blocks = buildContextMessageBlocks(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "u1",
            systemRuntime: {
              sessionId: "s1",
              dialogProcessId: "dlg-current",
              turnScopeId: "client-turn:mqrt1icf:lxcfigpr",
            },
          },
        },
      },
      payload: {
        messages: {
          system: [],
          history: [
            {
              role: "user",
              content: "上一轮问题",
              dialogProcessId: "dlg-old",
              turnScopeId: "client-turn:old",
            },
            {
              role: "assistant",
              content: "上一轮回答",
              dialogProcessId: "dlg-old",
              turnScopeId: "client-turn:old",
            },
            {
              role: "user",
              content: "全仓回归测试",
              dialogProcessId: "dlg-resend-stale",
              turnScopeId: "client-turn:mqrt1icf:lxcfigpr",
            },
          ],
        },
      },
    },
    { currentUserMessage: "全仓回归测试" },
  );

  const visibleContents = blocks.messages
    .map((message) => message?.content)
    .filter((content) => typeof content === "string");

  assert.equal(
    visibleContents.filter((content) => content === "全仓回归测试").length,
    1,
  );
  assert.equal(blocks.history.length, 2);
  assert.equal(blocks.incremental[0]?.content, "全仓回归测试");
  assert.equal(blocks.incremental[0]?.additional_kwargs?.frontendUserMessage, true);
  assert.equal(
    blocks.incremental[0]?.additional_kwargs?.turnScopeId,
    "client-turn:mqrt1icf:lxcfigpr",
  );
  assert.equal(blocks.incremental[0]?.additional_kwargs?.dialogProcessId, "dlg-current");
  assert.equal(
    blocks.incremental[1]?.additional_kwargs?.noobotInternalMessageType,
    "user_meta",
  );
  assert.equal(
    blocks.incremental[1]?.additional_kwargs?.turnScopeId,
    "client-turn:mqrt1icf:lxcfigpr",
  );
});

test("buildContextMessageBlocks does not duplicate frontend current user already in incremental payload", () => {
  const blocks = buildContextMessageBlocks(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "u1",
            systemRuntime: {
              sessionId: "s1",
              dialogProcessId: "dlg-current",
              turnScopeId: "client-turn:current",
            },
          },
        },
      },
      payload: {
        messages: {
          system: [],
          history: [
            {
              role: "user",
              content: "上一轮",
              dialogProcessId: "dlg-old",
              turnScopeId: "client-turn:old",
            },
            {
              role: "assistant",
              content: "上一轮回答",
              dialogProcessId: "dlg-old",
              turnScopeId: "client-turn:old",
            },
          ],
          incremental: [
            {
              role: "user",
              content: "全仓回归测试",
              frontendUserMessage: true,
              dialogProcessId: "dlg-current",
              turnScopeId: "client-turn:current",
            },
          ],
        },
      },
    },
    { currentUserMessage: "全仓回归测试" },
  );

  const visibleContents = blocks.messages
    .map((message) => message?.content)
    .filter((content) => typeof content === "string");

  assert.equal(
    visibleContents.filter((content) => content === "全仓回归测试").length,
    1,
  );
  assert.equal(blocks.incremental[0]?.content, "全仓回归测试");
  assert.equal(blocks.incremental[0]?.additional_kwargs?.frontendUserMessage, true);
  assert.equal(blocks.incremental[0]?.additional_kwargs?.turnScopeId, "client-turn:current");
  assert.equal(
    blocks.incremental[1]?.additional_kwargs?.noobotInternalMessageType,
    "user_meta",
  );
});

test("buildContextMessageBlocks builds user_meta with source info for historical user attachments", () => {
  const blocks = buildContextMessageBlocks({
    execution: {
      controllers: {
        runtime: {
          userId: "u1",
          systemRuntime: {
            sessionId: "s1",
            dialogProcessId: "dlg-current",
            turnScopeId: "client-turn:current",
          },
        },
      },
    },
    payload: {
      messages: {
        system: [],
        history: [
          {
            role: "user",
            content: "历史附件问题",
            dialogProcessId: "dlg-history",
            turnScopeId: "client-turn:history",
            attachments: [
              {
                attachmentId: "att-history-1",
                name: "history.md",
                mimeType: "text/markdown",
                attachmentSource: "user",
                sessionId: "s-history",
                relativePath: "runtime/attach/scoped/s-history/user/att-history-1.md",
                sandboxPath: "/workspace/primary-user/runtime/attach/scoped/s-history/user/att-history-1.md",
                size: 42,
                isSandbox: true,
              },
            ],
          },
          {
            role: "assistant",
            content: "历史回答",
            dialogProcessId: "dlg-history",
            turnScopeId: "client-turn:history",
          },
        ],
      },
    },
  });

  assert.equal(blocks.history.length, 3);
  assert.equal(blocks.history[0]?.content, "历史附件问题");
  assert.equal(blocks.history[1]?.additional_kwargs?.noobotInternalMessageType, "user_meta");
  assert.equal(blocks.history[2]?.content, "历史回答");

  const metaContent = blocks.history[1]?.content || "";
  const metaPayload = JSON.parse(metaContent.match(/\n([\s\S]*)\n\[\//)?.[1] || "{}");
  assert.deepEqual(metaPayload.attachments, [
    {
      attachmentId: "att-history-1",
      name: "history.md",
      mimeType: "text/markdown",
      attachmentSource: "user",
      sessionId: "s-history",
      path: "",
      relativePath: "runtime/attach/scoped/s-history/user/att-history-1.md",
      sandboxPath: "/workspace/primary-user/runtime/attach/scoped/s-history/user/att-history-1.md",
      downloadUrl: "",
      previewUrl: "",
      parsedResultUrl: "",
      parsedResultName: "",
      parsedResultAttachmentId: "",
      transferFilePath: "",
      size: 42,
      isSandbox: true,
    },
  ]);
});

test("buildContextMessageBlocks keeps historical user without attachments as plain history", () => {
  const blocks = buildContextMessageBlocks({
    execution: { controllers: { runtime: { userId: "u1", systemRuntime: { sessionId: "s1" } } } },
    payload: {
      messages: {
        system: [],
        history: [
          { role: "user", content: "无附件历史", dialogProcessId: "dlg-plain" },
          { role: "assistant", content: "普通回答", dialogProcessId: "dlg-plain" },
        ],
      },
    },
  });

  assert.equal(blocks.history.length, 2);
  assert.equal(blocks.history[0]?.content, "无附件历史");
  assert.equal(blocks.history[0]?.additional_kwargs?.noobotInternalMessageType, undefined);
  assert.equal(blocks.history[1]?.content, "普通回答");
});

test("buildContextMessageBlocks keeps previous history rounds with same user text", () => {
  const blocks = buildContextMessageBlocks(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "u1",
            systemRuntime: {
              sessionId: "s1",
              dialogProcessId: "dlg-current",
              turnScopeId: "client-turn:current",
            },
          },
        },
      },
      payload: {
        messages: {
          system: [],
          history: [
            {
              role: "user",
              content: "全仓回归测试",
              dialogProcessId: "dlg-old-same-text",
              turnScopeId: "client-turn:old-same-text",
            },
            {
              role: "assistant",
              content: "旧同文本回答",
              dialogProcessId: "dlg-old-same-text",
              turnScopeId: "client-turn:old-same-text",
            },
            {
              role: "user",
              content: "项目中 不光工作流插件  其他 的 dialogId  都收敛完了吗",
              dialogProcessId: "dlg-old-other",
              turnScopeId: "client-turn:old-other",
            },
            {
              role: "assistant",
              content: "旧不同文本回答",
              dialogProcessId: "dlg-old-other",
              turnScopeId: "client-turn:old-other",
            },
          ],
        },
      },
    },
    { currentUserMessage: "全仓回归测试" },
  );

  const visibleContents = blocks.messages
    .map((message) => message?.content)
    .filter((content) => typeof content === "string");

  assert.equal(
    visibleContents.filter((content) => content === "全仓回归测试").length,
    2,
  );
  assert.equal(visibleContents.includes("旧同文本回答"), true);
  assert.equal(visibleContents.includes("旧不同文本回答"), true);
});

test("buildContextMessageBlocks keeps latest repeated next-step dialog rounds", () => {
  const history = [];
  for (const id of ["dlg_1", "dlg_2", "dlg_3", "dlg_4", "dlg_5"]) {
    history.push({
      role: "user",
      content: "下一步",
      dialogProcessId: id,
      turnScopeId: `turn:${id}`,
    });
    history.push({
      role: "assistant",
      content: `${id} answer`,
      dialogProcessId: id,
      turnScopeId: `turn:${id}`,
    });
  }

  const blocks = buildContextMessageBlocks(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "u1",
            systemRuntime: {
              sessionId: "s1",
              dialogProcessId: "dlg_current",
              turnScopeId: "turn:current",
            },
          },
        },
      },
      payload: {
        messages: {
          system: [],
          history,
        },
      },
    },
    { currentUserMessage: "下一步" },
  );

  const visibleContents = blocks.messages
    .map((message) => message?.content)
    .filter((content) => typeof content === "string");

  assert.equal(visibleContents.filter((content) => content === "下一步").length, 6);
  for (const id of ["dlg_1", "dlg_2", "dlg_3", "dlg_4", "dlg_5"]) {
    assert.equal(visibleContents.includes(`${id} answer`), true, id);
  }
});
