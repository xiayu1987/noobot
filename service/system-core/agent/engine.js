/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import {
  createChatModel,
  createChatModelByName,
  resolveDefaultModelSpec,
  resolveModelSpecByName,
} from "../model/index.js";
import { mergeConfig } from "../config/index.js";
import { emitEvent } from "../event/index.js";
import { isFatalError } from "../error/index.js";
import {
  resolveTurnMessagesStore,
  resolveTurnTasksStore,
} from "../context/current-turn-store.js";

function normalizeAiTextContent(aiContent) {
  if (typeof aiContent === "string") return String(aiContent || "");
  if (!Array.isArray(aiContent)) return String(aiContent || "");
  const textParts = aiContent
    .map((contentPart) => {
      if (!contentPart || typeof contentPart !== "object") return "";
      if (typeof contentPart?.text === "string") return contentPart.text;
      if (typeof contentPart?.content === "string") return contentPart.content;
      return "";
    })
    .filter(Boolean);
  return textParts.join("\n");
}

function sanitizeGeneratedArtifactName(baseName = "", mimeType = "", index = 1) {
  const safeBaseName = String(baseName || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim();
  const normalizedBaseName = safeBaseName || `generated_media_${index}`;
  const mimeExtensionMap = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "video/x-m4v": ".m4v",
  };
  const normalizedMimeType = String(mimeType || "").trim().toLowerCase();
  const extension =
    mimeExtensionMap[normalizedMimeType] ||
    (normalizedMimeType.startsWith("image/") ? ".png" : "") ||
    (normalizedMimeType.startsWith("video/") ? ".mp4" : "");
  if (!extension) return normalizedBaseName;
  if (normalizedBaseName.toLowerCase().endsWith(extension)) {
    return normalizedBaseName;
  }
  return `${normalizedBaseName}${extension}`;
}

function parseDataUrl(dataUrl = "") {
  const normalizedDataUrl = String(dataUrl || "").trim();
  const matchResult = normalizedDataUrl.match(/^data:([^;,]+)?;base64,([\s\S]+)$/i);
  if (!matchResult) return null;
  return {
    mimeType: String(matchResult[1] || "application/octet-stream")
      .trim()
      .toLowerCase(),
    contentBase64: String(matchResult[2] || "").trim(),
  };
}

function extractGeneratedMediaCandidates(aiContent) {
  if (!Array.isArray(aiContent)) return [];
  const mediaCandidates = [];
  let mediaIndex = 0;
  for (const contentPart of aiContent) {
    if (!contentPart || typeof contentPart !== "object") continue;
    const partType = String(contentPart?.type || "").trim().toLowerCase();
    if (!partType.includes("image") && !partType.includes("video")) continue;

    const imageUrl = String(contentPart?.image_url?.url || "").trim();
    const videoUrl = String(contentPart?.video_url?.url || "").trim();
    const directUrl = String(contentPart?.url || "").trim();
    const sourceType = String(contentPart?.source?.type || "").trim().toLowerCase();
    const sourceMediaType = String(contentPart?.source?.media_type || "")
      .trim()
      .toLowerCase();
    const sourceData = String(contentPart?.source?.data || "").trim();
    const chosenUrl = imageUrl || videoUrl || directUrl;
    mediaIndex += 1;

    if (sourceType === "base64" && sourceData) {
      mediaCandidates.push({
        mediaType: partType.includes("video") ? "video" : "image",
        mimeType: sourceMediaType || "application/octet-stream",
        contentBase64: sourceData,
        fileName: sanitizeGeneratedArtifactName(
          `${partType || "media"}_${mediaIndex}`,
          sourceMediaType,
          mediaIndex,
        ),
      });
      continue;
    }

    if (chosenUrl.startsWith("data:")) {
      const parsedDataUrl = parseDataUrl(chosenUrl);
      if (!parsedDataUrl) continue;
      mediaCandidates.push({
        mediaType: partType.includes("video") ? "video" : "image",
        mimeType: parsedDataUrl.mimeType,
        contentBase64: parsedDataUrl.contentBase64,
        fileName: sanitizeGeneratedArtifactName(
          `${partType || "media"}_${mediaIndex}`,
          parsedDataUrl.mimeType,
          mediaIndex,
        ),
      });
    }
  }
  return mediaCandidates;
}

