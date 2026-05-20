/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  ACCEPTANCE_MODE,
  BLOCKED_AGENT_TOOL_NAMES,
  CAPABILITY_DOMAIN,
  LOCALE,
  TASK_ACCEPTANCE_TOOL_NAME,
  TOOL_NAME_SET,
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  attachArtifactsToAssistantResult,
  defaultTaskChecklist,
  disableBlockedCalls,
  disableBlockedToolsInRegistry,
  ensureHarnessBucket,
  extractJsonObjectFromText,
  extractRawTextContent,
  getDefaultTaskOwner,
  mapAttachmentRecordsToMetas,
  mergeAttachmentMetas,
  normalizeChecklistItem,
  resolveCapabilityModelInvoker,
  resolveCapabilityModelMessages,
  resolveCapabilityToolAllowlist,
  translateI18nText,
} from "./shared.js";

const TASK_STATUS = Object.freeze({
  COMPLETED: "completed",
  IN_PROGRESS: "in_progress",
  PENDING: "pending",
});

function evaluateTaskStatus(task = {}, state = {}) {
  const text = String(task?.task || "").toLowerCase();
  const signals = state?.signals || {};
  if (text.includes("附件") || text.includes("attachment")) {
    return signals.parsedAttachment ? TASK_STATUS.COMPLETED : TASK_STATUS.PENDING;
  }
  if ((text.includes("子任务") && text.includes("开启")) || (text.includes("subtask") && text.includes("start"))) {
    return signals.subtaskStarted ? TASK_STATUS.COMPLETED : TASK_STATUS.PENDING;
  }
  if ((text.includes("等待") && text.includes("子任务")) || (text.includes("wait") && text.includes("subtask"))) {
    return signals.subtaskWaited ? TASK_STATUS.COMPLETED : TASK_STATUS.PENDING;
  }
  return signals.successfulToolCount > 0 ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.PENDING;
}

function buildAcceptanceReport({ bucket = {}, state = {}, mode = ACCEPTANCE_MODE.ACTIVE } = {}) {
  const locale = state?.locale || LOCALE.ZH_CN;
  const checklist = Array.isArray(bucket.taskChecklist) && bucket.taskChecklist.length
    ? bucket.taskChecklist
    : defaultTaskChecklist(locale);
  const items = checklist.map((task, index) => {
    const normalized = normalizeChecklistItem(task, index, locale);
    return {
      ...normalized,
      status: evaluateTaskStatus(normalized, state),
    };
  });
  return {
    mode,
    acceptedAt: new Date().toISOString(),
    summary: {
      total: items.length,
      completed: items.filter((item) => item.status === TASK_STATUS.COMPLETED).length,
      inProgress: items.filter((item) => item.status === TASK_STATUS.IN_PROGRESS).length,
      pending: items.filter((item) => item.status === TASK_STATUS.PENDING).length,
    },
    taskChecklist: items,
  };
}

function parseSemanticValidationResult(responseText = "") {
  const parsed = extractJsonObjectFromText(responseText);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  return {
    status: "warn",
    consistent: false,
    raw: String(responseText || "").trim(),
  };
}

