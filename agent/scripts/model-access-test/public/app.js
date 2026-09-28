/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { translate, setLocale } from "./i18n.js";
import { createParameterEditor, parseImportedRequest } from "./editor.js";

const element = (id) => document.getElementById(id);
const json = (value) => JSON.stringify(value, null, 2);
let models = [];
let token = "";
let busy = false;
let stale = true;
let controller;
let currentResult;
let sequence = 0;
const history = [];
const editor = createParameterEditor(element("parameters"), updatePreview);

function notice(message, error = false) {
  element("notice").textContent = message;
  element("notice").className = error ? "notice-error" : "";
}

function updatePreview() {
  try {
    element("preview").textContent = json(editor.read());
    element("validation").textContent = "";
    element("run").disabled = busy || stale;
  } catch (error) {
    element("preview").textContent = error.message;
    element("validation").textContent = error.message;
    element("run").disabled = true;
  }
}

function setBusy(value) {
  busy = value;
  element("connection-fields").disabled = value;
  element("parameter-fields").disabled = value;
  element("import").disabled = value;
  element("stop").disabled = !value;
  element("run").classList.toggle("loading", value);
  updatePreview();
}

function settings() {
  const messages = [];
  if (element("system").value) messages.push({ role: "system", content: element("system").value });
  messages.push({ role: "user", content: element("prompt").value });
  return {
    alias: element("model").value,
    model: element("model-name").value,
    base_url: element("endpoint").value,
    api_key: element("api-key").value,
    protocol: element("protocol").value,
    messages,
  };
}

function toolSettings() {
  if (element("tool-mode").value === "none") return { tools: [] };
  let tools;
  try {
    tools = JSON.parse(element("tool-definitions").value);
  } catch {
    throw new Error(translate("toolsInvalid"));
  }
  if (!Array.isArray(tools) || !tools.length) throw new Error(translate("toolsInvalid"));
  return { tools, toolBinding: { tool_choice: element("tool-choice").value } };
}

function syncToolMode() {
  const enabled = element("tool-mode").value === "bound";
  element("tool-binding-fields").hidden = !enabled;
  editor.setToolBinding(enabled);
}

async function api(path, input) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-diagnostic-token": token },
    body: json(input),
    signal: controller.signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

async function generate() {
  if (busy || !models.length) return;
  controller = new AbortController();
  stale = true;
  setBusy(true);
  notice(translate("generating"));
  try {
    const result = await api("/api/preview", { ...settings(), ...toolSettings() });
    if (!result.ok || !result.traces[0])
      throw new Error(result.error?.message || translate("failed"));
    stale = false;
    editor.load(result.traces[0].request.body);
    notice(`${translate("ready")} · ${result.traces[0].request.url}`);
  } catch (error) {
    notice(error.name === "AbortError" ? translate("stopped") : error.message, true);
  } finally {
    setBusy(false);
  }
}

function selectModel() {
  const selected = models.find((model) => model.alias === element("model").value);
  if (!selected) return;
  element("model-name").value = selected.model;
  element("endpoint").value = selected.base_url;
  element("api-key").value = "";
  element("protocol").value = "default";
  element("protocol").disabled = selected.adapterId !== "openai-compatible";
  element("credential").textContent = translate(selected.hasCredential ? "keyReady" : "keyMissing");
  void generate();
}

function showResult(result) {
  currentResult = result;
  element("result-empty").hidden = true;
  element("result-content").hidden = false;
  element("export").disabled = false;
  const trace = result.traces?.[0];
  element("http-status").textContent = trace?.response?.status || translate("noHttp");
  element("elapsed").textContent = `${result.elapsedMs} ms`;
  element("outcome").textContent = translate(result.ok ? "success" : "failed");
  element("outcome").className = result.ok ? "success-text" : "error-text";
  element("error-block").hidden = !result.error;
  element("error-detail").textContent = result.error ? json(result.error) : "";
  element("answer").textContent = result.output ? json(result.output) : "—";
  let raw = trace?.response?.body || "";
  try {
    raw = json(JSON.parse(raw));
  } catch {
    raw = String(raw);
  }
  element("raw-response").textContent =
    `${raw}${trace?.response?.truncated ? `\n${translate("truncated")}` : ""}` || "—";
  element("actual-request").textContent = trace ? json(trace.request) : "—";
}