async function fetchRemoteMediaArtifact(url = "", fetchImpl = null, mediaIndex = 1) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl || !/^https?:\/\//i.test(normalizedUrl)) return null;
  if (typeof fetchImpl !== "function") return null;
  const response = await fetchImpl(normalizedUrl);
  if (!response?.ok) {
    throw new Error(`fetch generated media failed: HTTP ${response?.status || 500}`);
  }
  const responseArrayBuffer = await response.arrayBuffer();
  const responseBytes = Buffer.from(responseArrayBuffer);
  const contentTypeHeader = String(response.headers?.get?.("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  return {
    mimeType: contentTypeHeader || "application/octet-stream",
    contentBase64: responseBytes.toString("base64"),
    fileName: sanitizeGeneratedArtifactName(
      `generated_media_${mediaIndex}`,
      contentTypeHeader,
      mediaIndex,
    ),
  };
}

async function persistModelGeneratedArtifacts({
  aiContent,
  runtime = {},
  eventListener = null,
  dialogProcessId = "",
  turnMessageStore = null,
}) {
  const attachmentService = runtime?.attachmentService || null;
  const userId = String(runtime?.userId || "").trim();
  if (!attachmentService || !userId) return [];
  const fetchImpl =
    typeof runtime?.sharedTools?.fetch === "function"
      ? runtime.sharedTools.fetch
      : typeof globalThis.fetch === "function"
        ? globalThis.fetch.bind(globalThis)
        : null;
  const localMediaCandidates = extractGeneratedMediaCandidates(aiContent);
  const remoteMediaCandidates = [];
  if (Array.isArray(aiContent)) {
    let remoteMediaIndex = 0;
    for (const contentPart of aiContent) {
      if (!contentPart || typeof contentPart !== "object") continue;
      const partType = String(contentPart?.type || "").trim().toLowerCase();
      if (!partType.includes("image") && !partType.includes("video")) continue;
      const imageUrl = String(contentPart?.image_url?.url || "").trim();
      const videoUrl = String(contentPart?.video_url?.url || "").trim();
      const directUrl = String(contentPart?.url || "").trim();
      const remoteUrl = imageUrl || videoUrl || directUrl;
      if (!/^https?:\/\//i.test(remoteUrl)) continue;
      remoteMediaIndex += 1;
      const remoteArtifact = await fetchRemoteMediaArtifact(
        remoteUrl,
        fetchImpl,
        remoteMediaIndex,
      );
      if (remoteArtifact) remoteMediaCandidates.push(remoteArtifact);
    }
  }
  const allMediaCandidates = [...localMediaCandidates, ...remoteMediaCandidates];
  if (!allMediaCandidates.length) return [];
  const savedRecords = await attachmentService.ingestGeneratedArtifacts({
    userId,
    artifacts: allMediaCandidates,
    generationSource: "llm_output",
  });
  const attachmentMetas = savedRecords.map((attachmentItem) => ({
    attachmentId: String(attachmentItem?.attachmentId || ""),
    name: String(attachmentItem?.name || ""),
    mimeType: String(attachmentItem?.mimeType || "application/octet-stream"),
    size: Number(attachmentItem?.size || 0),
    generatedByModel: attachmentItem?.generatedByModel === true,
    generationSource: String(attachmentItem?.generationSource || "llm_output"),
  }));
  if (!attachmentMetas.length) return [];
  if (!Array.isArray(runtime.attachmentMetas)) {
    runtime.attachmentMetas = [];
  }
  runtime.attachmentMetas = [
    ...runtime.attachmentMetas,
    ...attachmentMetas,
  ];
  turnMessageStore?.updateLast(
    { attachmentMetas },
    (messageItem) => String(messageItem?.role || "") === "assistant",
  );
  emitEvent(eventListener, "model_generated_attachments_saved", {
    dialogProcessId: String(dialogProcessId || ""),
    count: attachmentMetas.length,
  });
  return attachmentMetas;
}

function buildContextMessages(agentContext) {
  function toLangChainToolCalls(toolCalls = []) {
    return (toolCalls || [])
      .map((tc) => {
        if (!tc) return null;
        if (tc.name) {
          return {
            id: tc.id || "",
            name: tc.name,
            args: tc.args || {},
            type: "tool_call",
          };
        }
        const fn = tc.function || {};
        let args = {};
        try {
          args =
            typeof fn.arguments === "string"
              ? JSON.parse(fn.arguments || "{}")
              : fn.arguments || {};
        } catch {
          args = {};
        }
        if (!fn.name) return null;
        return {
          id: tc.id || "",
          name: fn.name,
          args,
          type: "tool_call",
        };
      })
      .filter(Boolean);
  }

  function buildHumanMessageContent(msg = {}) {
    const textContent = String(msg?.content || "");
    const attachmentMetas = Array.isArray(msg?.attachmentMetas)
      ? msg.attachmentMetas
      : Array.isArray(msg?.attachments)
        ? msg.attachments
        : [];
    if (!attachmentMetas.length) return textContent;

    const attachmentLines = attachmentMetas.map((attachmentItem, index) => {
      const attachmentId = String(attachmentItem?.attachmentId || "").trim();
      const name = String(attachmentItem?.name || "").trim();
      const mimeType = String(
        attachmentItem?.mimeType || "application/octet-stream",
      ).trim();
      const size = Number(attachmentItem?.size || 0);
      return `- [${index + 1}] id=${attachmentId || "unknown"}, name=${name || "unknown"}, mimeType=${mimeType}, size=${size}`;
    });

    const attachmentSection = [
      "[附件信息]",
      ...attachmentLines,
      "[/附件信息]",
    ].join("\n");

    if (!textContent.trim()) return attachmentSection;
    return `${textContent}\n\n${attachmentSection}`;
  }

  const out = [];
  for (const content of agentContext?.systemMessages || []) {
    out.push(new SystemMessage(content));
  }

  for (const msg of agentContext?.conversationMessages || []) {
    const role = msg.role || "";
    if (role === "assistant") {
      const toolCalls = toLangChainToolCalls(msg.tool_calls || []);
      if (toolCalls.length) {
        out.push(
          new AIMessage({
            content: msg.content || "",
            tool_calls: toolCalls,
          }),
        );
      } else {
        out.push(new AIMessage(msg.content || ""));
      }
      continue;
    }

    if (role === "tool") {
      out.push(
        new ToolMessage({
          tool_call_id: msg.tool_call_id || "",
          content: msg.content || "",
        }),
      );
      continue;
    }

    out.push(new HumanMessage(buildHumanMessageContent(msg)));
  }
  return out;
}

function resolveLlmForTurn(modelState) {
  const { runtime, globalConfig, userConfig, defaultModelSpec, eventListener } =
    modelState;
  const runtimeModel = String(runtime?.runtimeModel || "").trim();

  if (runtimeModel) {
    const runtimeSpec = resolveModelSpecByName({
      modelName: runtimeModel,
      globalConfig,
      userConfig,
      fallbackToDefault: false,
    });
    if (
      runtimeSpec?.model &&
      runtimeSpec.model !== modelState.activeModelName
    ) {
      modelState.llm = createChatModelByName(runtimeModel, {
        globalConfig,
        userConfig,
        streaming: Boolean(eventListener?.onEvent),
      });
      modelState.activeModelName = runtimeSpec.model;
      modelState.activeModelAlias = String(runtimeSpec?.alias || "").trim();
      emitEvent(eventListener, "model_switched", {
        alias: runtimeSpec?.alias || "",
        model: runtimeSpec?.model || "",
      });
    } else if (runtimeSpec?.model) {
      modelState.activeModelName = String(runtimeSpec.model || "").trim();
      modelState.activeModelAlias = String(runtimeSpec?.alias || "").trim();
    }
    return;
  }

  if (
    defaultModelSpec?.model &&
    defaultModelSpec.model !== modelState.activeModelName
  ) {
    modelState.llm = createChatModel({
      globalConfig,
      userConfig,
      streaming: Boolean(eventListener?.onEvent),
    });
    modelState.activeModelName = String(defaultModelSpec.model || "");
    modelState.activeModelAlias = String(defaultModelSpec?.alias || "").trim();
    emitEvent(eventListener, "model_switched", {
      alias: defaultModelSpec?.alias || "",
      model: defaultModelSpec?.model || "",
    });
  } else if (defaultModelSpec?.model) {
    modelState.activeModelName = String(defaultModelSpec.model || "").trim();
    modelState.activeModelAlias = String(defaultModelSpec?.alias || "").trim();
  }
}

function resolveCurrentModelInfo(modelState = {}) {
  return {
    modelAlias: String(modelState?.activeModelAlias || "").trim(),
    modelName: String(modelState?.activeModelName || "").trim(),
  };
}

function assertNotAborted(signal = null) {
  if (!signal?.aborted) return;
  const error = new Error("dialog stopped by user");
  error.name = "AbortError";
  throw error;
}

function isAbortError(error) {
  const name = String(error?.name || "").trim().toLowerCase();
  const code = String(error?.code || "").trim().toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    name === "aborterror" ||
    code === "ABORT_ERR" ||
    message.includes("aborterror") ||
    message.includes("stopped by user") ||
    message.includes("aborted")
  );
}

