/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { computed, effectScope, reactive } from "vue";
import { useSessionMessageResources } from "../../../../../../src/modules/chat/composables/message/useSessionMessageResources.js";
import { buildAttachmentRefIndex } from "../../../../../../src/modules/chat/composables/message/attachmentInlineRefPlugin.js";
import { findMessageIdentityIndex } from "../../../../../../src/modules/chat/model/messageIdentity.js";
import { selectSharedTurnPresentations } from "../../../../../../src/modules/chat/runtime/engine/sharedTurnPresentations.js";
import { createTurnRuntimeRegistryState } from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { createWorkflowNodeStateRegistry } from "../../../../../../src/modules/chat/stores/workflowEventOperations.js";
import { mergeAttachmentDisplayItems } from "../../../../../../src/infrastructure/api/attachments/attachmentAccess.js";

function message(turnScopeId, role = "assistant") {
  return {
    sessionId: "session-1",
    turnScopeId,
    role,
    content: "hello",
    presentationMessageId: `${role}-${turnScopeId}`,
    toolTimeline: [],
    attachments: [],
    activityTimeline: [],
  };
}

describe("shared session message resources", () => {
  it("preserves first identity matching, object matching and missing-message rejection", () => {
    const messages = reactive([
      message("turn-1", "user"),
      message("turn-1"),
      message("turn-1"),
      message("turn-2", ""),
      message("", "user"),
    ]);
    const resources = useSessionMessageResources(messages);
    for (const target of [...messages, message("turn-1"), message("turn-1", "user")]) {
      expect(resources.messageIndex(target)).toBe(findMessageIdentityIndex(target, messages));
    }
    for (const target of [message("missing"), message("turn-2", ""), message("", "user")]) {
      expect(() => resources.messageIndex(target)).toThrow("message_not_in_session_messages");
    }
    messages.reverse();
    expect(resources.messageIndex(message("turn-1"))).toBe(
      findMessageIdentityIndex(message("turn-1"), messages),
    );
  });

  it("shares one link projection, ignores analysis deltas and survives the first consumer scope", () => {
    const messages = reactive([message("turn-1"), message("turn-2")]);
    const scope = effectScope();
    const first = scope.run(() => useSessionMessageResources(messages));
    const snapshots = first.linkSnapshots.value;
    expect(useSessionMessageResources(messages)).toBe(first);
    scope.stop();
    messages[1].activityTimeline.push({ eventId: "analysis-1", text: "delta" });
    expect(first.linkSnapshots.value).toBe(snapshots);
    messages.push(message("turn-3"));
    expect(first.linkSnapshots.value).not.toBe(snapshots);
    expect(first.messageIndex(messages[2])).toBe(2);
    const replacement = reactive([...messages]);
    expect(useSessionMessageResources(replacement)).not.toBe(first);
    expect(useSessionMessageResources(replacement)).toBe(useSessionMessageResources(replacement));
  });

  it("updates preceding attachment visibility without exposing later attachments", () => {
    const attachment = (id) => ({
      attachmentId: id,
      sessionId: "session-1",
      attachmentSource: "model",
      name: `${id}.txt`,
    });
    const messages = reactive([message("turn-1"), message("turn-2", "user"), message("turn-2")]);
    messages[0].attachments.push(attachment("first"));
    messages[2].attachments.push(attachment("future"));
    const resources = useSessionMessageResources(messages);
    const visible = computed(() => resources.attachmentRefIndex(messages[1], [], "admin"));
    expect([...visible.value.values()].map((item) => item.attachmentId)).toEqual(["first"]);
    messages[0].attachments.push(attachment("second"));
    expect([...visible.value.values()].map((item) => item.attachmentId)).toEqual([
      "first",
      "second",
    ]);
  });

  it("indexes sibling assistants once and follows membership changes without crossing sessions", () => {
    let roleReads = 0;
    const messages = reactive(
      Array.from({ length: 96 }, (_, index) => ({
        ...message(`turn-${index}`),
        get role() {
          roleReads += 1;
          return "assistant";
        },
      })),
    );
    const resources = useSessionMessageResources(messages);
    for (const item of messages) expect(resources.siblingAssistants(item)).toEqual([]);
    expect(roleReads).toBeLessThan(96 * 3);
    const sibling = { ...message("turn-0"), presentationMessageId: "sibling" };
    messages.push(sibling, { ...sibling, sessionId: "other-session" }, message("turn-0", "user"));
    expect(resources.siblingAssistants(messages[0])).toEqual([messages[96]]);
    messages[96].turnScopeId = "turn-1";
    expect(resources.siblingAssistants(messages[0])).toEqual([]);
    expect(resources.siblingAssistants(messages[1])).toEqual([messages[96]]);
    messages.splice(96, 1);
    expect(resources.siblingAssistants(messages[1])).toEqual([]);
  });

  it("preserves attachment precedence and order after replacement, reordering and deletion", () => {
    const attachment = (id, name) => ({
      attachmentId: id,
      name,
      sessionId: "session-1",
      attachmentSource: "model",
    });
    const messages = reactive([
      { ...message("turn-0"), attachments: [attachment("a", "first"), attachment("b", "second")] },
      message("turn-1", "user"),
      { ...message("turn-1"), attachments: [attachment("a", "replacement")] },
      message("turn-2", "user"),
    ]);
    const resources = useSessionMessageResources(messages);
    const displayed = [attachment("b", "current")];
    function assertPrefixes() {
      messages.forEach((item, index) => {
        const expected = mergeAttachmentDisplayItems(
          messages
            .slice(0, index)
            .filter((candidate) => candidate.role === "assistant")
            .flatMap((candidate) => candidate.attachments),
          displayed,
        );
        expect(resources.attachmentRefIndex(item, displayed, "admin")).toEqual(
          buildAttachmentRefIndex(expected, { userId: "admin" }),
        );
      });
    }
    assertPrefixes();
    messages[0].attachments[0].name = "updated";
    messages[2].attachments = [attachment("c", "new")];
    assertPrefixes();
    messages.reverse();
    assertPrefixes();
    messages.splice(1, 1);
    assertPrefixes();
  });

  it("shares normalized attachments across prefixes and users, tracking edits and drafts", () => {
    const messages = reactive([message("turn-0"), message("turn-1"), message("turn-2")]);
    messages[0].attachments.push({
      attachmentId: "a",
      sessionId: "session-1",
      attachmentSource: "model",
      name: "first",
    });
    messages[1].attachments.push({ clientAttachmentId: "draft-1", name: "draft" });
    const resources = useSessionMessageResources(messages);
    const first = resources.attachmentRefIndex(messages[1], [], "admin");
    const later = resources.attachmentRefIndex(messages[2], [], "admin");
    expect([...later.values()]).toHaveLength(1);
    expect([...later.values()][0]).toBe([...first.values()][0]);
    const other = resources.attachmentRefIndex(messages[2], [], "other");
    expect([...other.values()][0].url).not.toBe([...first.values()][0].url);
    messages[0].attachments[0].name = "edited";
    expect([...resources.attachmentRefIndex(messages[2], [], "admin").values()][0].name).toBe(
      "edited",
    );
    const replacement = reactive([...messages]);
    expect(
      [
        ...useSessionMessageResources(replacement)
          .attachmentRefIndex(replacement[2], [], "admin")
          .values(),
      ][0],
    ).toBe([...resources.attachmentRefIndex(messages[2], [], "admin").values()][0]);
  });

  it("shares the list and navigation projection and updates after the first consumer stops", () => {
    const args = {
      activeSession: reactive({ sessionId: "session-1", messages: [message("turn-1")] }),
      workflowRegistry: reactive(createWorkflowNodeStateRegistry()),
      turnRuntimeRegistry: reactive(createTurnRuntimeRegistryState()),
    };
    const scope = effectScope();
    const first = scope.run(() => selectSharedTurnPresentations(args));
    expect(selectSharedTurnPresentations(args)).toBe(first);
    args.activeSession.messages[0].activityTimeline.push({ eventId: "delta", text: "analysis" });
    expect(selectSharedTurnPresentations(args)).toBe(first);
    scope.stop();
    args.activeSession.messages.push(message("turn-2", "user"));
    const updated = selectSharedTurnPresentations(args);
    expect(updated).not.toBe(first);
    expect(updated).toHaveLength(2);
    expect(selectSharedTurnPresentations(args)).toBe(updated);
  });
});
