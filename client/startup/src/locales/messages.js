/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const enUS = {
  hero: { title: "Starting Noobot", logTitle: "Startup log" },
  status: {
    checkingService: "Checking local Noobot service...",
    startingService: "Starting Noobot service...",
    serviceReady: "Noobot service is ready.",
    loadingApplication: "Opening Noobot...",
    checkingDependencies: "Checking optional dependencies...",
    setupAlreadyCompleted:
      "Super admin setup is already completed for this startup session. Continuing...",
    setupRequired: "Please complete super admin setup.",
    configOptional: "Optional configuration variables can be filled now or skipped.",
    dependenciesOptional:
      "Optional dependencies are missing. Install them now or skip for this startup.",
    dependencyMissing: "A selected dependency is missing and cannot be installed automatically.",
    networkRetry:
      "This looks like a network/download problem. You can retry after checking your network.",
    manualDependency:
      "{failureKind}Retry is hidden because this does not look like a network/download problem. Install or repair the dependency manually, adjust permissions or the package URL if needed, then restart Noobot. See ~/Noobot-startup-debug.log for details.",
    retryHidden:
      "Retry is hidden because the last dependency failure was not marked as a network/download problem. Check ~/Noobot-startup-debug.log and repair the dependency manually before restarting Noobot.",
    failureKind: "Failure type: {kind}. ",
    setupSaved: "Basic setup saved. Checking optional variables...",
    setupIncomplete: "Please complete super admin setup.",
    configSaved: "Configuration saved. Starting Noobot service...",
    configSkipped: "Optional configuration skipped. Starting Noobot service...",
    dependenciesChecked: "Dependencies checked. Starting Noobot service...",
    dependenciesSkipped: "Optional dependencies skipped for this startup.",
    retrying: "Retrying...",
  },
  setup: {
    intro:
      "Complete the required first-run setup. These values are saved only in your desktop user data directory.",
    language: "Language",
    languageHelp: "Used as the default Noobot interface and response language.",
    model: "Model",
    modelHelp: "Used as the default model for global and default user configuration.",
    username: "Super admin username",
    usernamePlaceholder: "e.g. owner",
    usernameHelp: "Please use a non-default administrator name.",
    connectCode: "Connect code",
    connectCodePlaceholder: "Create a private connection code",
    connectCodeHelp: "Keep this code private. It is used to connect as the super admin.",
    proxy: "Dependency download proxy",
    proxyPlaceholder: "Optional, e.g. http://127.0.0.1:7890 or socks5://127.0.0.1:7890",
    proxyHelp:
      "Optional. If set, Noobot checks it before saving and uses it when downloading dependencies on Windows/macOS.",
    requiredError: "Super admin username, connect code and model are required.",
    next: "Next",
  },
  config: {
    intro:
      "The following configuration variables are optional. You can fill them now or skip this step.",
    modelParams: "Model connection",
    otherParams: "Other configuration",
    valueHelp: "Optional configuration value",
    save: "Save and continue",
    skip: "Skip",
  },
  dependencies: {
    intro: "Install missing optional dependencies now, or continue without them.",
    existingHelp:
      "Existing installations are detected automatically. Skipping only affects this startup; this choice will be offered again while dependencies remain missing.",
    optionalDescription: "Optional runtime dependency.",
    install: "Install selected",
    skip: "Skip for now",
    playwright: "Browser automation for web navigation, screenshots and testing.",
    libreoffice: "Document conversion for Office files, spreadsheets and presentations.",
    ffmpeg: "Audio and video processing for media extraction and conversion.",
    nodejs: "JavaScript runtime required by local services and tooling.",
  },
  actions: { retry: "Retry" },
};