function mergeAttachmentMetas(existingAttachmentMetas = [], incomingAttachmentMetas = []) {
  const existingList = Array.isArray(existingAttachmentMetas)
    ? existingAttachmentMetas
    : [];
  const incomingList = Array.isArray(incomingAttachmentMetas)
    ? incomingAttachmentMetas
    : [];
  if (!incomingList.length) return existingList;
  const mergedList = [...existingList];
  const existingAttachmentIdSet = new Set(
    existingList
      .map((attachmentItem) => String(attachmentItem?.attachmentId || "").trim())
      .filter(Boolean),
  );
  for (const attachmentItem of incomingList) {
    const attachmentId = String(attachmentItem?.attachmentId || "").trim();
    if (attachmentId && existingAttachmentIdSet.has(attachmentId)) continue;
    mergedList.push(attachmentItem);
    if (attachmentId) existingAttachmentIdSet.add(attachmentId);
  }
  return mergedList;
}

function extractAttachmentMetasFromToolResult(toolName = "", toolResultText = "") {
  const normalizedToolName = String(toolName || "").trim();
  if (normalizedToolName !== "multimodal_generate") return [];
  const normalizedToolResultText = String(toolResultText || "").trim();
  if (!normalizedToolResultText) return [];
  try {
    const parsedResult = JSON.parse(normalizedToolResultText);
    const attachmentMetas = Array.isArray(parsedResult?.attachmentMetas)
      ? parsedResult.attachmentMetas
      : [];
    return attachmentMetas.map((attachmentItem) => ({
      attachmentId: String(attachmentItem?.attachmentId || "").trim(),
      name: String(attachmentItem?.name || "").trim(),
      mimeType: String(
        attachmentItem?.mimeType || "application/octet-stream",
      ).trim(),
      size: Number(attachmentItem?.size || 0),
      generatedByModel: attachmentItem?.generatedByModel === true,
      generationSource: String(attachmentItem?.generationSource || "").trim(),
    }));
  } catch {
    return [];
  }
}

