/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function getByPath(obj = {}, pathText = "") {
  const parts = String(pathText || "")
    .split(".")
    .map((item) => item.trim())
    .filter(Boolean);
  let cursor = obj;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function parseLiteral(raw = "") {
  const text = String(raw || "").trim();
  if (!text.length) return "";
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if (text === "undefined") return undefined;
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric;
  return text;
}

function splitArgs(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return [];
  return text.split(",").map((item) => item.trim()).filter(Boolean);
}

function resolveConditionContext(bizinst = null) {
  const business = bizinst?.getBusiness?.();
  const context = {};
  const candidates = [business?.conditionContext, business?.context, business?.variables];
  for (const item of candidates) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      Object.assign(context, item);
    }
  }
  return context;
}

export function evaluateFlowCondition(condition = "", bizinst = null) {
  const expr = String(condition || "").trim();
  if (!expr) return true;
  const lower = expr.toLowerCase();
  if (lower === "true" || lower === "always") return true;
  if (lower === "false" || lower === "never") return false;
  const call = expr.match(/^([a-zA-Z_]\w*)\(([\s\S]*)\)$/);
  if (!call) return false;
  const fn = String(call[1] || "").trim().toLowerCase();
  const args = splitArgs(call[2] || "");
  const pathText = String(args[0] || "").trim();
  const left = getByPath(resolveConditionContext(bizinst), pathText);
  if (fn === "exists") return left !== undefined && left !== null;
  if (fn === "eq") return left === parseLiteral(args[1]);
  if (fn === "ne") return left !== parseLiteral(args[1]);
  if (fn === "gt") return Number(left) > Number(parseLiteral(args[1]));
  if (fn === "gte") return Number(left) >= Number(parseLiteral(args[1]));
  if (fn === "lt") return Number(left) < Number(parseLiteral(args[1]));
  if (fn === "lte") return Number(left) <= Number(parseLiteral(args[1]));
  if (fn === "in") return args.slice(1).map((arg) => parseLiteral(arg)).includes(left);
  return false;
}

