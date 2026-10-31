/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import BaseMarkdownContent from "../../../../../../src/shared/ui/BaseMarkdownContent.vue";
import { useMarkdownRenderer } from "../../../../../../src/modules/chat/composables/message/useMarkdownRenderer.js";
import { buildAttachmentRefIndex } from "../../../../../../src/modules/chat/composables/message/attachmentInlineRefPlugin.js";
import { translateMessageKey } from "../../../../../../src/shared/i18n/messageCatalog.js";

vi.mock("../../../../../../src/shared/utils/mermaid-renderer.js", () => ({
  renderMermaidInElement: vi.fn(),
}));

const { renderMarkdown } = useMarkdownRenderer();
const REPORT_PATH = "D:/工作/ai_dept_plan/调查表.xlsx";
const REPORT = {
  attachmentId: "a1",
  sessionId: "s1",
  attachmentSource: "model",
  name: "调查表.xlsx",
};
const REPORT_REF = "attachment:v1:s1/model/a1";
const wrappers = [];

const SHA = "c".repeat(64);

function attachmentSnapshot(identity = REPORT, originPath = REPORT_PATH, messageIndex = 0) {
  const { attachmentId, sessionId, attachmentSource } = identity;
  return {
    kind: "attachment",
    messageIndex,
    ref: {
      version: 1,
      resourceId: `res_${attachmentId}`,
      kind: "file",
      owner: "tool",
      source: "attachment",
      logical: { view: "attachment", path: identity.name },
      attachment: { attachmentId, sessionId, attachmentSource },
      origin: { view: "host", path: originPath },
      size: 1,
      mimeType: "application/octet-stream",
      capabilities: { read: true, write: false, scriptInput: false },
    },
  };
}

function mutationSnapshot(
  locator,
  { id = "m1", revision = 1, snapshot = "available", at = 0 } = {},
) {
  return {
    kind: "mutation",
    messageIndex: at,
    ref: {
      mutationId: id,
      revision,
      operation: snapshot === "deleted" ? "delete" : "replace",
      locator,
      fileName: locator.path.split("/").at(-1),
      beforeSha256: SHA,
      afterSha256: snapshot === "deleted" ? null : SHA,
      size: 1,
      additions: 1,
      deletions: 0,
      snapshot,
    },
  };
}

const WORKSPACE_SNAPSHOT = mutationSnapshot({ view: "workspace", path: "runtime/fixture.txt" });
const HOST_SNAPSHOT = mutationSnapshot({ view: "host", path: "D:/工作/host.xlsx" }, { id: "h1" });

const translate = (key, params) => translateMessageKey("en-US", key, params);

function render(
  content,
  {
    linkSnapshots = [attachmentSnapshot()],
    attachments = [REPORT],
    messageIndex = 0,
    workspaceRootDirectory = null,
  } = {},
) {
  return renderMarkdown(content, {
    attachmentRefIndex: buildAttachmentRefIndex(attachments),
    linkSnapshots,
    messageIndex,
    workspaceRootDirectory,
    translate,
  });
}