async function runAcceptanceBySeparateModel(ctx = {}, meta = {}, baseReport = null) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder || !baseReport) return false;
  const { bucket, state } = holder;
  const acceptanceOptions = meta?.harness?.acceptance && typeof meta.harness.acceptance === "object"
    ? meta.harness.acceptance
    : {};
  if (acceptanceOptions.semanticValidation !== true) return false;
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) return false;
  const locale = state?.locale || LOCALE.ZH_CN;
  const finalOutput = String(ctx?.result?.output || "").trim();
  const prompt = [
    locale === LOCALE.EN_US
      ? "Validate semantic consistency between the task checklist, acceptance report, tool signals, and final output. Return JSON only."
      : "请验证任务清单、规则验收报告、工具信号与最终输出之间的语义一致性。只返回 JSON。",
    JSON.stringify({
      expectedSchema: {
        status: "pass|warn|fail",
        consistent: true,
        missingItems: [],
        unsupportedClaims: [],
        checklistCoverage: [
          { index: 1, task: "...", covered: true, evidence: "...", risk: "low|medium|high" },
        ],
        suggestions: [],
      },
      taskChecklist: bucket.taskChecklist || [],
      acceptanceReport: baseReport,
      toolSignals: state.signals || {},
      finalOutput,
    }, null, 2),
  ].join("\n");
  let response = null;
  try {
    response = await invoker({
      purpose: "acceptance_semantic_validation",
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      locale,
      prompt,
      messages: resolveCapabilityModelMessages(meta, {
        ctx,
        purpose: "acceptance_semantic_validation",
        messages: Array.isArray(ctx?.messages) ? ctx.messages : [],
      }),
      ctx,
      baseReport,
      toolAllowlist: resolveCapabilityToolAllowlist(meta, "acceptance_semantic_validation"),
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: "acceptance_semantic_validation_failed",
      detail: { error: String(error?.message || error || "") },
    });
    return false;
  }
  await appendCapabilityModelTraceLog(ctx, meta, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    purpose: "acceptance_semantic_validation",
    response,
  });
  const responseText =
    extractRawTextContent(response?.content) ||
    String(response?.text || response?.output || "").trim();
  baseReport.semanticValidation = parseSemanticValidationResult(responseText);
  bucket.lastAcceptanceReport = baseReport;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    event: "acceptance_semantic_validation_completed",
    detail: { status: baseReport.semanticValidation?.status, consistent: baseReport.semanticValidation?.consistent },
  });
  return true;
}

function createRequestTaskAcceptanceTool({ bucket = {}, state = {}, ctx = {}, meta = {} } = {}) {
  const locale = state?.locale || LOCALE.ZH_CN;
  const modeDescription =
    locale === LOCALE.EN_US
      ? "Acceptance mode: active or forced."
      : "验收模式：active(主动) 或 forced(强行)。";
  return new DynamicStructuredTool({
    name: TASK_ACCEPTANCE_TOOL_NAME,
    description: translateI18nText(locale, "taskAcceptanceToolDescription"),
    schema: z.object({
      mode: z
        .enum([ACCEPTANCE_MODE.ACTIVE, ACCEPTANCE_MODE.FORCED])
        .optional()
        .describe(modeDescription),
    }),
    async func(args = {}, _runManager = null, config = {}) {
      const toolCtx = config?.configurable?.noobotHookContext || ctx;
      const toolMeta = config?.configurable?.noobotHookMeta || meta;
      const requestedMode = String(args?.mode || ACCEPTANCE_MODE.ACTIVE).trim().toLowerCase();
      const mode = requestedMode === ACCEPTANCE_MODE.FORCED ? ACCEPTANCE_MODE.FORCED : ACCEPTANCE_MODE.ACTIVE;
      state.flags.acceptanceRequested = true;
      const report = buildAcceptanceReport({ bucket, state, mode });
      bucket.lastAcceptanceReport = report;
      bucket.acceptanceReports.push(report);
      await runAcceptanceBySeparateModel(toolCtx, toolMeta, report);
      return {
        ok: true,
        status: "completed",
        tool: TASK_ACCEPTANCE_TOOL_NAME,
        report,
      };
    },
  });
}

export function ensureTaskAcceptanceTool(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const registry = ctx?.agentContext?.payload?.tools?.registry;
  if (!Array.isArray(registry)) return false;
  if (registry.some((tool) => String(tool?.name || "").trim() === TASK_ACCEPTANCE_TOOL_NAME)) {
    return false;
  }
  registry.push(createRequestTaskAcceptanceTool({ bucket, state, ctx, meta }));
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "task_acceptance_tool_injected",
  });
  return true;
}