async function runFunctionCallLoop({ modelState, loopState, turn = 1 }) {
  const {
    tools,
    messages,
    traces,
    turnMessages,
    currentTurnMessages,
    currentTurnTasks,
    dialogProcessId,
    maxTurns,
  } = loopState;
  const {
    eventListener,
    runtime,
    globalConfig,
    userConfig,
    defaultModelSpec,
    abortSignal,
  } = modelState;
  assertNotAborted(abortSignal);

  if (turn > maxTurns) {
    const limitMsg = `工具调用轮次已达到上限(${maxTurns})，自动结束。`;
    traces.push({ tool: "system", args: { turn, maxTurns }, result: limitMsg });
    emitEvent(eventListener, "tool_loop_limit_reached", { turn, maxTurns });
    return {
      output: limitMsg,
      traces,
      turnMessages: Array.isArray(turnMessages) ? turnMessages : [],
      turnTasks: Array.isArray(loopState?.turnTasks) ? loopState.turnTasks : [],
    };
  }

  resolveLlmForTurn(modelState);

  if (!Array.isArray(tools) || tools.length === 0) {
    emitEvent(eventListener, "llm_call_start", {
      turn,
      mode: "no_tools",
    });
    const llmCallbacks = eventListener?.onEvent
      ? [
          {
            handleLLMNewToken: (token) =>
              emitEvent(eventListener, "llm_delta", {
                text: String(token || ""),
              }),
          },
        ]
      : undefined;
    const modelResponse = await modelState.llm.invoke(messages, {
      callbacks: llmCallbacks,
      signal: abortSignal,
    });
    const responseContentText = normalizeAiTextContent(modelResponse?.content);
    messages.push(modelResponse);
    const turnMessageStore = resolveTurnMessagesStore(
      currentTurnMessages,
      turnMessages,
    );
    const currentModelInfo = resolveCurrentModelInfo(modelState);
    const turnTaskStore = resolveTurnTasksStore(
      currentTurnTasks,
      loopState.turnTasks || [],
    );
    turnMessageStore.push({
      role: "assistant",
      content: responseContentText,
      type: "message",
      dialogProcessId,
      tool_calls: [],
      modelAlias: currentModelInfo.modelAlias,
      modelName: currentModelInfo.modelName,
    });
    await persistModelGeneratedArtifacts({
      aiContent: modelResponse?.content,
      runtime,
      eventListener,
      dialogProcessId,
      turnMessageStore,
    });
    emitEvent(eventListener, "llm_call_end", {
      turn,
      hasToolCalls: false,
      mode: "no_tools",
    });
    return {
      output: responseContentText,
      traces,
      turnMessages: turnMessageStore.toArray(),
      turnTasks: turnTaskStore.toArray(),
    };
  }

  const toolMap = new Map(
    tools.map((toolDefinition) => [toolDefinition.name, toolDefinition]),
  );
  emitEvent(eventListener, "llm_call_start", { turn });
  const llmCallbacks = eventListener?.onEvent
    ? [
        {
          handleLLMNewToken: (token) =>
            emitEvent(eventListener, "llm_delta", {
              text: String(token || ""),
            }),
        },
      ]
    : undefined;

  const ai = await modelState.llm.bindTools(tools).invoke(messages, {
    callbacks: llmCallbacks,
    signal: abortSignal,
  });
  const aiContentText = normalizeAiTextContent(ai.content);
  messages.push(ai);
  const turnMessageStore = resolveTurnMessagesStore(
    currentTurnMessages,
    turnMessages,
  );
  const currentModelInfo = resolveCurrentModelInfo(modelState);
  const turnTaskStore = resolveTurnTasksStore(
    currentTurnTasks,
    loopState.turnTasks || [],
  );
  const calls = ai.tool_calls || [];
  turnMessageStore.push({
    role: "assistant",
    content: aiContentText,
    type: calls.length ? "tool_call" : "message",
    dialogProcessId,
    tool_calls: calls.length
      ? calls.map((call) => ({
          id: call.id || "",
          type: "function",
          function: {
            name: call.name || "",
            arguments: JSON.stringify(call.args || {}),
          },
        }))
      : [],
    modelAlias: currentModelInfo.modelAlias,
    modelName: currentModelInfo.modelName,
  });
  await persistModelGeneratedArtifacts({
    aiContent: ai?.content,
    runtime,
    eventListener,
    dialogProcessId,
    turnMessageStore,
  });
  emitEvent(eventListener, "llm_call_end", {
    turn,
    hasToolCalls: Boolean(calls.length),
  });

  if (!calls.length)
    return {
      output: aiContentText,
      traces,
      turnMessages: turnMessageStore.toArray(),
      turnTasks: turnTaskStore.toArray(),
    };

  emitEvent(eventListener, "tool_calls_detected", {
    turn,
    count: calls.length,
  });
  for (const call of calls) {
    assertNotAborted(abortSignal);
    emitEvent(eventListener, "tool_call_start", {
      turn,
      tool: call.name,
      args: call.args || {},
    });
    const tool = toolMap.get(call.name);
    if (!tool) {
      const notFoundMsg = `tool not found: ${call.name}`;
      traces.push({
        tool: call.name,
        args: call.args || {},
        result: notFoundMsg,
      });
      messages.push(
        new ToolMessage({ tool_call_id: call.id, content: notFoundMsg }),
      );
      turnMessageStore.push({
        role: "tool",
        content: String(notFoundMsg),
        type: "tool_result",
        dialogProcessId,
        tool_call_id: call.id || "",
      });
      continue;
    }

    let toolResultText = "";
    try {
      const result = await tool.invoke(call.args || {}, {
        signal: abortSignal,
      });
      toolResultText =
        typeof result === "string" ? result : JSON.stringify(result);
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (isFatalError(error)) throw error;
      toolResultText = `tool invoke error: ${error?.message || String(error)}`;
    }

    traces.push({
      tool: call.name,
      args: call.args || {},
      result: String(toolResultText).slice(0, 1000),
    });
    emitEvent(eventListener, "tool_call_end", {
      turn,
      tool: call.name,
      result: String(toolResultText).slice(0, 200),
    });
    messages.push(
      new ToolMessage({
        tool_call_id: call.id,
        content: String(toolResultText),
      }),
    );
    turnMessageStore.push({
      role: "tool",
      content: String(toolResultText),
      type: "tool_result",
      dialogProcessId,
      tool_call_id: call.id || "",
    });
    const extractedAttachmentMetas = extractAttachmentMetasFromToolResult(
      call.name,
      toolResultText,
    );
    if (extractedAttachmentMetas.length) {
      const assistantMessage = turnMessageStore.updateLast(
        {},
        (messageItem) => String(messageItem?.role || "").trim() === "assistant",
      );
      const mergedAttachmentMetas = mergeAttachmentMetas(
        assistantMessage?.attachmentMetas || [],
        extractedAttachmentMetas,
      );
      turnMessageStore.updateLast(
        { attachmentMetas: mergedAttachmentMetas },
        (messageItem) => String(messageItem?.role || "").trim() === "assistant",
      );
      if (!Array.isArray(runtime.attachmentMetas)) runtime.attachmentMetas = [];
      runtime.attachmentMetas = mergeAttachmentMetas(
        runtime.attachmentMetas,
        extractedAttachmentMetas,
      );
    }
  }

  loopState.turnMessages = turnMessageStore.toArray();
  loopState.turnTasks = turnTaskStore.toArray();
  return runFunctionCallLoop({ modelState, loopState, turn: turn + 1 });
}

