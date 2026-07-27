/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { externalFrontendPluginEntries } from "./generated/external-entries.js";
import { contributeExtension, removePluginExtensions } from "../extensions/extension-registry.js";
import { EXTENSION_POINTS } from "../extensions/extension-point-ids.js";
import {
  getWorkflowSessionDetailApi,
  getWorkflowSessionThinkingDetailApi,
} from "../services/api/chatApi.js";
import { attachmentService } from "../services/attachmentService.js";
import { thinkingDetailService } from "../services/thinkingDetailService.js";

const REQUIRED_FRONTEND_PLUGIN_API_VERSION = "1";
const pluginAttachmentService = Object.freeze({
  getThumbnailBlob: (url = "") => attachmentService.getThumbnailBlob(url),
});
const pluginThinkingDetailService = Object.freeze({
  getDetail: (params = {}) => thinkingDetailService.getDetail(params),
});

function normalizeApiVersion(input = "") {
  return String(input || "").trim() || REQUIRED_FRONTEND_PLUGIN_API_VERSION;
}

export async function registerExternalFrontendPlugins() {
  for (const item of externalFrontendPluginEntries) {
    const pluginId = String(item?.pluginId || "").trim();
    const pluginName = String(item?.name || pluginId).trim();
    const apiVersion = normalizeApiVersion(item?.apiVersion);
    if (apiVersion !== REQUIRED_FRONTEND_PLUGIN_API_VERSION) {
      console.warn(
        `[frontend-plugin] skip ${pluginName}: unsupported apiVersion ${apiVersion}`,
      );
      continue;
    }
    let pluginModule = null;
    try {
      pluginModule = typeof item?.loadModule === "function" ? await item.loadModule() : item?.module;
    } catch (error) {
      console.warn(
        `[frontend-plugin] failed to load ${pluginName}: ${String(error?.message || error)}`,
      );
      continue;
    }
    const registerFn =
      typeof pluginModule?.registerFrontendPlugin === "function"
        ? pluginModule.registerFrontendPlugin
        : null;
    if (typeof registerFn !== "function") {
      console.warn(
        `[frontend-plugin] skip ${pluginName}: registerFrontendPlugin export not found`,
      );
      continue;
    }
    try {
      removePluginExtensions(pluginId);
      registerFn({
        contributeExtension(point, contribution = {}) {
          return contributeExtension(point, { ...contribution, pluginId });
        },
        extensionPoints: EXTENSION_POINTS,
        services: Object.freeze({
          attachments: pluginAttachmentService,
          thinkingDetails: pluginThinkingDetailService,
          workflowSessions: Object.freeze({
            getDetail: getWorkflowSessionDetailApi,
            getThinkingDetail: getWorkflowSessionThinkingDetailApi,
          }),
        }),
        pluginMeta: {
          pluginId,
          pluginKey: String(item?.pluginKey || "").trim(),
          name: pluginName,
          version: String(item?.version || "").trim(),
          apiVersion,
        },
        logger: console,
      });
    } catch (error) {
      console.warn(
        `[frontend-plugin] failed to load ${pluginName}: ${String(error?.message || error)}`,
      );
    }
  }
}