const zhCN = {
  hero: { title: "正在启动 Noobot", logTitle: "启动日志" },
  status: {
    checkingService: "正在检查本地 Noobot 服务...",
    startingService: "正在启动 Noobot 服务...",
    serviceReady: "Noobot 服务已就绪。",
    loadingApplication: "正在打开 Noobot...",
    checkingDependencies: "正在检查可选依赖...",
    setupAlreadyCompleted: "本次启动已完成超级管理员设置，正在继续...",
    setupRequired: "请完成超级管理员设置。",
    configOptional: "可现在填写可选配置变量，也可以跳过。",
    dependenciesOptional: "检测到缺失的可选依赖，可现在安装或本次启动先跳过。",
    dependencyMissing: "所选依赖缺失且无法自动安装。",
    networkRetry: "这可能是网络或下载问题。请检查网络后重试。",
    manualDependency:
      "{failureKind}该问题不像网络或下载故障，因此不提供重试。请手动安装或修复依赖，必要时调整权限或软件包地址，然后重启 Noobot。详情见 ~/Noobot-startup-debug.log。",
    retryHidden:
      "上一次依赖失败未被判定为网络或下载问题，因此不提供重试。请检查 ~/Noobot-startup-debug.log，手动修复依赖后重启 Noobot。",
    failureKind: "失败类型：{kind}。",
    setupSaved: "基础设置已保存，正在检查可选变量...",
    setupIncomplete: "请完成超级管理员设置。",
    configSaved: "配置已保存，正在启动 Noobot 服务...",
    configSkipped: "已跳过可选配置，正在启动 Noobot 服务...",
    dependenciesChecked: "依赖检查完成，正在启动 Noobot 服务...",
    dependenciesSkipped: "本次启动已跳过可选依赖。",
    retrying: "正在重试...",
  },
  setup: {
    intro: "请完成首次启动所需的设置。这些信息只保存在桌面客户端的用户数据目录中。",
    language: "语言",
    languageHelp: "作为 Noobot 界面和回复的默认语言。",
    model: "模型",
    modelHelp: "作为全局配置和默认用户配置使用的默认模型。",
    username: "超级管理员用户名",
    usernamePlaceholder: "例如 owner",
    usernameHelp: "请使用非默认的管理员用户名。",
    connectCode: "连接码",
    connectCodePlaceholder: "创建一个私密连接码",
    connectCodeHelp: "请妥善保管。该连接码用于以超级管理员身份连接。",
    proxy: "依赖下载代理",
    proxyPlaceholder: "可选，例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:7890",
    proxyHelp: "可选。设置后，Noobot 会先检查代理，并在 Windows/macOS 下载依赖时使用它。",
    requiredError: "必须填写超级管理员用户名、连接码并选择模型。",
    next: "下一步",
  },
  config: {
    intro: "以下配置变量均为可选项，可现在填写或跳过此步骤。",
    modelParams: "模型连接",
    otherParams: "其他配置",
    valueHelp: "可选配置值",
    save: "保存并继续",
    skip: "跳过",
  },
  dependencies: {
    intro: "可现在安装缺失的可选依赖，也可以不安装并继续。",
    existingHelp:
      "客户端会自动检测已有安装。跳过只对本次启动生效；只要依赖仍然缺失，下次启动还会继续提供安装选项。",
    optionalDescription: "可选运行时依赖。",
    install: "安装所选项",
    skip: "暂时跳过",
    playwright: "用于网页导航、截图和测试的浏览器自动化能力。",
    libreoffice: "用于转换 Office 文档、电子表格和演示文稿。",
    ffmpeg: "用于音视频提取、处理和格式转换。",
    nodejs: "本地服务和工具运行所需的 JavaScript 运行时。",
  },
  actions: { retry: "重试" },
};

export const startupMessages = Object.freeze({ "zh-CN": zhCN, "en-US": enUS });

export function normalizeStartupLanguage(language) {
  return language === "en-US" ? "en-US" : "zh-CN";
}

export function formatStartupMessage(template, params = {}) {
  return String(template || "").replace(/\{([^}]+)\}/g, (_match, key) => String(params[key] ?? ""));
}
