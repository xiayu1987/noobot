/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createInterface } from "node:readline/promises";

const clean = (value) => String(value ?? "").trim();

export const INTERACTION_UNAVAILABLE = Object.freeze({
  DISABLED: "interaction_disabled",
  ENCRYPTION_REQUIRED: "interaction_encryption_required",
});

export function classifyInteractionRequest(request = {}, { allowInteraction = false } = {}) {
  const lifecycle = clean(request.lifecycle).toLowerCase() || "pending";
  const ackMode = clean(request.ackMode).toLowerCase() || "manual";
  if (lifecycle !== "pending" || ackMode !== "manual") return { kind: "ignore" };
  if (request.requireEncryption === true) {
    return { kind: "unavailable", reason: INTERACTION_UNAVAILABLE.ENCRYPTION_REQUIRED };
  }
  if (!allowInteraction) return { kind: "unavailable", reason: INTERACTION_UNAVAILABLE.DISABLED };
  return { kind: "answer" };
}

const YES = new Set(["y", "yes", "是", "确认", "ok"]);

export function buildInteractionResponse({ fields = [], confirmed = true, answers = {} } = {}) {
  if (!confirmed) return { confirmed: false, response: clean(answers.response) };
  if (fields.length) {
    const values = {};
    for (const field of fields) {
      const name = clean(field?.name);
      if (name) values[name] = String(answers[name] ?? "");
    }
    return { confirmed: true, ...values };
  }
  return { confirmed: true, response: clean(answers.response) };
}

export async function promptInteraction(
  request = {},
  { input = process.stdin, output = process.stderr } = {},
) {
  const rl = createInterface({ input, output, terminal: Boolean(output.isTTY) });
  try {
    const fields = Array.isArray(request.fields) ? request.fields : [];
    output.write(`\n[interaction] ${clean(request.content) || clean(request.toolName)}\n`);
    if (fields.length) {
      const answers = {};
      for (const field of fields) {
        const name = clean(field?.name);
        if (!name) continue;
        const label = clean(field.displayName) || name;
        const hint = clean(field.description);
        const marker = field.required ? "*" : "";
        answers[name] = await rl.question(`${label}${marker}${hint ? ` (${hint})` : ""}: `);
      }
      return buildInteractionResponse({ fields, confirmed: true, answers });
    }
    const reply = clean(await rl.question("confirm? [y/N] or type a reply: "));
    if (!reply) return buildInteractionResponse({ confirmed: false });
    if (YES.has(reply.toLowerCase())) return buildInteractionResponse({ confirmed: true });
    if (["n", "no", "否"].includes(reply.toLowerCase()))
      return buildInteractionResponse({ confirmed: false });
    return buildInteractionResponse({ confirmed: true, answers: { response: reply } });
  } finally {
    rl.close();
  }
}