export async function runAgentTurn({ agentContext, userMessage }) {
  const runtime = agentContext?.runtime || {};
  const sys = runtime.systemRuntime || {};
  const globalConfig = runtime.globalConfig || {};
  const userConfig = runtime.userConfig || {};
  const effectiveConfig = mergeConfig(globalConfig, userConfig);
  const eventListener = runtime.eventListener || null;
  const abortSignal = runtime.abortSignal || null;
  const dialogProcessId = sys.dialogProcessId || "";
  const tools = Array.isArray(agentContext?.tools) ? agentContext.tools : [];

  const selectedModelSpec = resolveDefaultModelSpec({
    globalConfig,
    userConfig,
  });
  const runtimeMaxTurns = Number(sys?.config?.maxToolLoopTurns || 0);
  const configMaxTurns = Number(effectiveConfig?.maxToolLoopTurns || 30);
  const maxToolLoopTurns =
    Number.isFinite(runtimeMaxTurns) && runtimeMaxTurns > 0
      ? runtimeMaxTurns
      : configMaxTurns;
  const llm = createChatModel({
    globalConfig,
    userConfig,
    streaming: Boolean(eventListener?.onEvent),
  });
  emitEvent(eventListener, "model_selected", {
    alias: selectedModelSpec?.alias || "",
    model: selectedModelSpec?.model || "",
  });

  const messages = [
    ...buildContextMessages(agentContext),
    new HumanMessage(userMessage),
  ];

  const modelState = {
    llm,
    activeModelName: selectedModelSpec?.model || "",
    activeModelAlias: selectedModelSpec?.alias || "",
    eventListener,
    runtime,
    globalConfig,
    userConfig,
    defaultModelSpec: selectedModelSpec,
    abortSignal,
  };
  const loopState = {
    tools,
    messages,
    traces: [],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: runtime?.currentTurnMessages || null,
    currentTurnTasks: runtime?.currentTurnTasks || null,
    dialogProcessId,
    maxTurns:
      Number.isFinite(maxToolLoopTurns) && maxToolLoopTurns > 0
        ? maxToolLoopTurns
        : 30,
  };
  return await runFunctionCallLoop({ modelState, loopState, turn: 1 });
}
