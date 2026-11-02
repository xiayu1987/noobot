/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { installElementPlusComponents } from "../../../src/app/entrypoints.js";
import RuntimeParamsPanel from "../../../src/modules/settings/panels/RuntimeParamsPanel.vue";

vi.mock("../../../src/plugins/auto-register.js", () => ({
  registerExternalFrontendPlugins: vi.fn(),
}));
vi.mock("../../../src/shared/i18n/useLocale.js", () => ({
  useLocale: () => ({ translate: (key) => key }),
}));

let wrapper;
afterEach(() => wrapper?.unmount());

describe("application Element Plus registration", () => {
  it("renders runtime parameter rows with the production component installer", async () => {
    const errors = vi.fn();
    const warnings = vi.fn();
    wrapper = mount(RuntimeParamsPanel, {
      props: {
        active: true,
        connected: true,
        fetcher: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            ok: true,
            revision: 3,
            activeRevision: 2,
            restartRequired: true,
            catalog: [
              {
                key: "quantity.memory.maxItems",
                nameKey: "memoryName",
                descriptionKey: "memoryDescription",
                editable: true,
                defaultValue: 30,
                savedValue: 42,
                activeValue: 40,
                minimum: 1,
                maximum: 100,
                unit: "count",
              },
            ],
          }),
        }),
      },
      global: {
        plugins: [installElementPlusComponents],
        config: { errorHandler: errors, warnHandler: warnings },
      },
    });
    await flushPromises();
    expect(errors.mock.calls).toEqual([]);
    expect(warnings.mock.calls).toEqual([]);
    expect(wrapper.find('[data-test="runtime-pending"]').text()).toBe("runtimeParams.pending");
    const row = wrapper.find(
      '[data-test="runtime-param-row"][data-key="quantity.memory.maxItems"]',
    );
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain("memoryName");
    expect(row.text()).toContain("memoryDescription");
    expect(row.find("input").element.value).toBe("42");
    await row.find("button").trigger("click");
    expect(wrapper.find('[data-test="runtime-changes"]').text()).toContain("42 → 30");
    expect(row.find("input").element.value).toBe("30");
  });
});
