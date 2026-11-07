/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import { clientFilePath as path } from "../../path-resolver.js";
import {
  applyPrimaryModelReferencesToConfigFile,
  collectConfigTemplateKeys,
  createClientModelOptions,
  CONFIG_DOCUMENT_SCOPE,
  AgentConfigProtocolError,
  configIssueBlocksStartup,
  parseConfigDocumentText,
  ensureModelProviderInConfigFile,
  normalizeConfigParamsDocument,
  repairConfigDocument,
  upgradeConfigModelLibrary,
  summarizeConfigRepairReport,
  synchronizeConfigParamsDocument,
} from "@noobot/agent-config-protocol";
import { listModelLibraryOptions, resolveModelLibraryProvider } from "@noobot/model-protocol";
import { isPlainObject, text } from "@noobot/shared/value";

export function createDesktopConfigManager({
  repoRoot,
  packagedBackendRoot,
  appendDesktopLog = () => {},
} = {}) {
  function readConfigDocument(filePath, { allowMissing = false } = {}) {
    let source;
    try {
      source = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      if (allowMissing && error.code === "ENOENT") return {};
      throw error;
    }
    return parseConfigDocumentText(source);
  }

  function writeJsonFile(filePath, payload) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      fs.renameSync(temporaryPath, filePath);
    } catch (error) {
      fs.rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  function logConfigRepairReport(filePath, report = {}) {
    const summary = summarizeConfigRepairReport(report);
    for (const issue of report.issues || []) {
      appendDesktopLog(`[main:config-diagnostic] file=${filePath}; issue=${JSON.stringify(issue)}`);
    }
    if (!summary.changed) return;
    appendDesktopLog(
      `[main:config-repair] file=${filePath}; changes=${summary.changeCount}; actions=${JSON.stringify(summary.actionCounts)}`,
    );
  }

  function getNestedString(root, segments) {
    let node = root;
    for (const segment of segments) node = isPlainObject(node) ? node[segment] : undefined;
    return text(node);
  }

  function normalizeProxyUrl(proxyUrl = "") {
    const value = text(proxyUrl);
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
    const libraryProviders = Object.fromEntries(
      listModelLibraryOptions().map(({ key }) => [key, resolveModelLibraryProvider(key)]),
    );
    return createClientModelOptions({ ...libraryProviders, ...providers }, "conversation").map(
      (option) => ({
        ...option,
        library: Object.hasOwn(libraryProviders, option.alias),
      }),
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

  function ensureConfigParamsCatalog({ workspaceRootPath, globalConfigPath } = {}) {
    const documents = [readConfigDocument(globalConfigPath)];
    for (const userConfigPath of listUserConfigPaths(workspaceRootPath)) {
      try {
        documents.push(readConfigDocument(userConfigPath));
      } catch (error) {
        reportUserConfigError(error, userConfigPath);
      }
    }
    const keys = collectConfigTemplateKeys(...documents);
    const filePath = path.join(workspaceRootPath, "config-params.json");
    const synchronized = synchronizeConfigParamsDocument({
      document: readConfigDocument(filePath, { allowMissing: true }),
      keys,
    });
    writeJsonFile(filePath, synchronized);
    return filePath;
  }

  function collectSelectedModelConfigParams(globalConfigPath) {
    const globalConfig = readConfigDocument(globalConfigPath);
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
    const payload = normalizeConfigParamsDocument(readConfigDocument(configParamsPath));
    const values = payload.values;
    const modelParams = collectSelectedModelConfigParams(globalConfigPath);
    return Object.entries(values)
      .filter(([, value]) => text(value) === "")
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
    const payload = readConfigDocument(globalConfigPath);
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
    const value = text(language);
    if (["zh-CN", "en-US"].includes(value)) return value;
    if (value.toLowerCase().startsWith("en")) return "en-US";
    return "zh-CN";
  }

  function saveSuperAdminConfig({
    globalConfigPath,
    userId,
    connectCode,
    language,
    model,
    dependencyProxyUrl,
  } = {}) {
    const normalizedUserId = text(userId);
    const normalizedConnectCode = text(connectCode);
    const normalizedLanguage = normalizeDesktopLanguage(language);
    const normalizedModel = text(model);
    const normalizedDependencyProxyUrl = normalizeProxyUrl(dependencyProxyUrl);
    if (!normalizedUserId) throw new Error("Super admin username is required.");
    if (!normalizedConnectCode) throw new Error("Super admin connect code is required.");
    if (normalizedUserId === "admin")
      throw new Error("Please change the default super admin username.");
    if (normalizedConnectCode === "change-your-connect-code")
      throw new Error("Please change the default connect code.");
    const payload = readConfigDocument(globalConfigPath);
    setNestedValue(payload, ["super_admin", "user_id"], normalizedUserId);
    setNestedValue(payload, ["super_admin", "connect_code"], normalizedConnectCode);
    setNestedValue(payload, ["preferences", "language"], normalizedLanguage);
    setNestedValue(payload, ["desktop", "dependency_proxy_url"], normalizedDependencyProxyUrl);
    if (normalizedModel) {
      ensureModelProviderInConfigFile(payload, normalizedModel);
      applySelectedModelToConfig(payload, normalizedModel);
    }
    writeJsonFile(globalConfigPath, payload);
  }

  function saveConfigParamValues({ workspaceRootPath, values = {} } = {}) {
    const filePath = path.join(workspaceRootPath, "config-params.json");
    const current = normalizeConfigParamsDocument(
      readConfigDocument(filePath, { allowMissing: true }),
    );
    const incoming = normalizeConfigParamsDocument({
      values,
    });
    const next = normalizeConfigParamsDocument({
      values: { ...current.values, ...incoming.values },
      descriptions: current.descriptions,
    });
    writeJsonFile(filePath, next);
  }

  function listUserConfigPaths(workspaceRootPath) {
    if (!fs.existsSync(workspaceRootPath)) return [];
    return fs
      .readdirSync(workspaceRootPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(workspaceRootPath, entry.name, "config.json"))
      .filter((filePath) => fs.existsSync(filePath));
  }

  function reportUserConfigError(error, filePath) {
    if (
      !(error instanceof AgentConfigProtocolError) ||
      !error.details.impact ||
      configIssueBlocksStartup(error.details, CONFIG_DOCUMENT_SCOPE.USER)
    )
      throw error;
    logConfigRepairReport(filePath, { issues: [error.details] });
  }

  function synchronizeUserConfig(filePath, baseValues) {
    try {
      const payload = readConfigDocument(filePath);
      const repair = repairConfigDocument({
        scope: CONFIG_DOCUMENT_SCOPE.USER,
        baseValues,
        target: upgradeConfigModelLibrary(payload).document,
      });
      logConfigRepairReport(filePath, repair.report);
      if (JSON.stringify(payload) !== JSON.stringify(repair.document)) {
        writeJsonFile(filePath, repair.document);
      }
    } catch (error) {
      reportUserConfigError(error, filePath);
    }
  }

  function synchronizeExistingUserConfigs({ workspaceRootPath, baseValues = {} } = {}) {
    for (const filePath of listUserConfigPaths(workspaceRootPath)) {
      synchronizeUserConfig(filePath, baseValues);
    }
  }

  function ensureDesktopGlobalConfig({ isPackaged, userDataPath }) {
    const configDir = path.join(userDataPath, "config");
    const targetPath = path.join(configDir, "global.config.json");
    const examplePath = isPackaged
      ? path.join(packagedBackendRoot, "service", "config", "global.config.example.json")
      : path.join(repoRoot, "service", "config", "global.config.example.json");
    const workspaceRootPath = path.join(userDataPath, "workspace");
    const workspaceTemplatePath = isPackaged
      ? path.join(packagedBackendRoot, "user-template", "default-user")
      : path.join(repoRoot, "user-template", "default-user");

    const exampleConfig = readConfigDocument(examplePath);
    const isFirstGlobalConfig = !fs.existsSync(targetPath);
    const currentConfig = isFirstGlobalConfig ? {} : readConfigDocument(targetPath);
    const hasConfiguredExecutionIsolationMode = Boolean(
      text(currentConfig?.security?.execution_isolation?.mode),
    );
    const globalRepair = repairConfigDocument({
      scope: CONFIG_DOCUMENT_SCOPE.GLOBAL,
      baseValues: exampleConfig,
      target: upgradeConfigModelLibrary(isFirstGlobalConfig ? exampleConfig : currentConfig)
        .document,
    });
    const mergedConfig = globalRepair.document;
    logConfigRepairReport(targetPath, globalRepair.report);
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

    fs.mkdirSync(workspaceRootPath, { recursive: true });
    synchronizeExistingUserConfigs({ workspaceRootPath, baseValues: mergedConfig });
    const configParamsPath = ensureConfigParamsCatalog({
      workspaceRootPath,
      globalConfigPath: targetPath,
    });
    return {
      configDir,
      globalConfigPath: targetPath,
      workspaceRootPath,
      workspaceTemplatePath,
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
