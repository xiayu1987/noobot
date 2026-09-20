/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getThinkingDetailsCount } from "./thinkingDetailsState.js";

export function buildAppShellDrawerPanels({
  translate,
  workspaceVisible,
  userSettingsVisible,
  thinkingDetailsVisible,
  configParamsVisible,
  WorkspacePanel,
  UserSettingsPanel,
  ThinkingPanel,
  ConfigParamsPanel,
  userId,
  apiKey,
  connected,
  isSuperAdmin,
  thinkingDetailsMessageItem,
  thinkingDetailsAllMessages,
  thinkingDetailsRuntime,
  thinkingDetailService,
  getThinkingDetailsTitle,
  handleWorkspaceReset,
} = {}) {
  const t = typeof translate === "function" ? translate : (key) => key;
  const messageItem = thinkingDetailsMessageItem || {};
  const resolveThinkingTitle =
    typeof getThinkingDetailsTitle === "function"
      ? getThinkingDetailsTitle
      : (item) => t("message.thinkingDetails", { count: getThinkingDetailsCount(item) });

  return [
    {
      key: "workspace",
      model: workspaceVisible,
      title: t("common.workspace"),
      component: WorkspacePanel,
      props: {
        userId,
        apiKey,
        connected,
        active: Boolean(workspaceVisible?.value),
        isSuperAdmin,
      },
      onWorkspaceReset: handleWorkspaceReset,
    },
    {
      key: "user-settings",
      model: userSettingsVisible,
      title: t("common.userSettings"),
      component: UserSettingsPanel,
      props: {
        apiKey,
        connected,
        active: Boolean(userSettingsVisible?.value),
      },
    },
    {
      key: "thinking-details",
      model: thinkingDetailsVisible,
      title: resolveThinkingTitle(messageItem),
      component: ThinkingPanel,
      props: {
        messageItem,
        allMessages: thinkingDetailsAllMessages || [],
        runtime: thinkingDetailsRuntime || null,
        variant: "details",
        userId,
        thinkingDetailService: thinkingDetailService || null,
      },
    },
    {
      key: "config-params",
      model: configParamsVisible,
      title: t("common.configParams"),
      component: ConfigParamsPanel,
      props: {
        userId,
        isSuperAdmin,
        apiKey,
        connected,
        active: Boolean(configParamsVisible?.value),
      },
    },
  ];
}
