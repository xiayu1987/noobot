/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import { clientFilePath as path } from "../../path-resolver.js";
import {
  applyPrimaryModelReferencesToConfigFile,
  assertConfigParamsDocumentKeys,
  collectConfigTemplateKeys,
  DEPLOYMENT_OWNED_CONFIG_ROOT_KEYS,
  ensureModelProviderInConfigFile,
  migrateConfigFileToCurrentProtocol,
  normalizeConfigParamsDocument,
  synchronizeConfigParamsDocument,
  synchronizeConfigFileFromTemplate,
} from "@noobot/agent-config-protocol";
import { listModelLibraryOptions } from "@noobot/model-protocol";

export function createDesktopConfigManager({
  repoRoot,
  packagedBackendRoot,
  appendDesktopLog = () => {},
} = {}) {
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

  function removeStaleTemplateEntries({ from, to }) {
    if (!fs.existsSync(to)) return;
    for (const entry of fs.readdirSync(to, { withFileTypes: true })) {
      if (["config.json", "global.config.json"].includes(entry.name)) continue;
      const sourcePath = path.join(from, entry.name);
      const targetPath = path.join(to, entry.name);
      if (!fs.existsSync(sourcePath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
        continue;
      }
      const sourceStat = fs.statSync(sourcePath);
      const targetStat = fs.statSync(targetPath);
      if (sourceStat.isDirectory() !== targetStat.isDirectory()) {
        fs.rmSync(targetPath, { recursive: true, force: true });
        continue;
      }
      if (sourceStat.isDirectory()) removeStaleTemplateEntries({ from: sourcePath, to: targetPath });
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
      appendDesktopLog(
        `[main:config] template path status; relative=${relativePath}; bundled=${JSON.stringify(describePath(path.join(bundledTemplatePath, relativePath)))}; workspace=${JSON.stringify(describePath(path.join(workspaceTemplatePath, relativePath)))}`,
      );
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

  function collectModelOptionsFromConfig(payload = {}) {
    const providers = isPlainObject(payload.providers) ? payload.providers : {};
    const configuredOptions = Object.entries(providers)
      .map(([key, value]) => ({
        key: String(key || "").trim(),
        model: String(value?.model || "").trim(),
        format: String(value?.format || "").trim(),
        description: String(value?.description || "").trim(),
        enabled: value?.enabled !== false,
        usedForConversation: value?.used_for_conversation !== false,
      }))
      .filter((item) => item.key)
      .sort((a, b) => a.key.localeCompare(b.key));
    const configuredByKey = new Map(configuredOptions.map((item) => [item.key, item]));
    const options = listModelLibraryOptions().map((item) => ({
      ...item,
      ...(configuredByKey.get(item.key) || {}),
      library: true,
    }));
    const libraryKeys = new Set(options.map((item) => item.key));
    return options.concat(
      configuredOptions
        .filter((item) => !libraryKeys.has(item.key))
        .map((item) => ({ ...item, library: false })),
    );
  }

  function getDefaultModelAlias(payload = {}) {
    const defaultProvider = getNestedString(payload, ["default_provider"]);
    if (defaultProvider) return defaultProvider;
    const providers = isPlainObject(payload.providers) ? payload.providers : {};
    return Object.keys(providers)[0] || "";
  }

  function applySelectedModelToConfig(payload = {}, selectedModel = "") {
    return applyPrimaryModelReferencesToConfigFile(payload, selectedModel);
  }

  function deepClone(input) {
    return JSON.parse(JSON.stringify(input));
  }

  function copyDirectoryContents({ from, to }) {
    if (!fs.existsSync(from)) {
      appendDesktopLog(
        `[main:config] bundled template directory missing; skipped directory sync: ${from}`,
      );
      return false;
    }
    try {
      fs.mkdirSync(to, { recursive: true });
      fs.cpSync(from, to, {
        recursive: true,
        filter: (src) => !["config.json", "global.config.json"].includes(path.basename(src)),
      });
      removeStaleTemplateEntries({ from, to });
      appendDesktopLog(`[main:config] synced desktop template directory: ${from} -> ${to}`);
      return true;
    } catch (error) {
      appendDesktopLog(
        `[main:config] desktop template directory sync failed: ${from} -> ${to}; error=${error?.stack || error?.message || String(error)}`,
      );
      try {
        copyDirectoryContentsManually({ from, to });
        removeStaleTemplateEntries({ from, to });
        appendDesktopLog(
          `[main:config] synced desktop template directory with manual fallback: ${from} -> ${to}`,
        );
        return true;
      } catch (fallbackError) {
        throw new Error(`failed to sync desktop template directory: ${from} -> ${to}`, {
          cause: fallbackError,
        });
      }
    }
  }

  function ensureWorkspaceTemplateExample({ bundledTemplatePath, workspaceTemplatePath }) {
    const bundledExamplePath = path.join(bundledTemplatePath, "config.example.json");
    const workspaceExamplePath = path.join(workspaceTemplatePath, "config.example.json");
    appendDesktopLog(
      `[main:config] checking desktop default user template example; bundled=${bundledExamplePath}; bundledStatus=${JSON.stringify(describePath(bundledExamplePath))}; workspace=${workspaceExamplePath}; workspaceStatus=${JSON.stringify(describePath(workspaceExamplePath))}`,
    );
    if (!isJsonObjectFile(bundledExamplePath)) {
      throw new Error(
        `desktop bundled default user config example is missing or invalid: ${bundledExamplePath}`,
      );
    }
    if (
      !isJsonObjectFile(workspaceExamplePath) ||
      JSON.stringify(readJsonFile(workspaceExamplePath, null)) !==
        JSON.stringify(readJsonFile(bundledExamplePath, null))
    ) {
      replaceFileFromBundledTemplate({
        from: bundledExamplePath,
        to: workspaceExamplePath,
        label: "default user config example",
      });
    }
    return workspaceExamplePath;
  }

  function ensureConfigParamsCatalog({ workspaceRootPath, configFiles = [] } = {}) {
    const keys = collectConfigTemplateKeys(
      ...configFiles.map((filePath) => readJsonFile(filePath, {})),
    );
    const filePath = path.join(workspaceRootPath, "config-params.json");
    const synchronized = synchronizeConfigParamsDocument({
      document: readJsonFile(filePath, {}) || {},
      keys,
    });
    writeJsonFile(filePath, synchronized);
    return filePath;
  }

  function collectSelectedModelConfigParams(globalConfigPath) {
    const globalConfig = readJsonFile(globalConfigPath, {}) || {};
    const selectedAlias = getDefaultModelAlias(globalConfig);
    const selectedProvider = isPlainObject(globalConfig.providers?.[selectedAlias])
      ? globalConfig.providers[selectedAlias]
      : {};
    const fields = ["api_key", "base_url"];
    const modelParams = new Map();
    fields.forEach((field, fieldOrder) => {
      for (const key of collectConfigTemplateKeys(selectedProvider[field])) {
        if (!modelParams.has(key)) modelParams.set(key, { field, fieldOrder });
      }
    });
    return modelParams;
  }

  function getMissingRequiredConfigParams(configParamsPath, globalConfigPath) {
    const payload = normalizeConfigParamsDocument(readJsonFile(configParamsPath, {}) || {});
    const values = payload.values;
    const modelParams = collectSelectedModelConfigParams(globalConfigPath);
    return Object.entries(values)
      .filter(([, value]) => String(value ?? "").trim() === "")
      .map(([key]) => {
        const modelParam = modelParams.get(key);
        return {
          key,
          description: String(payload.descriptions?.[key] || ""),
          group: modelParam ? "model" : "general",
          modelField: modelParam?.field || "",
          order: modelParam?.fieldOrder ?? Number.MAX_SAFE_INTEGER,
        };
      })
      .sort(
        (left, right) =>
          (left.group === "model" ? 0 : 1) - (right.group === "model" ? 0 : 1) ||
          left.order - right.order ||
          left.key.localeCompare(right.key),
      );
  }

  function getSuperAdminRequirement(globalConfigPath) {
    const payload = readJsonFile(globalConfigPath, {}) || {};
    const userId = getNestedString(payload, ["super_admin", "user_id"]);
    const connectCode = getNestedString(payload, ["super_admin", "connect_code"]);
    const language = getNestedString(payload, ["preferences", "language"]) || "zh-CN";
    const dependencyProxyUrl = getNestedString(payload, ["desktop", "dependency_proxy_url"]);
    const model = getDefaultModelAlias(payload);
    const modelOptions = collectModelOptionsFromConfig(payload);
    const missing =
      !userId || !connectCode || userId === "admin" || connectCode === "change-your-connect-code";
    return {
      missing,
      userId: userId === "admin" ? "" : userId,
      connectCode: connectCode === "change-your-connect-code" ? "" : connectCode,
      language,
      model,
      modelOptions,
      dependencyProxyUrl,
    };
  }

  function normalizeDesktopLanguage(language) {
    const value = String(language ?? "").trim();
    if (["zh-CN", "en-US"].includes(value)) return value;
    if (value.toLowerCase().startsWith("en")) return "en-US";
    return "zh-CN";
  }

  function saveSuperAdminConfig({
    globalConfigPath,
    userConfigPath,
    userId,
    connectCode,
    language,
    model,
    dependencyProxyUrl,
  } = {}) {
    const normalizedUserId = String(userId ?? "").trim();
    const normalizedConnectCode = String(connectCode ?? "").trim();
    const normalizedLanguage = normalizeDesktopLanguage(language);
    const normalizedModel = String(model ?? "").trim();
    const normalizedDependencyProxyUrl = normalizeProxyUrl(dependencyProxyUrl);
    if (!normalizedUserId) throw new Error("Super admin username is required.");
    if (!normalizedConnectCode) throw new Error("Super admin connect code is required.");
    if (normalizedUserId === "admin")
      throw new Error("Please change the default super admin username.");
    if (normalizedConnectCode === "change-your-connect-code")
      throw new Error("Please change the default connect code.");
    const payload = readJsonFile(globalConfigPath, {}) || {};
    setNestedValue(payload, ["super_admin", "user_id"], normalizedUserId);
    setNestedValue(payload, ["super_admin", "connect_code"], normalizedConnectCode);
    setNestedValue(payload, ["preferences", "language"], normalizedLanguage);
    setNestedValue(payload, ["desktop", "dependency_proxy_url"], normalizedDependencyProxyUrl);
    if (normalizedModel) {
      ensureModelProviderInConfigFile(payload, normalizedModel);
      applySelectedModelToConfig(payload, normalizedModel);
    }
    writeJsonFile(globalConfigPath, payload);

    if (userConfigPath) {
      const userPayload = readJsonFile(userConfigPath, null);
      if (isPlainObject(userPayload) && normalizedModel) {
        ensureModelProviderInConfigFile(userPayload, normalizedModel, {
          providerTemplate: payload.providers[normalizedModel],
        });
        applySelectedModelToConfig(userPayload, normalizedModel);
        writeJsonFile(userConfigPath, userPayload);
      }
    }
  }

  function saveConfigParamValues({ workspaceRootPath, values = {} } = {}) {
    const filePath = path.join(workspaceRootPath, "config-params.json");
    const current = normalizeConfigParamsDocument(readJsonFile(filePath, {}) || {});
    const incoming = assertConfigParamsDocumentKeys(
      { values: isPlainObject(values) ? values : {} },
      Object.keys(current.values),
    );
    const next = normalizeConfigParamsDocument({
      values: { ...current.values, ...incoming.values },
      descriptions: current.descriptions,
    });
    writeJsonFile(filePath, next);
  }

  function syncJsonFileIncremental({ templateFilePath, targetFilePath } = {}) {
    const templateJson = readJsonFile(templateFilePath, null);
    if (!isPlainObject(templateJson)) return false;
    const targetExists = fs.existsSync(targetFilePath);
    const targetJson = targetExists ? readJsonFile(targetFilePath, {}) : {};
    const merged = synchronizeConfigFileFromTemplate({
      template: templateJson,
      target: targetJson,
    });
    if (!targetExists || JSON.stringify(targetJson) !== JSON.stringify(merged)) {
      writeJsonFile(targetFilePath, merged);
      return true;
    }
    return false;
  }

  function synchronizeExistingUserConfigs({ workspaceRootPath, templateConfigPath } = {}) {
    if (!fs.existsSync(workspaceRootPath)) return;
    const template = readJsonFile(templateConfigPath, null);
    if (!isPlainObject(template))
      throw new Error(`invalid user config template: ${templateConfigPath}`);
    for (const entry of fs.readdirSync(workspaceRootPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const fileName of ["config.json", "config.example.json"]) {
        const filePath = path.join(workspaceRootPath, entry.name, fileName);
        const payload = readJsonFile(filePath, null);
        if (!isPlainObject(payload)) continue;
        const synchronized = synchronizeConfigFileFromTemplate({ template, target: payload });
        if (JSON.stringify(payload) !== JSON.stringify(synchronized)) {
          writeJsonFile(filePath, synchronized);
        }
      }
    }
  }

  function ensureDesktopGlobalConfig({ isPackaged, userDataPath }) {
    const configDir = process.env.NOOBOT_CONFIG_DIR || path.join(userDataPath, "config");
    const targetPath =
      process.env.NOOBOT_GLOBAL_CONFIG_PATH || path.join(configDir, "global.config.json");
    const examplePath = isPackaged
      ? path.join(packagedBackendRoot, "service", "config", "global.config.example.json")
      : path.join(repoRoot, "service", "config", "global.config.example.json");
    const bundledTemplatePath = isPackaged
      ? path.join(packagedBackendRoot, "user-template", "default-user")
      : path.join(repoRoot, "user-template", "default-user");
    const workspaceRootPath =
      process.env.NOOBOT_WORKSPACE_ROOT || path.join(userDataPath, "workspace");
    const workspaceTemplatePath =
      process.env.NOOBOT_WORKSPACE_TEMPLATE_PATH ||
      path.join(userDataPath, "user-template", "default-user");

    const exampleConfig = readJsonFile(examplePath, null);
    if (!isPlainObject(exampleConfig))
      throw new Error(`invalid global config example: ${examplePath}`);
    const isFirstGlobalConfig = !fs.existsSync(targetPath);
    const currentConfig = isFirstGlobalConfig ? {} : readJsonFile(targetPath, {});
    const hasConfiguredExecutionIsolationMode = Boolean(
      String(currentConfig?.security?.execution_isolation?.mode || "").trim(),
    );
    const mergedConfig = synchronizeConfigFileFromTemplate({
      template: exampleConfig,
      target: currentConfig,
      excludedRootKeys: DEPLOYMENT_OWNED_CONFIG_ROOT_KEYS,
    });
    mergedConfig.workspace_root = workspaceRootPath;
    mergedConfig.workspace_template_path = workspaceTemplatePath;
    if (!hasConfiguredExecutionIsolationMode)
      setNestedValue(mergedConfig, ["security", "execution_isolation", "mode"], "host");
    if (
      !fs.existsSync(targetPath) ||
      JSON.stringify(currentConfig) !== JSON.stringify(mergedConfig)
    ) {
      writeJsonFile(targetPath, mergedConfig);
      appendDesktopLog(
        `[main:config] synced global config from example: ${examplePath} -> ${targetPath}`,
      );
    }

    const templateExamplePath = ensureWorkspaceTemplateExample({
      bundledTemplatePath,
      workspaceTemplatePath,
    });
    copyDirectoryContents({ from: bundledTemplatePath, to: workspaceTemplatePath });
    logTemplateDirectoryStatus({ bundledTemplatePath, workspaceTemplatePath });
    const templateConfigPath = path.join(workspaceTemplatePath, "config.json");
    if (fs.existsSync(templateExamplePath)) {
      syncJsonFileIncremental({
        templateFilePath: templateExamplePath,
        targetFilePath: templateConfigPath,
      });
    }
    if (!isJsonObjectFile(templateExamplePath))
      throw new Error(
        `desktop workspace default user config example is missing or invalid: ${templateExamplePath}`,
      );
    if (!isJsonObjectFile(templateConfigPath))
      throw new Error(
        `desktop workspace default user config is missing or invalid: ${templateConfigPath}`,
      );
    fs.mkdirSync(workspaceRootPath, { recursive: true });
    synchronizeExistingUserConfigs({ workspaceRootPath, templateConfigPath });
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
      missingParams: getMissingRequiredConfigParams(configParamsPath, targetPath),
    };
  }

  return {
    ensureDesktopGlobalConfig,
    saveConfigParamValues,
    saveSuperAdminConfig,
  };
}
