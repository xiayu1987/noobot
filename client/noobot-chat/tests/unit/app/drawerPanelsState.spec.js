import { describe, expect, it, vi } from "vitest";
import { buildAppShellDrawerPanels } from "../../../src/app/state/drawerPanelsState";

describe("drawerPanelsState", () => {
  it("builds AppShell drawer panel descriptors with existing keys, models, components and props", () => {
    const workspaceVisible = { value: true };
    const userSettingsVisible = { value: false };
    const thinkingDetailsVisible = { value: true };
    const configParamsVisible = { value: false };
    const handleWorkspaceReset = vi.fn();
    const components = {
      WorkspacePanel: { name: "WorkspacePanel" },
      UserSettingsPanel: { name: "UserSettingsPanel" },
      ThinkingPanel: { name: "ThinkingPanel" },
      ConfigParamsPanel: { name: "ConfigParamsPanel" },
    };

    const panels = buildAppShellDrawerPanels({
      translate: (key) => `t:${key}`,
      workspaceVisible,
      userSettingsVisible,
      thinkingDetailsVisible,
      configParamsVisible,
      ...components,
      userId: "u1",
      apiKey: "api-key",
      connected: true,
      isSuperAdmin: true,
      thinkingDetailsMessageItem: { id: "m1" },
      thinkingDetailsAllMessages: [{ id: "m1" }],
      getThinkingDetailsTitle: (messageItem) => `thinking:${messageItem.id}`,
      handleWorkspaceReset,
    });

    expect(panels.map((panel) => panel.key)).toEqual([
      "workspace",
      "user-settings",
      "thinking-details",
      "config-params",
    ]);
    expect(panels[0]).toMatchObject({
      model: workspaceVisible,
      title: "t:common.workspace",
      component: components.WorkspacePanel,
      props: {
        userId: "u1",
        apiKey: "api-key",
        connected: true,
        active: true,
        isSuperAdmin: true,
      },
    });
    expect(panels[0].onWorkspaceReset).toBe(handleWorkspaceReset);
    expect(panels[1]).toMatchObject({
      model: userSettingsVisible,
      title: "t:common.userSettings",
      component: components.UserSettingsPanel,
      props: { apiKey: "api-key", connected: true, active: false },
    });
    expect(panels[2]).toMatchObject({
      model: thinkingDetailsVisible,
      title: "thinking:m1",
      component: components.ThinkingPanel,
      props: {
        messageItem: { id: "m1" },
        allMessages: [{ id: "m1" }],
        variant: "details",
      },
    });
    expect(panels[3]).toMatchObject({
      model: configParamsVisible,
      title: "t:common.configParams",
      component: components.ConfigParamsPanel,
      props: {
        userId: "u1",
        isSuperAdmin: true,
        apiKey: "api-key",
        connected: true,
        active: false,
      },
    });
  });

  it("uses safe translation and thinking defaults for partial input", () => {
    const panels = buildAppShellDrawerPanels();

    expect(panels).toHaveLength(4);
    expect(panels[0].title).toBe("common.workspace");
    expect(panels[2].title).toBe("message.thinkingDetails");
    expect(panels[2].props).toEqual({
      messageItem: {},
      allMessages: [],
      variant: "details",
    });
    expect(panels[3].props.active).toBe(false);
  });
});