function renderHistory() {
  element("history").replaceChildren();
  for (const entry of history) {
    const button = document.createElement("button");
    button.className = "history-entry";
    button.textContent = `#${entry.sequence} · ${entry.time} · ${entry.model} · ${entry.result.traces?.[0]?.response?.status || "ERR"} · ${entry.result.elapsedMs} ms`;
    button.addEventListener("click", () => showResult(entry.result));
    element("history").append(button);
  }
}

async function run() {
  if (busy || stale) return;
  controller = new AbortController();
  setBusy(true);
  notice(translate("running"));
  try {
    const input = { ...settings(), body: editor.read() };
    const result = await api("/api/run", input);
    showResult(result);
    sequence += 1;
    history.unshift({
      sequence,
      time: new Date().toLocaleTimeString(),
      model: input.body.model || input.alias,
      result,
    });
    history.splice(8);
    renderHistory();
    notice(translate(result.ok ? "success" : "failed"), !result.ok);
  } catch (error) {
    notice(error.name === "AbortError" ? translate("stopped") : error.message, true);
  } finally {
    setBusy(false);
  }
}

element("generate").addEventListener("click", generate);
element("model").addEventListener("change", selectModel);
element("run").addEventListener("click", run);
element("stop").addEventListener("click", () => controller?.abort());
element("minimal").addEventListener("click", () => editor.minimal());
element("restore").addEventListener("click", () => editor.restore());
element("add").addEventListener("click", () => {
  try {
    editor.add(element("param-name").value.trim());
    element("param-name").value = "";
  } catch (error) {
    notice(error.message, true);
  }
});
element("tool-mode").addEventListener("input", () => {
  syncToolMode();
  if (element("tool-mode").value === "bound") {
    try {
      if (!editor.read().tools?.length) stale = true;
    } catch {
      stale = true;
    }
  }
  updatePreview();
  notice(translate(stale ? "stale" : "ready"));
});
for (const id of [
  "model-name",
  "endpoint",
  "protocol",
  "system",
  "prompt",
  "tool-definitions",
  "tool-choice",
]) {
  element(id).addEventListener("input", () => {
    stale = true;
    updatePreview();
    notice(translate("stale"));
  });
}
element("locale").addEventListener("change", () => {
  setLocale(element("locale").value);
  editor.render();
  renderHistory();
  if (currentResult) showResult(currentResult);
});
element("import").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const imported = parseImportedRequest(await file.text());
    if (imported.protocol) element("protocol").value = imported.protocol;
    const tools = imported.body.tools;
    element("tool-mode").value = Array.isArray(tools) && tools.length ? "bound" : "none";
    if (Array.isArray(tools) && tools.length) element("tool-definitions").value = json(tools);
    const choice = imported.body.tool_choice;
    element("tool-choice").value = ["auto", "required", "none"].includes(choice) ? choice : "auto";
    syncToolMode();
    stale = false;
    editor.load(imported.body);
    notice(translate("imported"));
  } catch (error) {
    notice(`${translate("importError")} ${error.message}`, true);
  }
  event.target.value = "";
});
element("export").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([json(currentResult)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `noobot-model-test-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

setLocale("zh-CN");
element("prompt").value = translate("promptDefault");
element("tool-definitions").value = json([
  {
    type: "function",
    function: {
      name: "diagnostic_echo",
      description: "Return the supplied text / 返回传入文本",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "Text to echo / 要返回的文本" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
]);
try {
  const response = await fetch("/api/models");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  models = data.models;
  token = data.token;
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.alias;
    option.textContent = `${model.alias} · ${model.model}`;
    element("model").append(option);
  }
  if (models.length) selectModel();
  else notice(translate("noModels"), true);
} catch (error) {
  notice(error.message, true);
}
