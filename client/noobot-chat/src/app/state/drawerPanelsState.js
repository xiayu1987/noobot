/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
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
  fetcher,
  connected,
  isSuperAdmin,
  thinkingDetailsMessageItem,
  thinkingDetailsAllMessages,
  thinkingDetailsRuntime,
  getThinkingDetailsTitle,
  handleWorkspaceReset,
}) {
  return [
    {
      key: "workspace",
      model: workspaceVisible,
      title: translate("common.workspace"),
      component: WorkspacePanel,
      props: {
        userId,
        fetcher,
        connected,
        active: Boolean(workspaceVisible?.value),
        isSuperAdmin,
      },
      listeners: { "workspace-reset": handleWorkspaceReset },
    },
    {
      key: "user-settings",
      model: userSettingsVisible,
      title: translate("common.userSettings"),
      component: UserSettingsPanel,
      props: {
        fetcher,
        connected,
        active: Boolean(userSettingsVisible?.value),
      },
      listeners: {},
    },
    {
      key: "thinking-details",
      model: thinkingDetailsVisible,
      title: getThinkingDetailsTitle(thinkingDetailsMessageItem),
      component: ThinkingPanel,
      props: {
        messageItem: thinkingDetailsMessageItem,
        allMessages: thinkingDetailsAllMessages,
        runtime: thinkingDetailsRuntime,
        variant: "details",
        userId,
      },
      listeners: {},
    },
    {
      key: "config-params",
      model: configParamsVisible,
      title: translate("common.configParams"),
      component: ConfigParamsPanel,
      props: {
        userId,
        isSuperAdmin,
        fetcher,
        connected,
        active: Boolean(configParamsVisible?.value),
      },
      listeners: {},
    },
  ];
}
