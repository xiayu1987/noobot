/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { translate } from "./i18n.js";

const OPTIONAL_VALUES = {
  temperature: 0.7,
  top_p: 1,
  max_output_tokens: 1024,
  max_completion_tokens: 1024,
  reasoning: { effort: "low" },
  reasoning_effort: "low",
  service_tier: "auto",
  store: false,
  stream: false,
  tools: [],
  tool_choice: "auto",
  parallel_tool_calls: false,
  prompt_cache_key: "noobot-model-access-test",
  metadata: {},
};
const MINIMAL_FIELDS = new Set(["model", "messages", "input", "max_tokens"]);
const TOOL_FIELDS = new Set(["tools", "tool_choice", "parallel_tool_calls"]);

export function parseImportedRequest(text) {
  let body;
  let protocol;
  if (text.includes("[Request]")) {
    const requestSection = text.slice(text.indexOf("[Request]"));
    const start = requestSection.indexOf("Body:");
    if (start < 0) throw new Error(translate("importError"));
    const rawBody = requestSection.slice(start + "Body:".length).trimStart();
    const end = rawBody.indexOf("\n================");
    body = JSON.parse(end < 0 ? rawBody : rawBody.slice(0, end));
    if (/URL:.*\/responses/.test(requestSection.split("Body:")[0])) protocol = "responses";
    else if (/URL:.*\/chat\/completions/.test(requestSection.split("Body:")[0])) protocol = "chat";
  } else {
    const parsed = JSON.parse(text);
    body = parsed.traces?.[0]?.request?.body || parsed.request?.body || parsed;
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error(translate("importError"));
  return { body, protocol };
}

export function createParameterEditor(container, onChange) {
  let fields = [];
  let generated = {};
  let bindTools = false;
  function read() {
    return Object.fromEntries(
      fields
        .filter((field) => field.enabled && (bindTools || !TOOL_FIELDS.has(field.key)))
        .map((field) => {
          try {
            return [field.key, JSON.parse(field.value)];
          } catch {
            throw new Error(`${field.key}: ${translate("invalid")}`);
          }
        }),
    );
  }
  function render() {
    container.replaceChildren();
    for (const field of fields) {
      if (!bindTools && TOOL_FIELDS.has(field.key)) continue;
      const row = document.createElement("div");
      row.className = `param-row${field.enabled ? "" : " omitted"}`;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = field.enabled;
      checkbox.setAttribute("aria-label", `${translate("send")} ${field.key}`);
      const name = document.createElement("code");
      name.textContent = field.key;
      const editor = document.createElement("textarea");
      editor.value = field.value;
      editor.rows = Math.min(10, Math.max(1, field.value.split("\n").length));
      editor.spellcheck = false;
      editor.setAttribute("aria-label", `${field.key} ${translate("value")}`);
      editor.disabled = !field.enabled;
      checkbox.addEventListener("change", () => {
        field.enabled = checkbox.checked;
        editor.disabled = !field.enabled;
        row.classList.toggle("omitted", !field.enabled);
        onChange();
      });
      editor.addEventListener("input", () => {
        field.value = editor.value;
        onChange();
      });
      row.append(checkbox, name, editor);
      container.append(row);
    }
    onChange();
  }
  function load(body, remember = true) {
    if (remember) generated = structuredClone(body);
    fields = Object.entries(body).map(([key, value]) => ({
      key,
      enabled: true,
      value: JSON.stringify(value, null, 2),
    }));
    for (const [key, value] of Object.entries(OPTIONAL_VALUES)) {
      if (!fields.some((field) => field.key === key))
        fields.push({ key, enabled: false, value: JSON.stringify(value, null, 2) });
    }
    render();
  }
  return {
    read,
    load,
    render,
    setToolBinding(enabled) {
      bindTools = enabled;
      render();
    },
    restore() {
      load(generated, false);
    },
    minimal() {
      fields.forEach((field) => {
        field.enabled = MINIMAL_FIELDS.has(field.key);
      });
      render();
    },
    add(key) {
      if (!key || fields.some((field) => field.key === key))
        throw new Error(translate("duplicate"));
      fields.push({ key, enabled: true, value: "null" });
      render();
    },
  };
}
