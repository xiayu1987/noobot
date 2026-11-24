/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import QuarantinedSessionsPanel from "../../../../src/modules/session/components/QuarantinedSessionsPanel.vue";
import { overlayMessageBox } from "../../../../src/shared/composables/overlayMessageBox.js";
import {
  deleteQuarantinedSessionApi,
  getQuarantinedSessionsApi,
} from "../../../../src/infrastructure/api/chat/chatApi.js";

vi.mock("../../../../src/infrastructure/api/chat/chatApi.js", () => ({
  getQuarantinedSessionsApi: vi.fn(),
  deleteQuarantinedSessionApi: vi.fn(),
}));
vi.mock("../../../../src/shared/i18n/useLocale.js", () => ({
  useLocale: () => ({
    locale: ref("en"),
    translate: (key, values) => (values?.title ? `${key}: ${values.title}` : key),
  }),
}));
vi.mock("../../../../src/shared/composables/useUiFeedback.js", () => ({
  useUiFeedback: () => ({ notify: vi.fn() }),
}));
vi.mock("../../../../src/shared/composables/overlayMessageBox.js", () => ({
  overlayMessageBox: { confirm: vi.fn() },
  isOverlayDismissal: () => false,
}));

const button = defineComponent({
  props: { disabled: Boolean },
  setup(props, { slots }) {
    return () => h("button", { disabled: props.disabled }, slots.default?.());
  },
});
const wrappers = [];
const response = (sessions) => Response.json({ ok: true, sessions });
const record = (sessionId, title = "") => ({
  id: `quarantine-${sessionId}`,
  sessionId,
  title,
  status: "unsupported-format",
  errorCode: "UNSUPPORTED_SESSION_STORAGE",
  quarantinedAt: "2026-11-24T00:00:00.000Z",
  quarantinePath: `quarantine/${sessionId}`,
  deleting: false,
});
function mountPanel() {
  const wrapper = mount(QuarantinedSessionsPanel, {
    props: { userId: "first", fetcher: vi.fn(), connected: true, active: true },
    global: { stubs: { ElButton: button, ElAlert: true, ElEmpty: true } },
  });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.resetAllMocks();
});

it("shows the canonical title and full identity and confirms deletion using the same label", async () => {
  getQuarantinedSessionsApi.mockResolvedValue(response([record("session-one", "Project notes")]));
  deleteQuarantinedSessionApi.mockResolvedValue(Response.json({ ok: true }));
  overlayMessageBox.confirm.mockResolvedValue(undefined);
  const wrapper = mountPanel();
  await flushPromises();
  const row = wrapper.get(".quarantine-row");
  expect(row.get("strong").text()).toBe("Project notes");
  expect(row.text()).toContain("session-one");
  expect(row.text()).toContain("quarantinedSessions.status.unsupported-format");
  await row.get("button").trigger("click");
  await flushPromises();
  expect(overlayMessageBox.confirm.mock.calls[0][0]).toBe(
    "quarantinedSessions.confirmDelete: Project notes",
  );
  expect(deleteQuarantinedSessionApi.mock.calls[0][0]).toEqual({
    userId: "first",
    id: "quarantine-session-one",
  });
  expect(wrapper.find(".quarantine-row").exists()).toBe(false);
});

it("identifies an unreadable title by its quarantine status while retaining the full identity", async () => {
  getQuarantinedSessionsApi.mockResolvedValue(response([record("session-unreadable")]));
  const wrapper = mountPanel();
  await flushPromises();
  expect(wrapper.get("strong").text()).toBe("quarantinedSessions.status.unsupported-format");
  expect(wrapper.get(".quarantine-row").text()).toContain("session-unreadable");
});

it("aborts superseded and unmounted requests and rejects stale responses", async () => {
  const pending = [];
  getQuarantinedSessionsApi.mockImplementation(
    () => new Promise((resolve) => pending.push(resolve)),
  );
  const wrapper = mountPanel();
  const firstSignal = getQuarantinedSessionsApi.mock.calls[0][1].signal;
  await wrapper.setProps({ userId: "second" });
  expect(firstSignal.aborted).toBe(true);
  const secondSignal = getQuarantinedSessionsApi.mock.calls[1][1].signal;
  pending[1](response([record("second-session", "Current conversation")]));
  await flushPromises();
  pending[0](response([record("first-session", "Stale conversation")]));
  await flushPromises();
  expect(wrapper.get("strong").text()).toBe("Current conversation");
  expect(wrapper.text()).not.toContain("Stale conversation");
  wrappers.splice(wrappers.indexOf(wrapper), 1);
  wrapper.unmount();
  expect(secondSignal.aborted).toBe(true);
});