async function maybeAttachChecklistArtifactsAtFinalOutput(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.flags.checklistArtifactsAttached === true) return false;

  const runtime = ctx?.agentContext?.execution?.controllers?.runtime || null;
  const attachmentService = runtime?.attachmentService || null;
  if (!attachmentService || typeof attachmentService.ingestGeneratedArtifacts !== "function") {
    return false;
  }
  const userId = String(
    ctx?.userId || runtime?.systemRuntime?.userId || runtime?.userId || "",
  ).trim();
  const sessionId = String(
    ctx?.sessionId || runtime?.systemRuntime?.sessionId || runtime?.sessionId || "",
  ).trim();
  if (!userId || !sessionId) return false;

  const locale = state?.locale || LOCALE.ZH_CN;
  const checklist = Array.isArray(bucket?.taskChecklist) && bucket.taskChecklist.length
    ? bucket.taskChecklist
    : defaultTaskChecklist(locale);
  const acceptanceReport =
    bucket?.lastAcceptanceReport && typeof bucket.lastAcceptanceReport === "object"
      ? bucket.lastAcceptanceReport
      : buildAcceptanceReport({ bucket, state, mode: ACCEPTANCE_MODE.FORCED });

  const artifacts = [
    {
      name: "harness-task-checklist.json",
      mimeType: "application/json",
      contentBase64: Buffer.from(
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            taskOwner: bucket?.taskOwner || getDefaultTaskOwner(locale),
            taskChecklist: checklist,
          },
          null,
          2,
        ),
        "utf8",
      ).toString("base64"),
    },
    {
      name: "harness-acceptance-checklist.json",
      mimeType: "application/json",
      contentBase64: Buffer.from(
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            report: acceptanceReport,
          },
          null,
          2,
        ),
        "utf8",
      ).toString("base64"),
    },
  ];

  let savedRecords = [];
  try {
    savedRecords = await attachmentService.ingestGeneratedArtifacts({
      userId,
      sessionId,
      attachmentSource: "model",
      generationSource: "harness_checklist",
      artifacts,
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: "checklist_artifact_attach_failed",
      detail: { error: String(error?.message || error || "") },
    });
    return false;
  }

  const metas = mapAttachmentRecordsToMetas(savedRecords);
  if (!metas.length) return false;
  if (runtime && typeof runtime === "object") {
    runtime.attachmentMetas = mergeAttachmentMetas(runtime?.attachmentMetas, metas);
  }
  attachArtifactsToAssistantResult(ctx, metas);
  state.flags.checklistArtifactsAttached = true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.ACCEPTANCE,
    event: "checklist_artifacts_attached",
    detail: { attachmentCount: metas.length },
  });
  return true;
}

async function maybeForceAcceptanceAtFinalOutput(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.flags.acceptanceRequested === true) return false;
  const report = buildAcceptanceReport({ bucket, state, mode: ACCEPTANCE_MODE.FORCED });
  bucket.lastAcceptanceReport = report;
  bucket.acceptanceReports.push(report);
  if (ctx?.result && typeof ctx.result === "object") {
    await runAcceptanceBySeparateModel(ctx, meta, report);
    const locale = state?.locale || LOCALE.ZH_CN;
    const original = String(ctx.result.output || "").trim();
    ctx.result.output = [
      original,
      "",
      translateI18nText(locale, "forcedAcceptanceHeader"),
      JSON.stringify(report, null, 2),
    ].filter(Boolean).join("\n");
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.ACCEPTANCE,
      event: "forced_acceptance_triggered",
    });
    return true;
  }
  return false;
}

async function handleAcceptanceLifecycle(point = "", ctx = {}, meta = {}) {
  let changed = false;
  if (point === "before_turn") {
    changed = disableBlockedToolsInRegistry(ctx) || changed;
    changed = ensureTaskAcceptanceTool(ctx, meta) || changed;
  }
  if (point === "before_tool_calls") {
    changed = disableBlockedCalls(ctx?.calls || []) || changed;
    changed = ensureTaskAcceptanceTool(ctx, meta) || changed;
  }
  if (point === "before_tool_call" && BLOCKED_AGENT_TOOL_NAMES.has(String(ctx?.call?.name || "").trim())) {
    ctx.call.name = TASK_ACCEPTANCE_TOOL_NAME;
    ctx.call.args = { mode: ACCEPTANCE_MODE.ACTIVE };
    changed = true;
  }
  if (point === "before_final_output") {
    changed = (await maybeForceAcceptanceAtFinalOutput(ctx, meta)) || changed;
    changed = (await maybeAttachChecklistArtifactsAtFinalOutput(ctx)) || changed;
  }
  return changed;
}

export function createAcceptanceHandler({ shouldProcessPrimaryToolHooks }) {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    if (
      ["before_tool_calls", "before_tool_call", "after_tool_call", "tool_call_error"].includes(
        String(point || "").trim(),
      ) &&
      !shouldProcessPrimaryToolHooks(ctx)
    ) {
      return { capability, point, status: "active", changed: false };
    }
    const changed = await handleAcceptanceLifecycle(point, ctx, meta);
    return { capability, point, status: "active", changed };
  };
}
