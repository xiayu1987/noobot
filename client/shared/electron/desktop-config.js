/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";

export function createDesktopConfigManager({ repoRoot, packagedBackendRoot, appendDesktopLog = () => {} } = {}) {
  const desktopConfigSyncSkipTopLevelKeys = new Set([
    "workspace_root",
    "workspace_template_path",
    "streaming",
    "super_admin",
  ]);

  function isPlainObject(input) {
    return input !== null && typeof input === "object" && !Array.isArray(input);
  }

  function readJsonFile(filePath, fallback = null) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return fallback;
    }
  }

  function writeJsonFile(filePath, payload) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  function assertFileExists(filePath, label) {
    try {
      const fileStat = fs.statSync(filePath);
      if (fileStat.isFile()) return;
    } catch (error) {
      throw new Error(`${label} missing: ${filePath}`, { cause: error });
    }
    throw new Error(`${label} is not a file: ${filePath}`);
  }

  function isJsonObjectFile(filePath) {
    return isPlainObject(readJsonFile(filePath, null));
  }

  function describePath(filePath) {
    try {
      const fileStat = fs.statSync(filePath);
      return {
        exists: true,
        isFile: fileStat.isFile(),
        isDirectory: fileStat.isDirectory(),
        size: fileStat.size,
      };
    } catch (error) {
      return {
        exists: false,
        error: error?.code || error?.message || String(error),
      };
    }
  }

  function replaceFileFromBundledTemplate({ from, to, label }) {
    assertFileExists(from, `desktop bundled ${label}`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
      fs.rmSync(to, { recursive: true, force: true });
      fs.copyFileSync(from, to);
    } catch (error) {
      throw new Error(`failed to restore desktop ${label}: ${from} -> ${to}`, { cause: error });
    }
    assertFileExists(to, `desktop restored ${label}`);
    appendDesktopLog(`[main:config] restored desktop ${label}: ${from} -> ${to}`);
  }

  function shouldCopyTemplatePath(src) {
    return !["config.json", "global.config.json"].includes(path.basename(src));
  }

  function copyDirectoryContentsManually({ from, to }) {
    const sourceStat = fs.statSync(from);
    if (!sourceStat.isDirectory()) {
      if (!shouldCopyTemplatePath(from)) return;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      return;
    }

    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const srcPath = path.join(from, entry.name);
      const dstPath = path.join(to, entry.name);
      if (!shouldCopyTemplatePath(srcPath)) continue;
      if (entry.isDirectory()) {
        copyDirectoryContentsManually({ from: srcPath, to: dstPath });
      } else if (entry.isFile()) {
        fs.mkdirSync(path.dirname(dstPath), { recursive: true });
        fs.copyFileSync(srcPath, dstPath);
      }
    }
  }

  function logTemplateDirectoryStatus({ bundledTemplatePath, workspaceTemplatePath }) {
    const relativePaths = [
      ".",
      "config.example.json",
      "memory",
      path.join("memory", "short-memory.json"),
      "runtime",
      "services",
      "skills",
    ];
    for (const relativePath of relativePaths) {
      appendDesktopLog(`[main:config] template path status; relative=${relativePath}; bundled=${JSON.stringify(describePath(path.join(bundledTemplatePath, relativePath)))}; workspace=${JSON.stringify(describePath(path.join(workspaceTemplatePath, relativePath)))}`);
    }
  }

  function getNestedString(root, segments) {
    let node = root;
    for (const segment of segments) node = isPlainObject(node) ? node[segment] : undefined;
    return String(node ?? "").trim();
  }

  function normalizeProxyUrl(proxyUrl = "") {
    const value = String(proxyUrl || "").trim();
    if (!value) return "";
    return new URL(value).toString();
  }

  function setNestedValue(root, segments, value) {
    let node = root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      if (!isPlainObject(node[segment])) node[segment] = {};
      node = node[segment];
    }
    node[segments[segments.length - 1]] = value;
  }


  function getNestedObject(root, segments) {
    let node = root;
    for (const segment of segments) node = isPlainObject(node) ? node[segment] : undefined;
    return isPlainObject(node) ? node : null;
  }

  function collectModelOptionsFromConfig(payload = {}) {
    const providers = isPlainObject(payload.providers) ? payload.providers : {};
    return Object.entries(providers)
      .map(([key, value]) => ({
        key: String(key || "").trim(),
        model: String(value?.model || "").trim(),
        description: String(value?.description || "").trim(),
        enabled: value?.enabled !== false,
        usedForConversation: value?.used_for_conversation !== false,
      }))
      .filter((item) => item.key)
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  function getDefaultModelAlias(payload = {}) {
    const defaultProvider = getNestedString(payload, ["default_provider"]);
    if (defaultProvider) return defaultProvider;
    const providers = isPlainObject(payload.providers) ? payload.providers : {};
    return Object.keys(providers)[0] || "";
  }

  function setObjectStringValues(target, value) {
    if (!isPlainObject(target)) return;
    for (const key of Object.keys(target)) target[key] = value;
  }

  function applySelectedModelToConfig(payload = {}, selectedModel = "") {
    const alias = String(selectedModel || "").trim();
    if (!alias || !isPlainObject(payload)) return payload;
    const providers = isPlainObject(payload.providers) ? payload.providers : {};
    if (!isPlainObject(providers[alias])) throw new Error(`Selected model provider not found: ${alias}`);

    payload.default_provider = alias;
    for (const [providerKey, provider] of Object.entries(providers)) {
      if (!isPlainObject(provider)) continue;
      if (providerKey === alias) {
        provider.enabled = true;
        provider.used_for_conversation = true;
      }
    }

    const attachmentModels = getNestedObject(payload, ["attachments", "attachment_models"]);
    setObjectStringValues(attachmentModels, alias);

    const scenarioDefinitions = getNestedObject(payload, ["scenarios", "definitions"]);
    if (scenarioDefinitions) {
      for (const definition of Object.values(scenarioDefinitions)) {
        if (isPlainObject(definition) && Object.prototype.hasOwnProperty.call(definition, "model")) definition.model = alias;
      }
    }

    const webSearchResponses = getNestedObject(payload, ["tools", "web_search", "responses_api"]);
    if (webSearchResponses) webSearchResponses.model = alias;

    const requestHelp = getNestedObject(payload, ["tools", "request_help"]);
    if (requestHelp && Object.prototype.hasOwnProperty.call(requestHelp, "help_model") && String(requestHelp.help_model || "").trim()) requestHelp.help_model = alias;

    const harnessStepModels = getNestedObject(payload, ["plugins", "harness", "stepModels"]);
    setObjectStringValues(harnessStepModels, alias);
    const capabilityModels = getNestedObject(payload, ["plugins", "harness", "capabilityModelByPurpose"]);
    setObjectStringValues(capabilityModels, alias);

    const workflow = getNestedObject(payload, ["plugins", "workflow"]);
    if (workflow && Object.prototype.hasOwnProperty.call(workflow, "semanticModel")) workflow.semanticModel = alias;

    return payload;
  }

  function deepClone(input) {
    return JSON.parse(JSON.stringify(input));
  }

  function mergeIncremental({ template, target, pathDepth = 0, skipTopLevelKeys = new Set() } = {}) {
    if (Array.isArray(template)) return target === undefined ? deepClone(template) : target;
    if (!isPlainObject(template)) return target === undefined ? template : target;
    const output = isPlainObject(target) ? deepClone(target) : {};
    const targetObject = isPlainObject(target) ? target : {};
    for (const [key, templateValue] of Object.entries(template)) {
      if (pathDepth === 0 && skipTopLevelKeys.has(key)) continue;
      if (!Object.prototype.hasOwnProperty.call(targetObject, key)) {
        output[key] = deepClone(templateValue);
      } else if (isPlainObject(templateValue) && isPlainObject(targetObject[key])) {
        output[key] = mergeIncremental({ template: templateValue, target: targetObject[key], pathDepth: pathDepth + 1, skipTopLevelKeys });
      } else {
        output[key] = targetObject[key];
      }
    }
    return output;
  }

  function copyDirectoryContents({ from, to }) {
    if (!fs.existsSync(from)) {
      appendDesktopLog(`[main:config] bundled template directory missing; skipped directory sync: ${from}`);
      return false;
    }
    try {
      fs.mkdirSync(to, { recursive: true });
      fs.cpSync(from, to, {
        recursive: true,
        filter: (src) => !["config.json", "global.config.json"].includes(path.basename(src)),
      });
      appendDesktopLog(`[main:config] synced desktop template directory: ${from} -> ${to}`);
      return true;
    } catch (error) {
      appendDesktopLog(`[main:config] desktop template directory sync failed: ${from} -> ${to}; error=${error?.stack || error?.message || String(error)}`);
      try {
        copyDirectoryContentsManually({ from, to });
        appendDesktopLog(`[main:config] synced desktop template directory with manual fallback: ${from} -> ${to}`);
        return true;
      } catch (fallbackError) {
        throw new Error(`failed to sync desktop template directory: ${from} -> ${to}`, { cause: fallbackError });
      }
    }
  }

  function ensureWorkspaceTemplateExample({ bundledTemplatePath, workspaceTemplatePath }) {
    const bundledExamplePath = path.join(bundledTemplatePath, "config.example.json");
    const workspaceExamplePath = path.join(workspaceTemplatePath, "config.example.json");
    appendDesktopLog(`[main:config] checking desktop default user template example; bundled=${bundledExamplePath}; bundledStatus=${JSON.stringify(describePath(bundledExamplePath))}; workspace=${workspaceExamplePath}; workspaceStatus=${JSON.stringify(describePath(workspaceExamplePath))}`);
    if (!isJsonObjectFile(bundledExamplePath)) {
      throw new Error(`desktop bundled default user config example is missing or invalid: ${bundledExamplePath}`);
    }
    if (!isJsonObjectFile(workspaceExamplePath)) {
      replaceFileFromBundledTemplate({
        from: bundledExamplePath,
        to: workspaceExamplePath,
        label: "default user config example",
      });
    }
    return workspaceExamplePath;
  }

  function collectTemplateVariables(input, keys = new Set()) {
    if (typeof input === "string") {
      for (const match of input.matchAll(/\$\{([A-Z0-9_]+)\}/g)) keys.add(match[1]);
    } else if (Array.isArray(input)) {
      input.forEach((item) => collectTemplateVariables(item, keys));
    } else if (isPlainObject(input)) {
      Object.values(input).forEach((value) => collectTemplateVariables(value, keys));
    }
    return keys;
  }

  function ensureConfigParamsCatalog({ workspaceRootPath, configFiles = [] } = {}) {
    const keys = new Set();
    for (const filePath of configFiles) collectTemplateVariables(readJsonFile(filePath, {}), keys);
    const filePath = path.join(workspaceRootPath, "config-params.json");
    const current = readJsonFile(filePath, {}) || {};
    const values = isPlainObject(current.values) ? { ...current.values } : {};
    const descriptions = isPlainObject(current.descriptions) ? { ...current.descriptions } : {};
    for (const key of Array.from(keys).sort((a, b) => a.localeCompare(b))) {
      if (!Object.prototype.hasOwnProperty.call(values, key)) values[key] = "";
      if (!Object.prototype.hasOwnProperty.call(descriptions, key)) descriptions[key] = "";
    }
    writeJsonFile(filePath, { values, descriptions });
    return filePath;
  }

  function getMissingRequiredConfigParams(configParamsPath) {
    const payload = readJsonFile(configParamsPath, {}) || {};
    const values = isPlainObject(payload.values) ? payload.values : {};
    return Object.entries(values)
      .filter(([, value]) => String(value ?? "").trim() === "")
      .map(([key]) => ({ key, description: String(payload.descriptions?.[key] || "") }));
  }

  function getSuperAdminRequirement(globalConfigPath) {
    const payload = readJsonFile(globalConfigPath, {}) || {};
    const userId = getNestedString(payload, ["super_admin", "user_id"]);
    const connectCode = getNestedString(payload, ["super_admin", "connect_code"]);
    const language = getNestedString(payload, ["preferences", "language"]) || "zh-CN";
    const dependencyProxyUrl = getNestedString(payload, ["desktop", "dependency_proxy_url"]);
    const model = getDefaultModelAlias(payload);
    const modelOptions = collectModelOptionsFromConfig(payload);
    const missing = !userId || !connectCode || userId === "admin" || connectCode === "change-your-connect-code";
    return { missing, userId: userId === "admin" ? "" : userId, connectCode: connectCode === "change-your-connect-code" ? "" : connectCode, language, model, modelOptions, dependencyProxyUrl };
  }

  function normalizeDesktopLanguage(language) {
    const value = String(language ?? "").trim();
    if (["zh-CN", "en-US"].includes(value)) return value;
    if (value.toLowerCase().startsWith("en")) return "en-US";
    return "zh-CN";
  }

  function saveSuperAdminConfig({ globalConfigPath, userConfigPath, userId, connectCode, language, model, dependencyProxyUrl } = {}) {
    const normalizedUserId = String(userId ?? "").trim();
    const normalizedConnectCode = String(connectCode ?? "").trim();
    const normalizedLanguage = normalizeDesktopLanguage(language);
    const normalizedModel = String(model ?? "").trim();
    const normalizedDependencyProxyUrl = normalizeProxyUrl(dependencyProxyUrl);
    if (!normalizedUserId) throw new Error("Super admin username is required.");
    if (!normalizedConnectCode) throw new Error("Super admin connect code is required.");
    if (normalizedUserId === "admin") throw new Error("Please change the default super admin username.");
    if (normalizedConnectCode === "change-your-connect-code") throw new Error("Please change the default connect code.");
    const payload = readJsonFile(globalConfigPath, {}) || {};
    setNestedValue(payload, ["super_admin", "user_id"], normalizedUserId);
    setNestedValue(payload, ["super_admin", "connect_code"], normalizedConnectCode);
    setNestedValue(payload, ["preferences", "language"], normalizedLanguage);
    setNestedValue(payload, ["desktop", "dependency_proxy_url"], normalizedDependencyProxyUrl);
    if (normalizedModel) applySelectedModelToConfig(payload, normalizedModel);
    writeJsonFile(globalConfigPath, payload);

    if (userConfigPath) {
      const userPayload = readJsonFile(userConfigPath, null);
      if (isPlainObject(userPayload) && normalizedModel) {
        applySelectedModelToConfig(userPayload, normalizedModel);
        writeJsonFile(userConfigPath, userPayload);
      }
    }
  }

  function saveConfigParamValues({ workspaceRootPath, values = {} } = {}) {
    const filePath = path.join(workspaceRootPath, "config-params.json");
    const payload = readJsonFile(filePath, {}) || {};
    const currentValues = isPlainObject(payload.values) ? { ...payload.values } : {};
    const descriptions = isPlainObject(payload.descriptions) ? { ...payload.descriptions } : {};
    for (const [key, value] of Object.entries(values || {})) {
      const normalizedKey = String(key || "").trim().toUpperCase();
      if (!normalizedKey) continue;
      currentValues[normalizedKey] = String(value ?? "").trim();
      if (!Object.prototype.hasOwnProperty.call(descriptions, normalizedKey)) descriptions[normalizedKey] = "";
    }
    writeJsonFile(filePath, { values: currentValues, descriptions });
  }

  function syncJsonFileIncremental({ templateFilePath, targetFilePath, skipTopLevelKeys = new Set() } = {}) {
    const templateJson = readJsonFile(templateFilePath, null);
    if (!isPlainObject(templateJson)) return false;
    const targetExists = fs.existsSync(targetFilePath);
    const targetJson = targetExists ? readJsonFile(targetFilePath, {}) : {};
    const merged = mergeIncremental({ template: templateJson, target: targetJson, skipTopLevelKeys });
    if (!targetExists || JSON.stringify(targetJson) !== JSON.stringify(merged)) {
      writeJsonFile(targetFilePath, merged);
      return true;
    }
    return false;
  }

  function forceExecuteScriptNonSandbox(configPath) {
    const payload = readJsonFile(configPath, null);
    if (!isPlainObject(payload)) return false;
    setNestedValue(payload, ["tools", "execute_script", "sandbox_mode"], false);
    writeJsonFile(configPath, payload);
    return true;
  }

  function ensureDesktopGlobalConfig({ isPackaged, userDataPath }) {
    const configDir = process.env.NOOBOT_CONFIG_DIR || path.join(userDataPath, "config");
    const targetPath = process.env.NOOBOT_GLOBAL_CONFIG_PATH || path.join(configDir, "global.config.json");
    const examplePath = isPackaged
      ? path.join(packagedBackendRoot, "service", "config", "global.config.example.json")
      : path.join(repoRoot, "service", "config", "global.config.example.json");
    const bundledTemplatePath = isPackaged
      ? path.join(packagedBackendRoot, "user-template", "default-user")
      : path.join(repoRoot, "user-template", "default-user");
    const workspaceRootPath = process.env.NOOBOT_WORKSPACE_ROOT || path.join(userDataPath, "workspace");
    const workspaceTemplatePath = process.env.NOOBOT_WORKSPACE_TEMPLATE_PATH || path.join(userDataPath, "user-template", "default-user");

    const exampleConfig = readJsonFile(examplePath, null);
    if (!isPlainObject(exampleConfig)) throw new Error(`invalid global config example: ${examplePath}`);
    const isFirstGlobalConfig = !fs.existsSync(targetPath);
    const currentConfig = isFirstGlobalConfig ? {} : readJsonFile(targetPath, {});
    const mergedConfig = mergeIncremental({ template: exampleConfig, target: currentConfig, skipTopLevelKeys: desktopConfigSyncSkipTopLevelKeys });
    mergedConfig.workspace_root = workspaceRootPath;
    mergedConfig.workspace_template_path = workspaceTemplatePath;
    if (isFirstGlobalConfig) setNestedValue(mergedConfig, ["tools", "execute_script", "sandbox_mode"], false);
    if (!fs.existsSync(targetPath) || JSON.stringify(currentConfig) !== JSON.stringify(mergedConfig)) {
      writeJsonFile(targetPath, mergedConfig);
      appendDesktopLog(`[main:config] synced global config from example: ${examplePath} -> ${targetPath}`);
    }

    const templateExamplePath = ensureWorkspaceTemplateExample({ bundledTemplatePath, workspaceTemplatePath });
    copyDirectoryContents({ from: bundledTemplatePath, to: workspaceTemplatePath });
    logTemplateDirectoryStatus({ bundledTemplatePath, workspaceTemplatePath });
    const templateConfigPath = path.join(workspaceTemplatePath, "config.json");
    if (fs.existsSync(templateExamplePath)) {
      const isFirstUserConfig = !fs.existsSync(templateConfigPath);
      syncJsonFileIncremental({ templateFilePath: templateExamplePath, targetFilePath: templateConfigPath, skipTopLevelKeys: desktopConfigSyncSkipTopLevelKeys });
      if (isFirstUserConfig) {
        forceExecuteScriptNonSandbox(templateConfigPath);
        appendDesktopLog(`[main:config] initialized desktop default user config with non-sandbox execute_script: ${templateConfigPath}`);
      }
    }
    if (!isJsonObjectFile(templateExamplePath)) throw new Error(`desktop workspace default user config example is missing or invalid: ${templateExamplePath}`);
    if (!isJsonObjectFile(templateConfigPath)) throw new Error(`desktop workspace default user config is missing or invalid: ${templateConfigPath}`);
    fs.mkdirSync(workspaceRootPath, { recursive: true });
    const configParamsPath = ensureConfigParamsCatalog({
      workspaceRootPath,
      configFiles: [targetPath, templateConfigPath, templateExamplePath],
    });
    return {
      globalConfigPath: targetPath,
      workspaceRootPath,
      workspaceTemplatePath,
      templateConfigPath,
      configParamsPath,
      superAdmin: getSuperAdminRequirement(targetPath),
      missingParams: getMissingRequiredConfigParams(configParamsPath),
    };
  }

  return {
    ensureDesktopGlobalConfig,
    saveConfigParamValues,
    saveSuperAdminConfig,
  };
}