function mountMarkdown(
  content,
  {
    linkSnapshots = [attachmentSnapshot(), WORKSPACE_SNAPSHOT],
    attachments = [REPORT],
    messageIndex = 0,
  } = {},
) {
  const wrapper = mount(BaseMarkdownContent, {
    props: {
      content,
      renderMarkdown,
      attachmentRefIndex: buildAttachmentRefIndex(attachments),
      linkSnapshots,
      messageIndex,
      workspaceRootDirectory: null,
      translate,
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}

describe("file links resolve through session snapshots", () => {
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  });

  it("binds a registered attachment origin to its attachment", () => {
    const html = render(`[调查表](<${REPORT_PATH}>)`);
    expect(html).toContain(`data-noobot-attachment-ref="${REPORT_REF}"`);
    expect(html).not.toContain("noobot-attachment-chip--missing");
    expect(html).not.toContain('href="D:');
  });

  it("binds the same path spelled with a lowercase drive letter and backslashes", () => {
    const html = render("[调查表](<d:\\工作\\ai_dept_plan\\调查表.xlsx>)");
    expect(html).toContain(`data-noobot-attachment-ref="${REPORT_REF}"`);
  });

  it("takes the latest registration when a path was registered twice", () => {
    const newer = { ...REPORT, attachmentId: "a2" };
    const html = render(`[调查表](<${REPORT_PATH}>)`, {
      linkSnapshots: [attachmentSnapshot(), attachmentSnapshot(newer)],
      attachments: [REPORT, newer],
    });
    expect(html).toContain('data-noobot-attachment-ref="attachment:v1:s1/model/a2"');
    expect(html).not.toContain(`data-noobot-attachment-ref="${REPORT_REF}"`);
  });

  it("binds a workspace path to the mutation snapshot written there", () => {
    const html = render("[fixture](runtime/fixture.txt)", { linkSnapshots: [WORKSPACE_SNAPSHOT] });
    expect(html).toContain('data-noobot-mutation-ref="m1@1"');
    expect(html).not.toContain("noobot-attachment-chip--missing");
  });

  it("binds an absolute link under the message workspace root to the workspace file", () => {
    const html = render("[fixture](</home/u/workspace/admin/runtime/fixture.txt>)", {
      linkSnapshots: [WORKSPACE_SNAPSHOT],
      workspaceRootDirectory: "/home/u/workspace/admin",
    });
    expect(html).toContain('data-noobot-mutation-ref="m1@1"');
  });

  it("does not bind an absolute link without a root or under a sibling prefix", () => {
    for (const workspaceRootDirectory of [null, "/home/u/workspace/adm"]) {
      const html = render("[fixture](</home/u/workspace/admin/runtime/fixture.txt>)", {
        linkSnapshots: [WORKSPACE_SNAPSHOT],
        workspaceRootDirectory,
      });
      expect(html).toContain('data-attachment-missing-reason="resource_not_registered"');
    }
  });

  it("binds a host path to its mutation snapshot and never to the live file", () => {
    const html = render("[host](<D:/工作/host.xlsx>)", { linkSnapshots: [HOST_SNAPSHOT] });
    expect(html).toContain('data-noobot-mutation-ref="h1@1"');
    const live = render("[live](runtime/live.txt)", { linkSnapshots: [] });
    expect(live).toContain('data-attachment-missing-reason="resource_not_registered"');
    expect(live).toContain('title="This file was not written or registered in this session"');
    expect(live).not.toContain("<a ");
  });

  it("binds the version its message saw and marks it superseded by a later message", () => {
    const linkSnapshots = [
      mutationSnapshot({ view: "workspace", path: "out/a.txt" }, { id: "v1", at: 0 }),
      mutationSnapshot({ view: "workspace", path: "out/a.txt" }, { id: "v2", at: 2 }),
    ];
    const early = render("[a](out/a.txt)", { linkSnapshots, messageIndex: 1 });
    expect(early).toContain('data-noobot-mutation-ref="v1@1"');
    expect(early).toContain('data-noobot-link-superseded="true"');
    expect(early).toContain("A newer version exists in a later message");
    const late = render("[a](out/a.txt)", { linkSnapshots, messageIndex: 2 });
    expect(late).toContain('data-noobot-mutation-ref="v2@1"');
    expect(late).not.toContain("data-noobot-link-superseded");
  });

  it("renders a deleted snapshot as unavailable", () => {
    const deleted = mutationSnapshot(
      { view: "workspace", path: "out/a.txt" },
      { snapshot: "deleted" },
    );
    const html = render("[a](out/a.txt)", { linkSnapshots: [deleted] });
    expect(html).toContain('data-attachment-missing-reason="resource_deleted"');
    expect(html).not.toContain("<a ");
  });

  it("offers the latest version next to a superseded snapshot", () => {
    const linkSnapshots = [
      mutationSnapshot({ view: "workspace", path: "out/a.txt" }, { id: "v1", at: 0 }),
      mutationSnapshot({ view: "workspace", path: "out/a.txt" }, { id: "v2", at: 2 }),
    ];
    const html = render("[a](out/a.txt)", { linkSnapshots, messageIndex: 1 });
    expect(html).toContain('data-noobot-mutation-ref="v1@1"');
    expect(html).toMatch(/noobot-attachment-chip--latest"[^>]*data-noobot-mutation-ref="v2@1"/);
    expect(html).toContain('title="Latest version"');
  });

  it("disables an after-state overwritten by a later revision and offers the latest", () => {
    const linkSnapshots = [
      mutationSnapshot({ view: "workspace", path: "out/a.txt" }, { id: "m1", revision: 1, at: 0 }),
      mutationSnapshot({ view: "workspace", path: "out/a.txt" }, { id: "m1", revision: 2, at: 2 }),
    ];
    const html = render("[a](out/a.txt)", { linkSnapshots, messageIndex: 1 });
    expect(html).toContain('data-attachment-missing-reason="snapshot_overwritten"');
    expect(html).toContain("This version was overwritten by a later write in the same turn");
    expect(html).not.toContain('data-noobot-mutation-ref="m1@1"');
    expect(html).toMatch(/noobot-attachment-chip--latest"[^>]*data-noobot-mutation-ref="m1@2"/);
  });

  it("offers no latest entry when the newest snapshot is not downloadable", () => {
    const deleted = [
      mutationSnapshot({ view: "workspace", path: "out/a.txt" }, { id: "v1", at: 0 }),
      mutationSnapshot(
        { view: "workspace", path: "out/a.txt" },
        { id: "v2", snapshot: "deleted", at: 2 },
      ),
    ];
    const html = render("[a](out/a.txt)", { linkSnapshots: deleted, messageIndex: 1 });
    expect(html).toContain('data-noobot-link-superseded="true"');
    expect(html).not.toContain("noobot-attachment-chip--latest");

    const newer = { ...REPORT, attachmentId: "a2" };
    const unindexed = render(`[调查表](<${REPORT_PATH}>)`, {
      linkSnapshots: [attachmentSnapshot(), attachmentSnapshot(newer, REPORT_PATH, 2)],
      attachments: [REPORT],
      messageIndex: 1,
    });
    expect(unindexed).toContain(`data-noobot-attachment-ref="${REPORT_REF}"`);
    expect(unindexed).not.toContain("noobot-attachment-chip--latest");
  });

  it("renders an unregistered path as disabled", () => {
    for (const href of ["<D:/工作/other.xlsx>", "runtime/other.txt"]) {
      const html = render(`[other](${href})`);
      expect(html).toContain('data-attachment-missing-reason="resource_not_registered"');
      expect(html).not.toContain("<a ");
    }
  });

  it("renders an attachment resource absent from the attachment index as unavailable", () => {
    const html = render(`[调查表](<${REPORT_PATH}>)`, { attachments: [] });
    expect(html).toContain('data-attachment-missing-reason="attachment_not_available"');
    expect(html).not.toContain("<a ");
  });

  it("keeps web links, protocol-relative URLs, fragments and mail links as links", () => {
    const html = render(
      "[web](https://example.com/file.txt) [web2](//example.com/a) [anchor](#section) [mail](mailto:a@example.com)",
    );
    expect(html).not.toContain("noobot-attachment-chip");
    for (const href of [
      "https://example.com/file.txt",
      "//example.com/a",
      "#section",
      "mailto:a@example.com",
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("emits the indexed attachment when a bound attachment link is clicked", () => {
    const wrapper = mountMarkdown(`[调查表](<${REPORT_PATH}>)`);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    wrapper.get("a").element.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    const emitted = wrapper.emitted("download-attachment");
    expect(emitted).toHaveLength(1);
    expect(emitted[0][0]).toMatchObject({
      attachmentId: "a1",
      sessionId: "s1",
      name: "调查表.xlsx",
    });
  });

  it("emits the bound MutationRef when a workspace link is clicked", async () => {
    const wrapper = mountMarkdown("[fixture](runtime/fixture.txt)");
    await wrapper.get("a").trigger("click");
    expect(wrapper.emitted("download-mutation")).toEqual([[WORKSPACE_SNAPSHOT.ref]]);
    expect(wrapper.emitted("download-attachment")).toBeUndefined();
  });

  it("emits the latest MutationRef when the latest-version chip is clicked", async () => {
    const v1 = mutationSnapshot({ view: "workspace", path: "out/a.txt" }, { id: "v1", at: 0 });
    const v2 = mutationSnapshot({ view: "workspace", path: "out/a.txt" }, { id: "v2", at: 2 });
    const wrapper = mountMarkdown("[a](out/a.txt)", { linkSnapshots: [v1, v2], messageIndex: 1 });
    await wrapper.get(".noobot-attachment-chip--latest").trigger("click");
    expect(wrapper.emitted("download-mutation")).toEqual([[v2.ref]]);
  });

  it("reports a rendered mutation chip without a snapshot through link-error", async () => {
    const wrapper = mountMarkdown("[fixture](runtime/fixture.txt)");
    await wrapper.setProps({ linkSnapshots: [] });
    wrapper.element.innerHTML = render("[fixture](runtime/fixture.txt)", {
      linkSnapshots: [WORKSPACE_SNAPSHOT],
    });
    await wrapper.get("a").trigger("click");
    const errors = wrapper.emitted("link-error");
    expect(errors).toHaveLength(1);
    expect(String(errors[0][0].message)).toContain("rendered mutation chip has no snapshot: m1@1");
    expect(wrapper.emitted("download-mutation")).toBeUndefined();
  });

  it("does not emit on middle click or on a disabled chip", async () => {
    const bound = mountMarkdown(`[调查表](<${REPORT_PATH}>)`);
    const aux = new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true });
    bound.get("a").element.dispatchEvent(aux);
    expect(aux.defaultPrevented).toBe(true);
    expect(bound.emitted("download-attachment")).toBeUndefined();

    const missing = mountMarkdown("[other](<D:/工作/other.xlsx>)");
    await missing.get(".noobot-attachment-chip--missing").trigger("click");
    expect(missing.emitted("download-attachment")).toBeUndefined();
    expect(missing.emitted("download-mutation")).toBeUndefined();
  });

  it("reports a rendered attachment chip missing from the index through link-error", async () => {
    const wrapper = mountMarkdown(`[调查表](<${REPORT_PATH}>)`);
    await wrapper.setProps({ attachmentRefIndex: buildAttachmentRefIndex([]) });

    wrapper.element.innerHTML = render(`[调查表](<${REPORT_PATH}>)`);
    await wrapper.get("a").trigger("click");
    const errors = wrapper.emitted("link-error");
    expect(errors).toHaveLength(1);
    expect(String(errors[0][0].message)).toContain("rendered attachment chip is not indexed: a1");
    expect(wrapper.emitted("download-attachment")).toBeUndefined();
  });
});
